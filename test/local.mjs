/**
 * Arné local: ejecuta el Worker contra SQLite en memoria mediante un shim
 * mínimo de la API de D1 (`prepare`, `bind`, `first`, `run`, `all`, `batch`).
 */
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import worker from '../worker.js';

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

function makeEnv() {
  return {
    DB: new FakeD1(new DatabaseSync(':memory:')),
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

async function listEntries(env) {
  const response = await call(env, '/api/entries');
  assert.equal(response.status, 200, 'GET /api/entries debe responder 200');
  const body = await response.json();
  return body.entries;
}

async function addEntry(env, payload) {
  return call(env, '/api/entries', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
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
  const entries = await listEntries(env);
  assert.equal(entries.length, 6);
  assert.deepEqual(
    entries.map((entry) => entry.position),
    [1, 2, 3, 4, 5, 6],
  );
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
  const entries = await listEntries(env);
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

await check('las altas concurrentes no se sobrescriben', async () => {
  const before = await listEntries(env);
  const responses = await Promise.all(
    Array.from({ length: 5 }, (unused, index) => addEntry(env, { title: `Paralelo ${index}`, url: `https://p${index}.example.com` })),
  );
  responses.forEach((response) => assert.equal(response.status, 201));

  const after = await listEntries(env);
  assert.equal(after.length, before.length + 5);
  assert.equal(new Set(after.map((entry) => entry.position)).size, after.length, 'las posiciones deben ser únicas');
});

await check('DELETE elimina y persiste; repetirlo devuelve 404', async () => {
  const entries = await listEntries(env);
  const target = entries[0];

  const first = await call(env, `/api/entries/${target.id}`, { method: 'DELETE' });
  assert.equal(first.status, 204);

  const remaining = await listEntries(env);
  assert.equal(remaining.some((entry) => entry.id === target.id), false);

  const second = await call(env, `/api/entries/${target.id}`, { method: 'DELETE' });
  assert.equal(second.status, 404);
});

await check('los datos sobreviven al reinicio del Worker', async () => {
  // El módulo se reimporta con caché limpia para simular un arranque nuevo
  // contra la misma base: el esquema y la semilla no deben duplicarse.
  const fresh = await import(`../worker.js?v=${Date.now()}`);
  const before = await listEntries(env);
  const response = await fresh.default.fetch(new Request('https://speed-dial.test/api/entries'), env);
  assert.equal(response.status, 200);
  const { entries } = await response.json();
  assert.deepEqual(entries.map((entry) => entry.id), before.map((entry) => entry.id));
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
