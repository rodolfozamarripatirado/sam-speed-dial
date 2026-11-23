const form = document.getElementById('add-form');
const titleInput = document.getElementById('title');
const urlInput = document.getElementById('url');
const submitButton = form.querySelector('button[type="submit"]');
const statusEl = document.getElementById('form-status');
const grid = document.getElementById('grid');
const emptyState = document.getElementById('empty');
const loadError = document.getElementById('load-error');
const countEl = document.getElementById('count');

let entries = [];

function setStatus(message, kind = '') {
  statusEl.textContent = message;
  if (kind) {
    statusEl.dataset.kind = kind;
  } else {
    delete statusEl.dataset.kind;
  }
}

function hostOf(rawUrl) {
  try {
    return new URL(rawUrl).host.replace(/^www\./, '');
  } catch {
    return rawUrl;
  }
}

function tonFor(value) {
  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.codePointAt(0)) % 100003;
  }
  return hash % 6;
}

function monogram(title) {
  const first = Array.from(title.trim())[0] ?? '?';
  return first.toUpperCase();
}

function buildTile(entry) {
  const host = hostOf(entry.url);

  const item = document.createElement('li');
  item.className = 'tile';
  item.dataset.id = String(entry.id);

  const link = document.createElement('a');
  link.className = 'tile-link';
  link.href = entry.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.referrerPolicy = 'no-referrer';

  const icon = document.createElement('span');
  icon.className = `tile-icon tone-${tonFor(host)}`;
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = monogram(entry.title);

  const title = document.createElement('span');
  title.className = 'tile-title';
  title.textContent = entry.title;

  const hostLabel = document.createElement('span');
  hostLabel.className = 'tile-host';
  hostLabel.textContent = host;

  link.append(icon, title, hostLabel);

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'tile-delete';
  remove.textContent = '×';
  remove.setAttribute('aria-label', `Eliminar ${entry.title}`);
  remove.addEventListener('click', () => removeEntry(entry));

  item.append(link, remove);
  return item;
}

function render() {
  const sorted = [...entries].sort((a, b) => a.position - b.position || a.id - b.id);

  grid.replaceChildren(...sorted.map(buildTile));
  emptyState.hidden = sorted.length > 0;
  countEl.textContent = sorted.length === 1 ? '1 acceso' : `${sorted.length} accesos`;
}

async function loadEntries() {
  loadError.hidden = true;
  try {
    const response = await fetch('/api/entries', { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error('respuesta inesperada');
    const data = await response.json();
    entries = Array.isArray(data.entries) ? data.entries : [];
    render();
  } catch {
    grid.replaceChildren();
    emptyState.hidden = true;
    loadError.hidden = false;
  }
}

async function removeEntry(entry) {
  if (!window.confirm(`¿Eliminar "${entry.title}"?`)) return;

  try {
    const response = await fetch(`/api/entries/${encodeURIComponent(entry.id)}`, { method: 'DELETE' });
    if (!response.ok && response.status !== 404) throw new Error('no se pudo eliminar');
    entries = entries.filter((item) => item.id !== entry.id);
    render();
    setStatus('Acceso eliminado.', 'ok');
  } catch {
    setStatus('No se pudo eliminar el acceso. Intenta de nuevo.', 'error');
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const title = titleInput.value.trim();
  const url = urlInput.value.trim();

  if (!title || !url) {
    setStatus('Completa el título y la URL para guardar el acceso.', 'error');
    (title ? urlInput : titleInput).focus();
    return;
  }

  submitButton.disabled = true;
  setStatus('Guardando…');

  try {
    const response = await fetch('/api/entries', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title, url }),
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.entry) {
      setStatus(data.message ?? 'No se pudo guardar el acceso.', 'error');
      return;
    }

    entries.push(data.entry);
    render();
    form.reset();
    titleInput.focus();
    setStatus('Acceso agregado.', 'ok');
  } catch {
    setStatus('No se pudo guardar el acceso. Revisa tu conexión.', 'error');
  } finally {
    submitButton.disabled = false;
  }
});

loadEntries();
