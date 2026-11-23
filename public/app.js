const openAddButton = document.getElementById('open-add');
const dialog = document.getElementById('add-dialog');
const form = document.getElementById('add-form');
const modalTitle = document.getElementById('modal-title');
const submitButton = document.getElementById('submit-entry');
const closeButton = document.getElementById('close-add');
const cancelButton = document.getElementById('cancel-add');
const titleInput = document.getElementById('title');
const titleLabel = document.getElementById('title-label');
const urlInput = document.getElementById('url');
const fieldUrl = document.getElementById('field-url');
const fieldImage = document.getElementById('field-image');
const fieldPosition = document.getElementById('field-position');
const groupSelect = document.getElementById('group-select');
const groupNameInput = document.getElementById('group-name');
const imageInput = document.getElementById('image');
const imagePreview = document.getElementById('image-preview');
const imagePreviewImg = document.getElementById('image-preview-img');
const clearImageButton = document.getElementById('clear-image');
const sizeSelect = document.getElementById('size');
const moveBeforeButton = document.getElementById('move-before');
const moveAfterButton = document.getElementById('move-after');
const modalStatus = document.getElementById('modal-status');
const sections = document.getElementById('sections');
const emptyState = document.getElementById('empty');
const loadError = document.getElementById('load-error');
const countEl = document.getElementById('count');
const importButton = document.getElementById('import-bookmarks');
const importFile = document.getElementById('import-file');
const importStatus = document.getElementById('import-status');
const groupModeButton = document.getElementById('group-mode');
const selectionBar = document.getElementById('selection-bar');
const selectionCount = document.getElementById('selection-count');
const selectionCreate = document.getElementById('selection-create');
const selectionCancel = document.getElementById('selection-cancel');
const groupDialog = document.getElementById('group-dialog');
const groupDialogForm = document.getElementById('group-dialog-form');
const groupDialogHint = document.getElementById('group-dialog-hint');
const groupDialogName = document.getElementById('group-dialog-name');
const groupDialogStatus = document.getElementById('group-dialog-status');
const groupDialogSubmit = document.getElementById('group-dialog-submit');
const closeGroupDialog = document.getElementById('close-group-dialog');
const cancelGroupDialog = document.getElementById('cancel-group-dialog');
const folderDialog = document.getElementById('folder-dialog');
const folderTitle = document.getElementById('folder-title');
const folderSubtitle = document.getElementById('folder-subtitle');
const folderGrid = document.getElementById('folder-grid');
const folderEmpty = document.getElementById('folder-empty');
const folderEditButton = document.getElementById('folder-edit');
const closeFolderButton = document.getElementById('close-folder');

const NEW_GROUP_VALUE = '__new';
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_SIDE = 1200;

let entries = [];
let groups = [];

let editingId = null;
let editingFolder = false;
let existingImageUrl = null;
let removeImage = false;
let previewObjectUrl = null;
let importing = false;

let selecting = false;
const selected = new Set();
let openFolderId = null;

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
  const first = Array.from((title || '').trim())[0] ?? '?';
  return first.toUpperCase();
}

function sortedEntries() {
  return [...entries].sort((a, b) => a.position - b.position || a.id - b.id);
}

function childrenOf(parentId) {
  return sortedEntries().filter((entry) => entry.parentId === parentId);
}

function entryById(id) {
  return entries.find((entry) => entry.id === Number(id)) || null;
}

function sizeToKey(span) {
  const value = Number(span) || 1;
  if (value === 2) return 'wide';
  if (value === 3) return 'big';
  return 'normal';
}

function applySize(item, span) {
  const key = sizeToKey(span);
  if (key === 'wide') item.classList.add('size-wide');
  if (key === 'big') item.classList.add('size-big');
}

function buildIcon(title, host) {
  const icon = document.createElement('span');
  icon.className = `tile-icon tone-${toneFor(host)}`;
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = monogram(title);
  return icon;
}

function buildActions(entry) {
  const actions = document.createElement('div');
  actions.className = 'tile-actions';

  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'tile-action';
  edit.textContent = '✎';
  edit.setAttribute(
    'aria-label',
    entry.isFolder ? `Editar la tarjeta agrupada ${entry.title}` : `Editar ${entry.title} y su imagen`,
  );
  edit.addEventListener('click', () => openEdit(entry));

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'tile-action tile-delete';
  remove.textContent = '×';
  remove.setAttribute('aria-label', entry.isFolder ? `Deshacer la agrupación ${entry.title}` : `Eliminar ${entry.title}`);
  remove.addEventListener('click', () => removeEntry(entry));

  actions.append(edit, remove);
  return actions;
}

