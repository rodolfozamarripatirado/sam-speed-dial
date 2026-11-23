const openAddButton = document.getElementById('open-add');
const dialog = document.getElementById('add-dialog');
const form = document.getElementById('add-form');
const modalTitle = document.getElementById('modal-title');
const submitButton = document.getElementById('submit-entry');
const closeButton = document.getElementById('close-add');
const cancelButton = document.getElementById('cancel-add');
const titleInput = document.getElementById('title');
const urlInput = document.getElementById('url');
const groupSelect = document.getElementById('group-select');
const groupNameInput = document.getElementById('group-name');
const imageInput = document.getElementById('image');
const imagePreview = document.getElementById('image-preview');
const imagePreviewImg = document.getElementById('image-preview-img');
const clearImageButton = document.getElementById('clear-image');
const modalStatus = document.getElementById('modal-status');
const sections = document.getElementById('sections');
const emptyState = document.getElementById('empty');
const loadError = document.getElementById('load-error');
const countEl = document.getElementById('count');
const importButton = document.getElementById('import-bookmarks');
const importFile = document.getElementById('import-file');
const importStatus = document.getElementById('import-status');

const NEW_GROUP_VALUE = '__new';
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_SIDE = 1200;

let entries = [];
let groups = [];

let editingId = null;
let existingImageUrl = null;
let removeImage = false;
let previewObjectUrl = null;
let importing = false;

function setStatus(element, message, kind = '') {
  element.textContent = message;
  if (kind) {
    element.dataset.kind = kind;
  } else {
    delete element.dataset.kind;
  }
}

function hostOf(rawUrl) {
  try {
    return new URL(rawUrl).host.replace(/^www\./, '');
  } catch {
    return rawUrl;
  }
}

function toneFor(value) {
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
  // La tarjeta es solo la imagen: el nombre y el dominio viven en el tooltip.
  link.title = `${entry.title} — ${host}`;
  link.setAttribute('aria-label', `${entry.title} (${host})`);

  const media = document.createElement('span');
  media.className = 'tile-media';

  if (entry.imageUrl) {
    const photo = document.createElement('img');
    photo.className = 'tile-photo';
    photo.src = entry.imageUrl;
    photo.alt = '';
    photo.loading = 'lazy';
    photo.decoding = 'async';
    media.append(photo);
  } else {
    const icon = document.createElement('span');
    icon.className = `tile-icon tone-${toneFor(host)}`;
    icon.setAttribute('aria-hidden', 'true');
    icon.textContent = monogram(entry.title);
    media.append(icon);
  }

  link.append(media);

  const actions = document.createElement('div');
  actions.className = 'tile-actions';

  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'tile-action';
  edit.textContent = '✎';
  edit.setAttribute('aria-label', `Editar ${entry.title} y su imagen`);
  edit.addEventListener('click', () => openEdit(entry));

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'tile-action tile-delete';
  remove.textContent = '×';
  remove.setAttribute('aria-label', `Eliminar ${entry.title}`);
  remove.addEventListener('click', () => removeEntry(entry));

  actions.append(edit, remove);
  item.append(link, actions);
  return item;
}

function buildSection(group, items, { isFirst = false, isLast = false } = {}) {
  const wrapper = document.createElement('section');
  wrapper.className = 'group-block';

  if (group) {
    const heading = document.createElement('h3');
    heading.className = 'group-title';

    const name = document.createElement('span');
    name.className = 'group-name';
    name.textContent = group.name;

    const total = document.createElement('span');
    total.className = 'group-count';
    total.textContent = items.length === 1 ? '1 acceso' : `${items.length} accesos`;

    const actions = document.createElement('span');
    actions.className = 'group-actions';

    const up = document.createElement('button');
    up.type = 'button';
    up.className = 'group-move';
    up.textContent = '↑';
    up.title = 'Mover este grupo antes';
    up.setAttribute('aria-label', `Mover el grupo ${group.name} antes`);
    up.disabled = isFirst;
    up.addEventListener('click', () => moveGroup(group, 'up'));

    const down = document.createElement('button');
    down.type = 'button';
    down.className = 'group-move';
    down.textContent = '↓';
    down.title = 'Mover este grupo después';
    down.setAttribute('aria-label', `Mover el grupo ${group.name} después`);
    down.disabled = isLast;
    down.addEventListener('click', () => moveGroup(group, 'down'));

    actions.append(up, down);
    heading.append(name, total, actions);

    wrapper.append(heading);
  }

  const grid = document.createElement('ul');
  grid.className = 'grid';
  grid.append(...items.map(buildTile));
  wrapper.append(grid);

  return wrapper;
}

