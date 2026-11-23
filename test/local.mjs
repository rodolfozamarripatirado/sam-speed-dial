/**
 * Arné local: ejecuta el Worker contra SQLite en memoria mediante un shim
 * mínimo de la API de D1 (`prepare`, `bind`, `first`, `run`, `all`, `batch`)
 * y de R2 (`put`, `get`, `delete`).
 */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import worker from '../worker.js';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]);

class FakeStatement {
  constructor(db, sql, params = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }

  bind(...params) {
    return new FakeStatement(this.db, this.sql, params);
  }

  async all() {
    const rows = this.db.prepare(this.sql).all(...this.params);
    return { results: rows, success: true, meta: {} };
  }

  async first() {
    const { results } = await this.all();
    return results[0] ?? null;
  }

  async run() {
    const info = this.db.prepare(this.sql).run(...this.params);
    return { success: true, meta: { changes: Number(info.changes) } };
  }
}

class FakeD1 {
  constructor(db) {
    this.db = db;
  }

  prepare(sql) {
    return new FakeStatement(this.db, sql);
  }

  async batch(statements) {
    const results = [];
    for (const statement of statements) {
      results.push(await statement.run());
    }
    return results;
  }
}

class FakeR2 {
  constructor() {
    this.store = new Map();
  }

  async put(key, value, options = {}) {
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    this.store.set(key, { bytes, httpMetadata: options.httpMetadata ?? {} });
  }

  async get(key) {
    const item = this.store.get(key);
    if (!item) return null;
    return {
      body: item.bytes,
      httpMetadata: item.httpMetadata,
      httpEtag: '"fake-etag"',
      writeHttpMetadata(headers) {
        if (item.httpMetadata.contentType) headers.set('content-type', item.httpMetadata.contentType);
      },
    };
  }

  async delete(key) {
    this.store.delete(key);
  }
}

function makeEnv() {
  return {
    DB: new FakeD1(new DatabaseSync(':memory:')),
    FILES: new FakeR2(),
    ASSETS: {
      async fetch() {
        return new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } });
      },
    },
  };
}

function call(env, path, init = {}) {
  return worker.fetch(new Request(`https://speed-dial.test${path}`, init), env);
}

async function fetchAll(env) {
  const response = await call(env, '/api/entries');
  assert.equal(response.status, 200, 'GET /api/entries debe responder 200');
  return response.json();
}

async function addEntry(env, payload) {
  return call(env, '/api/entries', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

function multipart(fields) {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    if (value !== undefined && value !== null) form.set(name, value);
  }
  return form;
}

const checks = [];

async function check(name, run) {
  try {
    await run();
    checks.push({ name, ok: true });
    console.log(`ok   ${name}`);
  } catch (error) {
    checks.push({ name, ok: false, error });
    console.log(`FAIL ${name}\n     ${error.message}`);
  }
}

const env = makeEnv();

await check('los assets no-API se delegan a env.ASSETS', async () => {
  const response = await call(env, '/');
  assert.equal(response.status, 200);
});

await check('la primera carga siembra los accesos de ejemplo', async () => {
  const { entries } = await fetchAll(env);
  assert.equal(entries.length, 6);
  assert.deepEqual(
    entries.map((entry) => entry.position),
    [1, 2, 3, 4, 5, 6],
  );
  assert.equal(entries[0].groupId, null);
  assert.equal(entries[0].imageUrl, null);
});

await check('POST válido devuelve 201 y la entrada creada', async () => {
  const response = await addEntry(env, { title: '  Panel SAM  ', url: 'https://sam.example.com/panel' });
  assert.equal(response.status, 201);
  const { entry } = await response.json();
  assert.equal(entry.title, 'Panel SAM');
  assert.equal(entry.url, 'https://sam.example.com/panel');
  assert.equal(entry.position, 7);
  assert.ok(entry.id > 0);
});

await check('la entrada nueva aparece en el listado', async () => {
  const { entries } = await fetchAll(env);
  assert.ok(entries.some((entry) => entry.title === 'Panel SAM'));
});

await check('se rechazan esquemas de URL inseguros', async () => {
  for (const url of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<h1>x</h1>', 'file:///etc/passwd']) {
    const response = await addEntry(env, { title: 'Malo', url });
    assert.equal(response.status, 400, `debe rechazar ${url}`);
  }
});

await check('se rechazan URLs inválidas y títulos vacíos', async () => {
  assert.equal((await addEntry(env, { title: 'Sin esquema', url: 'ejemplo.com' })).status, 400);
  assert.equal((await addEntry(env, { title: '   ', url: 'https://ejemplo.com' })).status, 400);
  assert.equal((await addEntry(env, { title: 'Credenciales', url: 'https://user:pass@ejemplo.com' })).status, 400);
  assert.equal((await addEntry(env, {})).status, 400);
});

await check('un cuerpo no-JSON devuelve 400', async () => {
  const response = await call(env, '/api/entries', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: 'no es json',
  });
  assert.equal(response.status, 400);
});