function buildEntryTile(entry) {
  const host = hostOf(entry.url);

  const item = document.createElement('li');
  item.className = 'tile';
  item.dataset.id = String(entry.id);
  applySize(item, entry.span);

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
    media.append(buildIcon(entry.title, host));
  }

  link.append(media);
  item.append(link, buildActions(entry));
  return item;
}

/**
 * Tarjeta agrupada: una sola tarjeta que muestra una mezcla de las fotos de
 * las tarjetas que lleva dentro y, al pulsarla, abre su contenido en un modal.
 */
function buildFolderTile(folder) {
  const children = childrenOf(folder.id);
  const count = children.length;

  const item = document.createElement('li');
  item.className = 'tile tile-folder-wrap';
  item.dataset.id = String(folder.id);
  applySize(item, folder.span);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tile-link tile-folder';
  button.title = `${folder.title} — ${count === 1 ? '1 acceso' : `${count} accesos`} adentro`;
  button.setAttribute(
    'aria-label',
    `${folder.title}: tarjeta agrupada con ${count === 1 ? '1 acceso' : `${count} accesos`}`,
  );
  button.setAttribute('aria-haspopup', 'dialog');
  button.addEventListener('click', () => openFolder(folder));

  const media = document.createElement('span');
  media.className = 'tile-media';

  const collage = document.createElement('span');
  collage.className = 'collage';
  collage.dataset.count = String(Math.min(4, Math.max(1, count)));

  for (const child of children.slice(0, 4)) {
    const cell = document.createElement('span');
    cell.className = 'collage-cell';
    if (child.imageUrl) {
      const photo = document.createElement('img');
      photo.src = child.imageUrl;
      photo.alt = '';
      photo.loading = 'lazy';
      photo.decoding = 'async';
      cell.append(photo);
    } else {
      cell.append(buildIcon(child.title, hostOf(child.url)));
    }
    collage.append(cell);
  }

  media.append(collage);

  const badge = document.createElement('span');
  badge.className = 'tile-badge';
  badge.textContent = String(count);
  badge.setAttribute('aria-hidden', 'true');
  media.append(badge);

  button.append(media);
  item.append(button, buildActions(folder));
  return item;
}

