/**
 * SAM Speed Dial — primera rebanada (SAM-SD-001) + grupos e imágenes.
 *
 * API sobre Cloudflare D1: listar, agregar y eliminar accesos agrupados.
 * Las imágenes viven en un bucket R2 y se sirven por /api/images/:key.
 * Sin secretos en el cliente: base de datos y bucket son bindings del Worker.
 */

const MAX_TITLE = 120;
const MAX_URL = 2048;
const MAX_GROUP_NAME = 60;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const IMAGE_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

const IMAGE_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp|gif)$/;

/**
 * Datos de ejemplo de la primera carga. Se insertan una sola vez y la persona
 * usuaria puede borrarlos.
 */
const DEMO_ENTRIES = [
  { title: 'Notion', url: 'https://www.notion.so/' },
  { title: 'GitHub', url: 'https://github.com/' },
  { title: 'MDN Web Docs', url: 'https://developer.mozilla.org/' },
  { title: 'Hacker News', url: 'https://news.ycombinator.com/' },
  { title: 'Cloudflare Dashboard', url: 'https://dash.cloudflare.com/' },
  { title: 'Wikipedia', url: 'https://es.wikipedia.org/' },
];

const TABLE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS entries (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     title TEXT NOT NULL,
     url TEXT NOT NULL,
     position INTEGER NOT NULL,
     created_at TEXT NOT NULL,
     group_id INTEGER,
     image_key TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS entry_groups (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL COLLATE NOCASE UNIQUE,
     position INTEGER NOT NULL,
     created_at TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS app_meta (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   )`,
];

// Las bases creadas con la primera versión no tienen estas columnas: se añaden
// antes de crear los índices que las usan.
const MIGRATION_STATEMENTS = [
  'ALTER TABLE entries ADD COLUMN group_id INTEGER',
  'ALTER TABLE entries ADD COLUMN image_key TEXT',
];

const INDEX_STATEMENTS = [
  'CREATE INDEX IF NOT EXISTS entries_position_idx ON entries (position, id)',
  'CREATE INDEX IF NOT EXISTS entries_group_idx ON entries (group_id)',
];

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    },
  });
}

function toEntry(row) {
  return {
    id: Number(row.id),
    title: String(row.title),
    url: String(row.url),
    position: Number(row.position),
    createdAt: String(row.created_at),
    groupId: row.group_id === null || row.group_id === undefined ? null : Number(row.group_id),
    imageUrl: row.image_key ? `/api/images/${row.image_key}` : null,
  };
}

function toGroup(row) {
  return {
    id: Number(row.id),
    name: String(row.name),
    position: Number(row.position),
  };
}

function validateTitle(value) {
  const title = typeof value === 'string' ? value.trim() : '';
  if (!title) throw new HttpError(400, 'El título es obligatorio.');
  if (title.length > MAX_TITLE) {
    throw new HttpError(400, `El título no puede superar ${MAX_TITLE} caracteres.`);
  }
  if (/[\u0000-\u001f\u007f]/.test(title)) {
    throw new HttpError(400, 'El título contiene caracteres no permitidos.');
  }
  return title;
}

function validateUrl(value) {
  const rawUrl = typeof value === 'string' ? value.trim() : '';
  if (!rawUrl) throw new HttpError(400, 'La URL es obligatoria.');
  if (rawUrl.length > MAX_URL) {
    throw new HttpError(400, `La URL no puede superar ${MAX_URL} caracteres.`);
  }

  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new HttpError(400, 'La URL no es válida. Usa una dirección completa, por ejemplo https://ejemplo.com');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new HttpError(400, 'Solo se permiten enlaces http:// o https://.');
  }
  if (parsed.username || parsed.password) {
    throw new HttpError(400, 'La URL no puede incluir usuario ni contraseña.');
  }

  return parsed.href;
}

function validateGroupName(value) {
  if (value === null || value === undefined) return null;
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name) return null;
  if (name.length > MAX_GROUP_NAME) {
    throw new HttpError(400, `El nombre del grupo no puede superar ${MAX_GROUP_NAME} caracteres.`);
  }
  if (/[\u0000-\u001f\u007f]/.test(name)) {
    throw new HttpError(400, 'El nombre del grupo contiene caracteres no permitidos.');
  }
  return name;
}

function validateEntry(payload) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new HttpError(400, 'El cuerpo de la petición debe ser un objeto JSON.');
  }
  return {
    title: validateTitle(payload.title),
    url: validateUrl(payload.url),
  };
}

function asciiAt(bytes, start, end) {
  let text = '';
  for (let index = start; index < end; index += 1) {
    text += String.fromCharCode(bytes[index]);
  }
  return text;
}

function sniffImageType(bytes) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (bytes.length >= 12 && asciiAt(bytes, 0, 4) === 'RIFF' && asciiAt(bytes, 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  if (bytes.length >= 6 && asciiAt(bytes, 0, 6) === 'GIF8') {
    return 'image/gif';
  }
  return null;
}

async function storeImage(env, file) {
  if (!file || typeof file === 'string' || !file.size) return null;

  if (!env.FILES) {
    throw new HttpError(503, 'El almacenamiento de imágenes no está disponible en este momento.');
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new HttpError(413, 'La imagen supera los 2 MB. Elige una más ligera.');
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const contentType = sniffImageType(bytes);
  if (!contentType) {
    throw new HttpError(415, 'Formato no permitido. Usa PNG, JPG, WEBP o GIF.');
  }

  const key = `${crypto.randomUUID()}.${IMAGE_EXT[contentType]}`;
  await env.FILES.put(key, bytes, {
    httpMetadata: { contentType, cacheControl: 'public, max-age=31536000, immutable' },
  });
  return key;
}

let schemaReady = null;

function ensureSchema(env) {
  if (!schemaReady) {
    schemaReady = (async () => {
      await env.DB.batch(TABLE_STATEMENTS.map((sql) => env.DB.prepare(sql)));

      for (const sql of MIGRATION_STATEMENTS) {
        try {
          await env.DB.prepare(sql).run();
        } catch (error) {
          const message = String(error?.message ?? error);
          if (!/duplicate column/i.test(message)) throw error;
        }
      }

      await env.DB.batch(INDEX_STATEMENTS.map((sql) => env.DB.prepare(sql)));

      const seededAt = new Date().toISOString();
      const claim = await env.DB
        .prepare(`INSERT OR IGNORE INTO app_meta (key, value) VALUES ('seeded', ?)`)
        .bind(seededAt)
        .run();

      if ((claim?.meta?.changes ?? 0) > 0) {
        await env.DB.batch(
          DEMO_ENTRIES.map((entry, index) =>
            env.DB
              .prepare('INSERT INTO entries (title, url, position, created_at) VALUES (?, ?, ?, ?)')
              .bind(entry.title, entry.url, index + 1, seededAt),
          ),
        );
      }
    })().catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

async function listGroups(env) {
  const { results } = await env.DB
    .prepare('SELECT id, name, position FROM entry_groups ORDER BY position ASC, id ASC')
    .all();
  return (results ?? []).map(toGroup);
}

async function listEntries(env) {
  const { results } = await env.DB
    .prepare(
      'SELECT id, title, url, position, created_at, group_id, image_key FROM entries ORDER BY position ASC, id ASC',
    )
    .all();

  return (results ?? []).map(toEntry);
}

async function resolveGroupId(env, rawName) {
  const name = validateGroupName(rawName);
  if (!name) return null;

  const existing = await env.DB
    .prepare('SELECT id FROM entry_groups WHERE name = ? COLLATE NOCASE')
    .bind(name)
    .first();

  if (existing) return Number(existing.id);

  try {
    const created = await env.DB
      .prepare(
        `INSERT INTO entry_groups (name, position, created_at)
         VALUES (?, (SELECT COALESCE(MAX(position), 0) + 1 FROM entry_groups), ?)
         RETURNING id`,
      )
      .bind(name, new Date().toISOString())
      .first();
    if (created) return Number(created.id);
  } catch (error) {
    // Otra petición pudo crear el mismo grupo entre la consulta y el insert.
    const retry = await env.DB
      .prepare('SELECT id FROM entry_groups WHERE name = ? COLLATE NOCASE')
      .bind(name)
      .first();
    if (retry) return Number(retry.id);
    throw error;
  }

  throw new Error('El grupo no se pudo crear.');
}

async function createEntry(env, input) {
  // La posición se calcula dentro del propio INSERT para que dos altas
  // simultáneas no se sobrescriban.
  const row = await env.DB
    .prepare(
      `INSERT INTO entries (title, url, position, created_at, group_id, image_key)
       VALUES (?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM entries), ?, ?, ?)
       RETURNING id, title, url, position, created_at, group_id, image_key`,
    )
    .bind(input.title, input.url, new Date().toISOString(), input.groupId, input.imageKey)
    .first();

  if (!row) throw new Error('La entrada no se pudo recuperar después de guardarla.');
  return toEntry(row);
}

async function deleteEntry(env, id) {
  const existing = await env.DB.prepare('SELECT image_key FROM entries WHERE id = ?').bind(id).first();

  const result = await env.DB.prepare('DELETE FROM entries WHERE id = ?').bind(id).run();
  if ((result?.meta?.changes ?? 0) === 0) {
    throw new HttpError(404, 'Ese acceso ya no existe.');
  }

  const imageKey = existing?.image_key;
  if (imageKey && env.FILES) {
    try {
      await env.FILES.delete(imageKey);
    } catch (error) {
      console.error('speed-dial: no se pudo borrar la imagen', error?.message ?? error);
    }
  }
}

async function readPayload(request) {
  const contentType = request.headers.get('content-type') ?? '';

  if (contentType.includes('multipart/form-data')) {
    let form;
    try {
      form = await request.formData();
    } catch {
      throw new HttpError(400, 'No se pudo leer el formulario.');
    }
    return {
      title: form.get('title'),
      url: form.get('url'),
      groupName: form.get('groupName'),
      image: form.get('image'),
    };
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    throw new HttpError(400, 'El cuerpo de la petición no es JSON válido.');
  }

  const input = validateEntry(payload);
  return {
    title: input.title,
    url: input.url,
    groupName: payload.groupName ?? null,
    image: null,
  };
}

async function serveImage(env, key) {
  if (!IMAGE_KEY_PATTERN.test(key) || !env.FILES) {
    throw new HttpError(404, 'Imagen no encontrada.');
  }

  const object = await env.FILES.get(key);
  if (!object) throw new HttpError(404, 'Imagen no encontrada.');

  const headers = new Headers();
  if (typeof object.writeHttpMetadata === 'function') {
    object.writeHttpMetadata(headers);
  } else if (object.httpMetadata?.contentType) {
    headers.set('content-type', object.httpMetadata.contentType);
  }
  if (!headers.has('content-type')) headers.set('content-type', 'application/octet-stream');
  if (object.httpEtag) headers.set('etag', object.httpEtag);
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('content-security-policy', "default-src 'none'; sandbox");

  return new Response(object.body, { headers });
}

async function handleApi(request, env, path) {
  if (path === '/api/entries') {
    if (request.method === 'GET') {
      const [entries, groups] = await Promise.all([listEntries(env), listGroups(env)]);
      return jsonResponse({ entries, groups });
    }

    if (request.method === 'POST') {
      const payload = await readPayload(request);
      const title = validateTitle(payload.title);
      const url = validateUrl(payload.url);

      const imageKey = await storeImage(env, payload.image);

      let groupId = null;
      let entry;
      try {
        groupId = await resolveGroupId(env, payload.groupName);
        entry = await createEntry(env, { title, url, groupId, imageKey });
      } catch (error) {
        if (imageKey && env.FILES) {
          await env.FILES.delete(imageKey).catch(() => {});
        }
        throw error;
      }

      const groups = await listGroups(env);
      return jsonResponse({ entry, groups }, 201);
    }

    throw new HttpError(405, 'Método no permitido.');
  }

  const imageMatch = path.match(/^\/api\/images\/([^/]+)$/);
  if (imageMatch) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      throw new HttpError(405, 'Método no permitido.');
    }
    return serveImage(env, imageMatch[1]);
  }

  const match = path.match(/^\/api\/entries\/([1-9][0-9]{0,17})$/);
  if (match) {
    if (request.method !== 'DELETE') throw new HttpError(405, 'Método no permitido.');
    await deleteEntry(env, Number(match[1]));
    return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
  }

  throw new HttpError(404, 'Recurso no encontrado.');
}

async function handleRequest(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (!path.startsWith('/api/')) {
    return env.ASSETS.fetch(request);
  }

  try {
    await ensureSchema(env);
    return await handleApi(request, env, path);
  } catch (error) {
    if (error instanceof HttpError) {
      return jsonResponse({ error: 'invalid_request', message: error.message }, error.status);
    }
    console.error('speed-dial: fallo inesperado', error?.message ?? error);
    return jsonResponse(
      { error: 'unavailable', message: 'El servicio no está disponible en este momento. Intenta de nuevo en unos minutos.' },
      503,
    );
  }
}

export default {
  async fetch(request, env) {
    return handleRequest(request, env);
  },
};