await check('multipart con grupo e imagen crea la entrada, el grupo y guarda la imagen', async () => {
  const form = multipart({
    title: 'Panel con imagen',
    url: 'https://panel.example.com',
    groupName: 'Trabajo',
    image: new File([PNG], 'panel.png', { type: 'image/png' }),
  });

  const response = await call(env, '/api/entries', { method: 'POST', body: form });
  assert.equal(response.status, 201);

  const body = await response.json();
  assert.equal(body.entry.title, 'Panel con imagen');
  assert.ok(body.entry.groupId !== null, 'la entrada debe quedar dentro del grupo');
  assert.ok(String(body.entry.imageUrl).startsWith('/api/images/'));
  assert.ok(body.groups.some((group) => group.name === 'Trabajo'));

  const image = await call(env, body.entry.imageUrl);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('content-type'), 'image/png');
  assert.equal((await image.arrayBuffer()).byteLength, PNG.length);
});

await check('el grupo existente se reutiliza sin duplicarse', async () => {
  const form = multipart({ title: 'Otra del grupo', url: 'https://otra.example.com', groupName: 'trabajo' });
  const response = await call(env, '/api/entries', { method: 'POST', body: form });
  assert.equal(response.status, 201);

  const body = await response.json();
  const trabajos = body.groups.filter((group) => group.name.toLowerCase() === 'trabajo');
  assert.equal(trabajos.length, 1, 'no debe crear un grupo duplicado');
  assert.equal(body.entry.groupId, trabajos[0].id);
});

await check('se rechazan archivos que no son imágenes o son SVG', async () => {
  const svg = new File([new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>')], 'x.svg', {
    type: 'image/svg+xml',
  });
  const form = multipart({ title: 'SVG', url: 'https://svg.example.com', image: svg });
  const response = await call(env, '/api/entries', { method: 'POST', body: form });
  assert.equal(response.status, 415);

  const text = multipart({
    title: 'Texto',
    url: 'https://texto.example.com',
    image: new File([new TextEncoder().encode('hola')], 'x.txt', { type: 'image/png' }),
  });
  const textResponse = await call(env, '/api/entries', { method: 'POST', body: text });
  assert.equal(textResponse.status, 415, 'el tipo declarado no basta: se valida el contenido');
});

await check('se rechazan imágenes de más de 2 MB', async () => {
  const big = new Uint8Array(2 * 1024 * 1024 + 1);
  big.set(PNG, 0);
  const form = multipart({
    title: 'Enorme',
    url: 'https://enorme.example.com',
    image: new File([big], 'big.png', { type: 'image/png' }),
  });
  const response = await call(env, '/api/entries', { method: 'POST', body: form });
  assert.equal(response.status, 413);
});

await check('una imagen inexistente o con clave inválida devuelve 404', async () => {
  assert.equal((await call(env, '/api/images/00000000-0000-0000-0000-000000000000.png')).status, 404);
  assert.equal((await call(env, '/api/images/..%2Fworker.js')).status, 404);
});

