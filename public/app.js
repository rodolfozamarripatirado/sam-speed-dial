const openAddButton = document.getElementById('open-add');
const dialog = document.getElementById('add-dialog');
const form = document.getElementById('add-form');
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
const submitButton = form.querySelector('button[type="submit"]');
const sections = document.getElementById('sections');
const emptyState = document.getElementById('empty');
const loadError = document.getElementById('load-error');
const countEl = document.getElementById('count');

const NEW_GROUP_VALUE = '__new';
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_SIDE = 1200;

let entries = [];
let groups = [];
let previewUrl = null;

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

  const title = document.createElement('span');
  title.className = 'tile-title';
  title.textContent = entry.title;

  const hostLabel = document.createElement('span');
  hostLabel.className = 'tile-host';
  hostLabel.textContent = host;

  link.append(media, title, hostLabel);

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'tile-delete';
  remove.textContent = '×';
  remove.setAttribute('aria-label', `Eliminar ${entry.title}`);
  remove.addEventListener('click', () => removeEntry(entry));

  item.append(link, remove);
  return item;
}

function buildSection(group, items) {
  const wrapper = document.createElement('section');
  wrapper.className = 'group-block';

  if (group) {
    const heading = document.createElement('h3');
    heading.className = 'group-title';
    heading.textContent = group.name;

    const total = document.createElement('span');
    total.className = 'group-count';
    total.textContent = items.length === 1 ? '1 acceso' : `${items.length} accesos`;
    heading.append(total);

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

  const blocks = [];
  if (ungrouped.length > 0) blocks.push(buildSection(null, ungrouped));

  for (const group of [...groups].sort((a, b) => a.position - b.position || a.id - b.id)) {
    const items = grouped.get(group.id);
    if (items && items.length > 0) blocks.push(buildSection(group, items));
  }

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

function releasePreviewUrl() {
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
    previewUrl = null;
  }
}

function resetImage() {
  releasePreviewUrl();
  imageInput.value = '';
  imagePreviewImg.removeAttribute('src');
  imagePreview.hidden = true;
}

function showImagePreview(file) {
  // Solo se libera la URL anterior: vaciar `imageInput.value` aquí descartaría
  // el archivo elegido y la tarjeta se guardaría sin imagen.
  releasePreviewUrl();

  if (!file) {
    imagePreviewImg.removeAttribute('src');
    imagePreview.hidden = true;
    return;
  }

  previewUrl = URL.createObjectURL(file);
  imagePreviewImg.src = previewUrl;
  imagePreview.hidden = false;
}

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

function openDialog() {
  form.reset();
  resetImage();
  setStatus(modalStatus, '');
  populateGroups();
  if (typeof dialog.showModal === 'function') {
    dialog.showModal();
  } else {
    dialog.setAttribute('open', '');
  }
  titleInput.focus();
}

function closeDialog() {
  resetImage();
  if (typeof dialog.close === 'function') {
    dialog.close();
  } else {
    dialog.removeAttribute('open');
  }
}

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

openAddButton.addEventListener('click', openDialog);
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
  showImagePreview(imageInput.files?.[0] ?? null);
});

clearImageButton.addEventListener('click', resetImage);

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const title = titleInput.value.trim();
  const url = urlInput.value.trim();

  if (!title || !url) {
    setStatus(modalStatus, 'Completa el título y la URL para guardar el acceso.', 'error');
    (title ? urlInput : titleInput).focus();
    return;
  }

  let groupName = null;
  if (groupSelect.value === NEW_GROUP_VALUE) {
    groupName = groupNameInput.value.trim();
    if (!groupName) {
      setStatus(modalStatus, 'Escribe un nombre para el grupo nuevo.', 'error');
      groupNameInput.focus();
      return;
    }
  } else if (groupSelect.value) {
    const group = groups.find((item) => String(item.id) === groupSelect.value);
    groupName = group ? group.name : null;
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
    if (groupName) body.set('groupName', groupName);
    if (prepared) body.set('image', prepared, prepared.name || 'imagen');

    const response = await fetch('/api/entries', { method: 'POST', body });
    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.entry) {
      setStatus(modalStatus, data.message ?? 'No se pudo guardar el acceso.', 'error');
      return;
    }

    closeDialog();
    await loadEntries();
  } catch {
    setStatus(modalStatus, 'No se pudo guardar el acceso. Revisa tu conexión.', 'error');
  } finally {
    submitButton.disabled = false;
  }
});

loadEntries();