function render() {
  const sortedEntries = [...entries].sort((a, b) => a.position - b.position || a.id - b.id);
  const grouped = new Map();
  const ungrouped = [];

  for (const entry of sortedEntries) {
    if (entry.groupId === null || entry.groupId === undefined) {
      ungrouped.push(entry);
      continue;
    }
    if (!grouped.has(entry.groupId)) grouped.set(entry.groupId, []);
    grouped.get(entry.groupId).push(entry);
  }

  const orderedGroups = [...groups].sort((a, b) => a.position - b.position || a.id - b.id);

  const blocks = [];
  if (ungrouped.length > 0) blocks.push(buildSection(null, ungrouped));

  orderedGroups.forEach((group, index) => {
    const items = grouped.get(group.id);
    if (!items || items.length === 0) return;
    blocks.push(
      buildSection(group, items, {
        isFirst: index === 0,
        isLast: index === orderedGroups.length - 1,
      }),
    );
  });

  sections.replaceChildren(...blocks);
  emptyState.hidden = sortedEntries.length > 0;
  countEl.textContent = sortedEntries.length === 1 ? '1 acceso' : `${sortedEntries.length} accesos`;
}

async function loadEntries() {
  loadError.hidden = true;
  try {
    const response = await fetch('/api/entries', { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error('respuesta inesperada');
    const data = await response.json();
    entries = Array.isArray(data.entries) ? data.entries : [];
    groups = Array.isArray(data.groups) ? data.groups : [];
    render();
  } catch {
    sections.replaceChildren();
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
  } catch {
    window.alert('No se pudo eliminar el acceso. Intenta de nuevo.');
  }
}

async function moveGroup(group, direction) {
  try {
    const response = await fetch(`/api/groups/${encodeURIComponent(group.id)}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ direction }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(data.groups)) {
      throw new Error('no se pudo mover el grupo');
    }

    groups = data.groups;
    render();
  } catch {
    window.alert('No se pudo mover el grupo. Intenta de nuevo.');
  }
}

/* Imagen: vista previa y estado */

function releasePreviewUrl() {
  if (previewObjectUrl) {
    URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = null;
  }
}

function updatePreview() {
  const src = previewObjectUrl || (removeImage ? null : existingImageUrl);
  if (src) {
    imagePreviewImg.src = src;
    imagePreview.hidden = false;
  } else {
    imagePreviewImg.removeAttribute('src');
    imagePreview.hidden = true;
  }
}

function resetImageState() {
  releasePreviewUrl();
  existingImageUrl = null;
  removeImage = false;
  imageInput.value = '';
  updatePreview();
}

function chooseImage(file) {
  // Solo se libera la URL anterior: vaciar `imageInput.value` aquí descartaría
  // el archivo elegido y la tarjeta se guardaría sin imagen.
  releasePreviewUrl();

  if (!file) {
    updatePreview();
    return;
  }

  previewObjectUrl = URL.createObjectURL(file);
  removeImage = false;
  updatePreview();
}

function clearImage() {
  releasePreviewUrl();
  imageInput.value = '';
  removeImage = Boolean(existingImageUrl);
  updatePreview();
}

/* Modal */

function populateGroups(selectedId = '') {
  groupSelect.replaceChildren();

  const none = document.createElement('option');
  none.value = '';
  none.textContent = 'Sin grupo';
  groupSelect.append(none);

  for (const group of [...groups].sort((a, b) => a.position - b.position || a.id - b.id)) {
    const option = document.createElement('option');
    option.value = String(group.id);
    option.textContent = group.name;
    groupSelect.append(option);
  }

  const create = document.createElement('option');
  create.value = NEW_GROUP_VALUE;
  create.textContent = '+ Nuevo grupo';
  groupSelect.append(create);

  groupSelect.value = selectedId;
  groupNameInput.hidden = groupSelect.value !== NEW_GROUP_VALUE;
}

function showDialog() {
  if (typeof dialog.showModal === 'function') {
    dialog.showModal();
  } else {
    dialog.setAttribute('open', '');
  }
}

function closeDialog() {
  resetImageState();
  editingId = null;
  if (typeof dialog.close === 'function') {
    dialog.close();
  } else {
    dialog.removeAttribute('open');
  }
}

function openCreate() {
  form.reset();
  resetImageState();
  setStatus(modalStatus, '');
  populateGroups();
  groupNameInput.value = '';
  editingId = null;
  modalTitle.textContent = 'Nuevo acceso';
  submitButton.textContent = 'Guardar';
  showDialog();
  titleInput.focus();
}

function openEdit(entry) {
  form.reset();
  resetImageState();
  setStatus(modalStatus, '');
  populateGroups(entry.groupId === null || entry.groupId === undefined ? '' : String(entry.groupId));
  groupNameInput.value = '';
  editingId = entry.id;
  existingImageUrl = entry.imageUrl || null;
  titleInput.value = entry.title;
  urlInput.value = entry.url;
  updatePreview();
  modalTitle.textContent = 'Editar acceso';
  submitButton.textContent = 'Guardar cambios';
  showDialog();
  titleInput.focus();
}

/* Imágenes: reducción y generación desde el ícono del export */

async function shrinkImage(file) {
  if (file.size <= 400 * 1024 || file.type === 'image/gif') return file;

  try {
    const bitmap = await createImageBitmap(file);
    const longestSide = Math.max(bitmap.width, bitmap.height);
    if (longestSide <= MAX_IMAGE_SIDE) {
      bitmap.close?.();
      return file;
    }

    const scale = MAX_IMAGE_SIDE / longestSide;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.86));
    if (!blob) return file;
    return new File([blob], 'imagen.webp', { type: 'image/webp' });
  } catch {
    return file;
  }
}

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('No se pudo leer el ícono'));
    image.src = src;
  });
}

function roundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

/**
 * Convierte el ícono incrustado en el export (16×16) en una portada 480×360:
 * fondo ampliado y difuminado del propio ícono, más el ícono nítido centrado.
 */
async function cardImageFromIcon(dataUri) {
  try {
    const image = await loadImageElement(dataUri);
    const width = 480;
    const height = 360;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    ctx.save();
    ctx.filter = 'blur(26px) saturate(1.25)';
    const scale = Math.max(width / image.width, height / image.height) * 1.5;
    ctx.drawImage(
      image,
      (width - image.width * scale) / 2,
      (height - image.height * scale) / 2,
      image.width * scale,
      image.height * scale,
    );
    ctx.restore();

    ctx.fillStyle = 'rgba(9, 13, 24, 0.5)';
    ctx.fillRect(0, 0, width, height);

    const size = Math.round(Math.min(width, height) * 0.42);
    const x = (width - size) / 2;
    const y = (height - size) / 2;

    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowBlur = 22;
    ctx.shadowOffsetY = 8;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
    roundedRect(ctx, x - 12, y - 12, size + 24, size + 24, 26);
    ctx.fill();
    ctx.restore();

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, x, y, size, size);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.9));
    if (!blob) return null;
    return new File([blob], 'portada.webp', { type: 'image/webp' });
  } catch {
    return null;
  }
}

/* Importación del export de Opera */

function decodeText(value) {
  const element = document.createElement('textarea');
  element.innerHTML = value;
  return element.value;
}

function normalizeName(name) {
  return (name || '').replace(/\s+/g, ' ').trim();
}

function hashString(value) {
  let hash = 0;
  for (const char of value) {
    hash = (hash * 31 + char.codePointAt(0)) % 100003;
  }
  return hash;
}

/**
 * Portada para accesos que no traen ícono en el export: degradado por dominio
 * con el monograma y el host. Así ninguna tarjeta queda sin imagen.
 */
async function generatedCardImage(title, url) {
  try {
    const host = hostOf(url);
    const width = 480;
    const height = 360;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    const hue = hashString(host) % 360;
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, `hsl(${hue} 58% 38%)`);
    gradient.addColorStop(1, `hsl(${(hue + 42) % 360} 52% 20%)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
    ctx.beginPath();
    ctx.arc(width * 0.82, height * 0.16, 150, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(width * 0.1, height * 0.94, 120, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
    ctx.font = '700 118px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(monogram(title || host), width / 2, height * 0.42);

    ctx.fillStyle = 'rgba(255, 255, 255, 0.62)';
    ctx.font = '600 26px ui-sans-serif, system-ui, sans-serif';
    const label = host.length > 26 ? `${host.slice(0, 25)}…` : host;
    ctx.fillText(label, width / 2, height * 0.78);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', 0.9));
    if (!blob) return null;
    return new File([blob], 'portada.webp', { type: 'image/webp' });
  } catch {
    return null;
  }
}

function genericFolder(name) {
  return !name || /^carpeta$/i.test(name) || /^speed dials$/i.test(name);
}

/**
 * Recorre el HTML del export línea por línea. La carpeta `Speed Dials` define el
 * alcance; sus subcarpetas se convierten en grupos.
 */
function parseOperaExport(html) {
  const lines = html.split(/\r?\n/);
  const stack = [];
  const items = [];
  let pendingFolder = null;
  let inside = false;
  let depth = 0;

  for (const line of lines) {
    const text = line.trim();

    if (text.startsWith('<DT><H3')) {
      const match = text.match(/^<DT><H3[^>]*>(.*)<\/H3>$/);
      pendingFolder = match ? normalizeName(decodeText(match[1])) : null;
      continue;
    }

    if (text.startsWith('<DL')) {
      depth += 1;
      const isRoot = !inside && pendingFolder && /^speed dials$/i.test(pendingFolder);
      if (isRoot) inside = true;
      stack.push({ name: isRoot ? null : pendingFolder, depth, isRoot });
      pendingFolder = null;
      continue;
    }

    if (text.startsWith('</DL')) {
      const frame = stack.pop();
      if (frame?.isRoot) inside = false;
      depth -= 1;
      continue;
    }

    if (!inside || !text.startsWith('<DT><A')) continue;

    const href = text.match(/HREF="([^"]*)"/i)?.[1];
    const icon = text.match(/ICON="([^"]*)"/i)?.[1];
    const titleMatch = text.match(/>([^<>]*)<\/A>\s*$/);
    if (!href) continue;

    let groupName = null;
    for (let index = stack.length - 1; index >= 0; index -= 1) {
      const candidate = stack[index];
      if (candidate.isRoot) break;
      if (!genericFolder(candidate.name)) {
        groupName = candidate.name;
        break;
      }
    }

    items.push({
      url: decodeText(href),
      title: titleMatch ? normalizeName(decodeText(titleMatch[1])) : '',
      group: groupName,
      icon: icon || null,
    });
  }

  if (!items.length) {
    throw new Error('No encontré accesos dentro de la carpeta "Speed Dials" del archivo.');
  }

  return items;
}

async function runImport(text) {
  const found = parseOperaExport(text);
  const known = new Set(entries.map((entry) => entry.url));
  const queue = found.filter((item) => item.url && !known.has(item.url));

  if (!queue.length) {
    setStatus(importStatus, 'Los accesos de ese archivo ya están importados.', 'ok');
    return;
  }

  const confirmMessage =
    `Se importarán ${queue.length} accesos de la carpeta "Speed Dials"` +
    (found.length !== queue.length ? ` (${found.length - queue.length} ya existían)` : '') +
    '.\n\nCada tarjeta usará el ícono guardado en el archivo como imagen, que luego puedes cambiar con ✎.\n\n¿Continuar?';

  if (!window.confirm(confirmMessage)) return;

  importing = true;
  importButton.disabled = true;
  let created = 0;
  let failed = 0;

  try {
    for (let index = 0; index < queue.length; index += 1) {
      const item = queue[index];
      setStatus(importStatus, `Importando ${index + 1} de ${queue.length}…`);

      try {
        const body = new FormData();
        body.set('title', item.title || item.url);
        body.set('url', item.url);
        if (item.group) body.set('groupName', item.group);

        const file = item.icon
          ? await cardImageFromIcon(item.icon)
          : await generatedCardImage(item.title || item.url, item.url);
        if (file) body.set('image', file, 'portada.webp');

        const response = await fetch('/api/entries', { method: 'POST', body });
        if (response.ok) {
          created += 1;
        } else {
          failed += 1;
        }
      } catch {
        failed += 1;
      }
    }

    await loadEntries();
    const parts = [`${created} importados`];
    if (failed) parts.push(`${failed} con error`);
    setStatus(importStatus, `${parts.join(', ')}.`, failed ? 'error' : 'ok');
  } catch (error) {
    setStatus(importStatus, error.message || 'No se pudo leer el archivo.', 'error');
  } finally {
    importing = false;
    importButton.disabled = false;
    importFile.value = '';
  }
}

/* Eventos */

openAddButton.addEventListener('click', openCreate);
closeButton.addEventListener('click', closeDialog);
cancelButton.addEventListener('click', closeDialog);

dialog.addEventListener('click', (event) => {
  if (event.target === dialog) closeDialog();
});

groupSelect.addEventListener('change', () => {
  const isNew = groupSelect.value === NEW_GROUP_VALUE;
  groupNameInput.hidden = !isNew;
  if (isNew) groupNameInput.focus();
});

imageInput.addEventListener('change', () => {
  chooseImage(imageInput.files?.[0] ?? null);
});

clearImageButton.addEventListener('click', clearImage);

importButton.addEventListener('click', () => {
  if (!importing) importFile.click();
});

importFile.addEventListener('change', async () => {
  const file = importFile.files?.[0];
  if (!file) return;
  const text = await file.text();
  await runImport(text);
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const title = titleInput.value.trim();
  const url = urlInput.value.trim();

  if (!title || !url) {
    setStatus(modalStatus, 'Completa el título y la URL para guardar el acceso.', 'error');
    (title ? urlInput : titleInput).focus();
    return;
  }

  let groupName = '';
  if (groupSelect.value === NEW_GROUP_VALUE) {
    groupName = groupNameInput.value.trim();
    if (!groupName) {
      setStatus(modalStatus, 'Escribe un nombre para el grupo nuevo.', 'error');
      groupNameInput.focus();
      return;
    }
  } else if (groupSelect.value) {
    const group = groups.find((item) => String(item.id) === groupSelect.value);
    groupName = group ? group.name : '';
  }

  const chosen = imageInput.files?.[0] ?? null;
  submitButton.disabled = true;
  setStatus(modalStatus, 'Guardando…');

  try {
    const prepared = chosen ? await shrinkImage(chosen) : null;
    if (prepared && prepared.size > MAX_IMAGE_BYTES) {
      setStatus(modalStatus, 'La imagen supera los 2 MB. Elige una más ligera.', 'error');
      return;
    }

    const body = new FormData();
    body.set('title', title);
    body.set('url', url);
    body.set('groupName', groupName);
    if (prepared) {
      body.set('image', prepared, prepared.name || 'imagen');
    } else if (removeImage) {
      body.set('removeImage', '1');
    }

    const target = editingId ? `/api/entries/${encodeURIComponent(editingId)}` : '/api/entries';
    const method = editingId ? 'PATCH' : 'POST';
    const response = await fetch(target, { method, body });
    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.entry) {
      setStatus(modalStatus, data.message ?? 'No se pudo guardar el acceso.', 'error');
      return;
    }

    if (editingId) {
      entries = entries.map((item) => (item.id === data.entry.id ? data.entry : item));
      groups = Array.isArray(data.groups) ? data.groups : groups;
      render();
      closeDialog();
    } else {
      closeDialog();
      await loadEntries();
    }
  } catch {
    setStatus(modalStatus, 'No se pudo guardar el acceso. Revisa tu conexión.', 'error');
  } finally {
    submitButton.disabled = false;
  }
});

loadEntries();