await check('al eliminar la entrada se borra también su imagen', async () => {
  const { entries } = await fetchAll(env);
  const target = entries.find((entry) => entry.imageUrl);

  const response = await call(env, `/api/entries/${target.id}`, { method: 'DELETE' });
  assert.equal(response.status, 204);
  assert.equal((await call(env, target.imageUrl)).status, 404, 'la imagen debe quedar eliminada');
});

await check('las altas concurrentes no se sobrescriben', async () => {
  const before = await fetchAll(env);
  const responses = await Promise.all(
    Array.from({ length: 5 }, (unused, index) =>
      addEntry(env, { title: `Paralelo ${index}`, url: `https://p${index}.example.com` }),
    ),
  );
  responses.forEach((response) => assert.equal(response.status, 201));

  const { entries } = await fetchAll(env);
  assert.equal(entries.length, before.entries.length + 5);
  assert.equal(new Set(entries.map((entry) => entry.position)).size, entries.length, 'las posiciones deben ser únicas');
});

await check('DELETE elimina y persiste; repetirlo devuelve 404', async () => {
  const { entries } = await fetchAll(env);
  const target = entries[0];

  const first = await call(env, `/api/entries/${target.id}`, { method: 'DELETE' });
  assert.equal(first.status, 204);

  const remaining = await fetchAll(env);
  assert.equal(remaining.entries.some((entry) => entry.id === target.id), false);

  const second = await call(env, `/api/entries/${target.id}`, { method: 'DELETE' });
  assert.equal(second.status, 404);
});

await check('los datos sobreviven al reinicio del Worker', async () => {
  // El módulo se reimporta con caché limpia para simular un arranque nuevo
  // contra la misma base: el esquema, la migración y la semilla no deben duplicarse.
  const fresh = await import(`../worker.js?v=${Date.now()}`);
  const before = await fetchAll(env);
  const response = await fresh.default.fetch(new Request('https://speed-dial.test/api/entries'), env);
  assert.equal(response.status, 200);
  const { entries } = await response.json();
  assert.deepEqual(entries.map((entry) => entry.id), before.entries.map((entry) => entry.id));
});

await check('migra una base creada con el esquema anterior', async () => {
  const legacy = new DatabaseSync(':memory:');
  legacy.exec(`CREATE TABLE entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    url TEXT NOT NULL,
    position INTEGER NOT NULL,
    created_at TEXT NOT NULL
  )`);
  legacy.exec(
    `INSERT INTO entries (title, url, position, created_at) VALUES ('Vieja', 'https://vieja.example.com', 1, '2026-01-01T00:00:00.000Z')`,
  );

  const legacyEnv = { DB: new FakeD1(legacy), FILES: new FakeR2(), ASSETS: env.ASSETS };
  const fresh = await import(`../worker.js?legacy=${Date.now()}`);
  const response = await fresh.default.fetch(new Request('https://speed-dial.test/api/entries'), legacyEnv);
  assert.equal(response.status, 200, 'no debe fallar por columnas faltantes');

  const body = await response.json();
  assert.ok(body.entries.some((entry) => entry.title === 'Vieja'));
  assert.equal(body.entries[0].groupId, null);
});

await check('una caída de la base devuelve 503 genérico', async () => {
  const brokenEnv = {
    ...env,
    DB: {
      prepare() {
        throw new Error('D1_ERROR: connection refused (secreto-no-filtrar)');
      },
      async batch() {
        throw new Error('D1_ERROR: connection refused');
      },
    },
  };

  const originalError = console.error;
  console.error = () => {};
  try {
    const response = await call(brokenEnv, '/api/entries');
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error, 'unavailable');
    assert.equal(JSON.stringify(body).includes('secreto-no-filtrar'), false);
  } finally {
    console.error = originalError;
  }
});

const failed = checks.filter((entry) => !entry.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} comprobaciones correctas`);
process.exit(failed.length === 0 ? 0 : 1);
