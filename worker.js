/**
 * SAM Speed Dial — primera rebanada (SAM-SD-001).
 *
 * API mínima sobre Cloudflare D1: listar, agregar y eliminar accesos.
 * Sin secretos en el cliente: la base de datos es un binding del Worker.
 */

const MAX_TITLE = 120;
const MAX_URL = 2048;

/**
 * Datos de ejemplo de la primera carga. Se insertan una sola vez y la persona
 * usuaria puede borrarlos. El export real de Opera (`bookmarks_20_11_2026.html`)
 * todavía no se ha importado.
 */
const DEMO_ENTRIES = [
  { title: 'Notion', url: 'https://www.notion.so/' },
  { title: 'GitHub', url: 'https://github.com/' },
  { title: 'MDN Web Docs', url: 'https://developer.mozilla.org/' },
  { title: 'Hacker News', url: 'https://news.ycombinator.com/' },
  { title: 'Cloudflare Dashboard', url: 'https://dash.cloudflare.com/' },
  { title: 'Wikipedia', url: 'https://es.wikipedia.org/' },
];

const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS entries (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     title TEXT NOT NULL,
     url TEXT NOT NULL,
     position INTEGER NOT NULL,
     created_at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS entries_position_idx ON entries (position, id)`,
  `CREATE TABLE IF NOT EXISTS app_meta (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   )`,
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
  };
}

function validateEntry(payload) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new HttpError(400, 'El cuerpo de la petición debe ser un objeto JSON.');
  }

  const title = typeof payload.title === 'string' ? payload.title.trim() : '';
  const rawUrl = typeof payload.url === 'string' ? payload.url.trim() : '';

  if (!title) throw new HttpError(400, 'El título es obligatorio.');
  if (title.length > MAX_TITLE) {
    throw new HttpError(400, `El título no puede superar ${MAX_TITLE} caracteres.`);
  }
  if (/[\u0000-\u001f\u007f]/.test(title)) {
    throw new HttpError(400, 'El título contiene caracteres no permitidos.');
  }

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

  return { title, url: parsed.href };
}

let schemaReady = null;

function ensureSchema(env) {
  if (!schemaReady) {
    schemaReady = (async () => {
      await env.DB.batch(SCHEMA_STATEMENTS.map((sql) => env.DB.prepare(sql)));

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

async function listEntries(env) {
  const { results } = await env.DB
    .prepare('SELECT id, title, url, position, created_at FROM entries ORDER BY position ASC, id ASC')
    .all();

  return (results ?? []).map(toEntry);
}

async function createEntry(env, input) {
  // La posición se calcula dentro del propio INSERT para que dos altas
  // simultáneas no se sobrescriban.
  const row = await env.DB
    .prepare(
      `INSERT INTO entries (title, url, position, created_at)
       VALUES (?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM entries), ?)
       RETURNING id, title, url, position, created_at`,
    )
    .bind(input.title, input.url, new Date().toISOString())
    .first();

  if (!row) throw new Error('La entrada no se pudo recuperar después de guardarla.');
  return toEntry(row);
}

async function deleteEntry(env, id) {
  const result = await env.DB.prepare('DELETE FROM entries WHERE id = ?').bind(id).run();
  if ((result?.meta?.changes ?? 0) === 0) {
    throw new HttpError(404, 'Ese acceso ya no existe.');
  }
}

async function handleApi(request, env, path) {
  if (path === '/api/entries') {
    if (request.method === 'GET') {
      return jsonResponse({ entries: await listEntries(env) });
    }

    if (request.method === 'POST') {
      let payload;
      try {
        payload = await request.json();
      } catch {
        throw new HttpError(400, 'El cuerpo de la petición no es JSON válido.');
      }
      const input = validateEntry(payload);
      const entry = await createEntry(env, input);
      return jsonResponse({ entry }, 201);
    }

    throw new HttpError(405, 'Método no permitido.');
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