function buildTile(entry) {
  return entry.isFolder ? buildFolderTile(entry) : buildEntryTile(entry);
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
    total.textContent = items.length === 1 ? '1 tarjeta' : `${items.length} tarjetas`;

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
  const ordered = sortedEntries();
  const topLevel = ordered.filter((entry) => entry.parentId === null || entry.parentId === undefined);
  const grouped = new Map();
  const ungrouped = [];

  for (const entry of topLevel) {
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
  emptyState.hidden = ordered.length > 0;

  const total = ordered.filter((entry) => !entry.isFolder).length;
  countEl.textContent = total === 1 ? '1 acceso' : `${total} accesos`;

  if (selecting) syncSelection();
  refreshFolderModal();
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
  const message = entry.isFolder
    ? `¿Deshacer "${entry.title}"?\n\nSus ${childrenOf(entry.id).length} tarjetas volverán a su grupo.`
    : `¿Eliminar "${entry.title}"?`;
  if (!window.confirm(message)) return;

  try {
    const response = await fetch(`/api/entries/${encodeURIComponent(entry.id)}`, { method: 'DELETE' });
    if (!response.ok && response.status !== 404) throw new Error('no se pudo eliminar');
    await loadEntries();
  } catch {
    window.alert('No se pudo completar la acción. Intenta de nuevo.');
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

async function moveEntry(entry, direction) {
  try {
    const response = await fetch(`/api/entries/${encodeURIComponent(entry.id)}/move`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ direction }),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !Array.isArray(data.entries)) {
      throw new Error('no se pudo mover la tarjeta');
    }

    entries = data.entries;
    render();
  } catch {
    window.alert('No se pudo mover la tarjeta. Intenta de nuevo.');
  }
}

/* Modo agrupar */

function syncSelection() {
  const total = selected.size;
  selectionCount.textContent = total === 1 ? '1 tarjeta elegida' : `${total} tarjetas elegidas`;
  selectionCreate.disabled = total < 2;
  selectionCreate.textContent = total >= 2 ? `Crear tarjeta con ${total}` : 'Crear tarjeta agrupada';

  for (const item of sections.querySelectorAll('.tile')) {
    const id = Number(item.dataset.id);
    item.classList.toggle('is-selected', selected.has(id));
  }
}

function setSelecting(value) {
  selecting = value;
  document.body.classList.toggle('is-selecting', value);
  selectionBar.hidden = !value;
  groupModeButton.textContent = value ? 'Salir de agrupar' : 'Agrupar tarjetas';
  groupModeButton.setAttribute('aria-pressed', String(value));
  if (!value) {
    selected.clear();
    for (const item of sections.querySelectorAll('.tile')) item.classList.remove('is-selected');
  }
  syncSelection();
}

function openGroupDialog() {
  if (selected.size < 2) return;

  groupDialogForm.reset();
  setStatus(groupDialogStatus, '');

  const ids = orderedSelectedIds();
  const first = entryById(ids[0]);
  const group =
    first && first.groupId !== null && first.groupId !== undefined
      ? groups.find((item) => item.id === first.groupId)
      : null;

  groupDialogHint.textContent = group
    ? `Se guardará en el grupo «${group.name}», el de la primera tarjeta elegida.`
    : 'Se guardará sin grupo, arriba del todo.';

  openModal(groupDialog);
  groupDialogName.focus();
}

function orderedSelectedIds() {
  return sortedEntries()
    .filter((entry) => selected.has(entry.id))
    .map((entry) => entry.id);
}

function openFolder(folder) {
  if (selecting) return;
  openFolderId = folder.id;
  openModal(folderDialog);
  refreshFolderModal();
}

function refreshFolderModal() {
  if (!folderDialog.open) return;

  const folder = openFolderId ? entryById(openFolderId) : null;
  if (!folder || !folder.isFolder) {
    closeModal(folderDialog);
    openFolderId = null;
    return;
  }

  const children = childrenOf(folder.id);
  folderTitle.textContent = folder.title;
  folderSubtitle.textContent = children.length === 1 ? '1 acceso adentro' : `${children.length} accesos adentro`;
  folderGrid.replaceChildren(...children.map(buildEntryTile));
  folderEmpty.hidden = children.length > 0;
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

/* Modales */

function openModal(element) {
  if (element.open) return;
  if (typeof element.showModal === 'function') {
    element.showModal();
  } else {
    element.setAttribute('open', '');
  }
}

function closeModal(element) {
  if (!element.open && !element.hasAttribute('open')) return;
  if (typeof element.close === 'function') {
    element.close();
  } else {
    element.removeAttribute('open');
  }
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

function closeEntryDialog() {
  resetImageState();
  editingId = null;
  editingFolder = false;
  closeModal(dialog);
}

function openCreate() {
  form.reset();
  resetImageState();
  setStatus(modalStatus, '');
  populateGroups();
  groupNameInput.value = '';
  editingId = null;
  editingFolder = false;
  titleLabel.textContent = 'Título';
  titleInput.placeholder = 'Ej. Panel de SAM';
  fieldUrl.hidden = false;
  fieldImage.hidden = false;
  fieldPosition.hidden = true;
  sizeSelect.value = 'normal';
  modalTitle.textContent = 'Nuevo acceso';
  submitButton.textContent = 'Guardar';
  openModal(dialog);
  titleInput.focus();
}

function openEdit(entry) {
  form.reset();
  resetImageState();
  setStatus(modalStatus, '');
  populateGroups(entry.groupId === null || entry.groupId === undefined ? '' : String(entry.groupId));
  groupNameInput.value = '';
  editingId = entry.id;
  editingFolder = Boolean(entry.isFolder);
  existingImageUrl = entry.imageUrl || null;
  titleInput.value = entry.title;
  urlInput.value = entry.url || '';
  sizeSelect.value = sizeToKey(entry.span);
  titleLabel.textContent = editingFolder ? 'Nombre de la tarjeta agrupada' : 'Título';
  titleInput.placeholder = editingFolder ? 'Ej. Educación' : 'Ej. Panel de SAM';
  fieldUrl.hidden = editingFolder;
  fieldImage.hidden = editingFolder;
  fieldPosition.hidden = false;
  updatePreview();
  modalTitle.textContent = editingFolder ? 'Editar tarjeta agrupada' : 'Editar acceso';
  submitButton.textContent = 'Guardar cambios';
  openModal(dialog);
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
closeButton.addEventListener('click', closeEntryDialog);
cancelButton.addEventListener('click', closeEntryDialog);

dialog.addEventListener('click', (event) => {
  if (event.target === dialog) closeEntryDialog();
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

moveBeforeButton.addEventListener('click', () => {
  const entry = entryById(editingId);
  if (entry) moveEntry(entry, 'up');
});

moveAfterButton.addEventListener('click', () => {
  const entry = entryById(editingId);
  if (entry) moveEntry(entry, 'down');
});

groupModeButton.addEventListener('click', () => setSelecting(!selecting));
selectionCancel.addEventListener('click', () => setSelecting(false));
selectionCreate.addEventListener('click', openGroupDialog);

sections.addEventListener('click', (event) => {
  if (!selecting) return;
  const item = event.target.closest('.tile');
  if (!item || item.classList.contains('tile-folder-wrap')) return;
  event.preventDefault();

  const id = Number(item.dataset.id);
  if (selected.has(id)) selected.delete(id);
  else selected.add(id);
  syncSelection();
});

groupDialogForm.addEventListener('submit', async (event) => {
  event.preventDefault();

  const name = groupDialogName.value.trim();
  if (!name) {
    setStatus(groupDialogStatus, 'Escribe un nombre para la tarjeta agrupada.', 'error');
    groupDialogName.focus();
    return;
  }

  groupDialogSubmit.disabled = true;
  setStatus(groupDialogStatus, 'Agrupando…');

  try {
    const response = await fetch('/api/folders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, entryIds: orderedSelectedIds() }),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      setStatus(groupDialogStatus, data.message ?? 'No se pudo agrupar las tarjetas.', 'error');
      return;
    }

    closeModal(groupDialog);
    setSelecting(false);
    await loadEntries();
  } catch {
    setStatus(groupDialogStatus, 'No se pudo agrupar. Revisa tu conexión.', 'error');
  } finally {
    groupDialogSubmit.disabled = false;
  }
});

closeGroupDialog.addEventListener('click', () => closeModal(groupDialog));
cancelGroupDialog.addEventListener('click', () => closeModal(groupDialog));
groupDialog.addEventListener('click', (event) => {
  if (event.target === groupDialog) closeModal(groupDialog);
});

closeFolderButton.addEventListener('click', () => closeModal(folderDialog));
folderDialog.addEventListener('click', (event) => {
  if (event.target === folderDialog) closeModal(folderDialog);
});
folderDialog.addEventListener('close', () => {
  openFolderId = null;
});

folderEditButton.addEventListener('click', () => {
  const folder = openFolderId ? entryById(openFolderId) : null;
  if (folder) openEdit(folder);
});

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

  if (!title) {
    setStatus(modalStatus, editingFolder ? 'Escribe un nombre para la tarjeta agrupada.' : 'Completa el título.', 'error');
    titleInput.focus();
    return;
  }

  if (!editingFolder && !url) {
    setStatus(modalStatus, 'Completa la URL para guardar el acceso.', 'error');
    urlInput.focus();
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

  submitButton.disabled = true;
  setStatus(modalStatus, 'Guardando…');

  try {
    if (editingFolder) {
      const body = new FormData();
      body.set('name', title);
      body.set('groupName', groupName);
      body.set('size', sizeSelect.value);

      const response = await fetch(`/api/folders/${encodeURIComponent(editingId)}`, { method: 'PATCH', body });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.folder) {
        setStatus(modalStatus, data.message ?? 'No se pudo guardar la tarjeta agrupada.', 'error');
        return;
      }

      closeEntryDialog();
      await loadEntries();
      return;
    }

    const chosen = imageInput.files?.[0] ?? null;
    const prepared = chosen ? await shrinkImage(chosen) : null;
    if (prepared && prepared.size > MAX_IMAGE_BYTES) {
      setStatus(modalStatus, 'La imagen supera los 2 MB. Elige una más ligera.', 'error');
      return;
    }

    const body = new FormData();
    body.set('title', title);
    body.set('url', url);
    body.set('groupName', groupName);
    body.set('size', sizeSelect.value);
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
      closeEntryDialog();
    } else {
      closeEntryDialog();
      await loadEntries();
    }
  } catch {
    setStatus(modalStatus, 'No se pudo guardar. Revisa tu conexión.', 'error');
  } finally {
    submitButton.disabled = false;
  }
});

loadEntries();
