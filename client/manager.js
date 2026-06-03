const tokenForm = document.querySelector('[data-token-form]');
const loginStatus = document.querySelector('[data-login-status]');
const statusElement = document.querySelector('[data-status]');
const sectionTitle = document.querySelector('[data-section-title]');
const managerSectionButtons = document.querySelectorAll('[data-manager-section]');
const managerSections = document.querySelectorAll('[data-section]');
const settingsForm = document.querySelector('[data-settings-form]');
const mapForm = document.querySelector('[data-map-form]');
const mapList = document.querySelector('[data-map-list]');
const mapSelect = document.querySelector('[data-map-select]');
const mapExitSelects = document.querySelectorAll('[data-map-exit]');
const taxonomyForms = document.querySelectorAll('[data-taxonomy-form]');
const logoutButton = document.querySelector('[data-logout]');
const migrationList = document.querySelector('[data-migration-list]');
const refreshMigrationsButton = document.querySelector('[data-refresh-migrations]');
const applyPendingButton = document.querySelector('[data-apply-pending]');
const editorMapSelect = document.querySelector('[data-editor-map]');
const editorCanvas = document.querySelector('[data-map-editor]');
const editorContext = editorCanvas.getContext('2d');
const editorModeButtons = document.querySelectorAll('[data-editor-mode]');
const editorSaveButton = document.querySelector('[data-editor-save]');
const editorZoomInButton = document.querySelector('[data-editor-zoom-in]');
const editorZoomOutButton = document.querySelector('[data-editor-zoom-out]');
const editorBackgroundInput = document.querySelector('[data-editor-background]');
const cellParamLevelSelect = document.querySelector('[data-cell-param-level]');
const backgroundPreview = document.querySelector('[data-background-preview]');
const raceSpritePackageInput = document.querySelector('[data-race-sprite-package]');
const teleportForm = document.querySelector('[data-teleport-form]');
const teleportTargetSelect = document.querySelector('[data-teleport-target]');
const teleportList = document.querySelector('[data-teleport-list]');
const newMapButton = document.querySelector('[data-new-map]');
const deleteMapButton = document.querySelector('[data-delete-map]');
const mapTabButtons = document.querySelectorAll('[data-map-tab]');
const mapTabPanels = document.querySelectorAll('[data-map-tab-panel]');

const SPEED_LEVEL_MULTIPLIERS = {
  1: 0.5,
  2: 0.75,
  3: 1,
  4: 1.25,
  5: 1.5,
};

let managerToken = localStorage.getItem('managerToken') || '';
let state = {
  settings: {},
  maps: [],
  races: [],
  classes: [],
};
let migrations = [];
let selectedSection = 'maps';
let selectedMapId = null;
let editor = {
  map: null,
  data: createEmptyMapData(),
  mode: 'collision',
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
  isDragging: false,
  dragButton: 0,
  brushAddsCollision: true,
  paintedCells: new Set(),
  backgroundImage: null,
};

if (managerToken) {
  unlock();
  loadManagerData();
}

tokenForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const token = new FormData(tokenForm).get('token');
  loginStatus.textContent = 'Validando...';

  try {
    const response = await fetch('/api/manager/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const data = await response.json();

    if (!response.ok) {
      loginStatus.textContent = data.error || 'Token invalido.';
      return;
    }

    managerToken = token;
    localStorage.setItem('managerToken', managerToken);
    unlock();
    await loadManagerData();
  } catch {
    loginStatus.textContent = 'Nao foi possivel validar o token.';
  }
});

logoutButton.addEventListener('click', () => {
  localStorage.removeItem('managerToken');
  managerToken = '';
  document.body.classList.add('locked');
});

for (const button of managerSectionButtons) {
  button.addEventListener('click', () => setManagerSection(button.dataset.managerSection));
}

for (const button of mapTabButtons) {
  button.addEventListener('click', () => setMapTab(button.dataset.mapTab));
}

newMapButton.addEventListener('click', () => {
  selectedMapId = null;
  mapForm.reset();
  mapForm.elements.id.value = '';
  setDefaultMapFormValues();
  renderMaps();
  setMapTab('settings');
});

deleteMapButton.addEventListener('click', deleteSelectedMap);

settingsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await save('/api/manager/settings', 'PUT', formToObject(settingsForm));
});

mapForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clampMapEntryFields();
  const existingId = Number(mapForm.elements.id.value || 0);
  await save('/api/manager/maps', 'POST', formToObject(mapForm));
  selectedMapId = existingId || state.maps.at(-1)?.id || selectedMapId;
  const selectedMap = getSelectedMap();
  if (selectedMap) {
    fillMapForm(selectedMap);
    await selectMap(selectedMap.id);
  }
});

for (const form of taxonomyForms) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (form.dataset.taxonomyForm === 'races') {
      await saveRaceForm(form);
      return;
    }

    await save(`/api/manager/${form.dataset.taxonomyForm}`, 'POST', formToObject(form));
    form.reset();
    form.elements.id.value = '';
  });
}

refreshMigrationsButton.addEventListener('click', loadMigrations);
applyPendingButton.addEventListener('click', applyPendingMigrations);
editorMapSelect.addEventListener('change', () => selectMap(Number(editorMapSelect.value)));
editorSaveButton.addEventListener('click', saveMapEditor);
editorZoomInButton.addEventListener('click', () => setEditorZoom(editor.zoom * 1.25));
editorZoomOutButton.addEventListener('click', () => setEditorZoom(editor.zoom / 1.25));
editorBackgroundInput.addEventListener('change', uploadMapBackground);
mapForm.elements.widthCells.addEventListener('change', clampMapEntryFields);
mapForm.elements.heightCells.addEventListener('change', clampMapEntryFields);

for (const button of editorModeButtons) {
  button.addEventListener('click', () => setEditorMode(button.dataset.editorMode));
}

teleportForm.addEventListener('submit', (event) => {
  event.preventDefault();
  upsertTeleportPoint(formToObject(teleportForm));
});

editorCanvas.addEventListener('contextmenu', (event) => event.preventDefault());
editorCanvas.addEventListener('pointerdown', beginEditorDrag);
editorCanvas.addEventListener('pointermove', continueEditorDrag);
window.addEventListener('pointerup', endEditorDrag);
editorCanvas.addEventListener('wheel', handleEditorWheel, { passive: false });
window.addEventListener('resize', renderEditor);

async function loadManagerData() {
  await loadMigrations();
  await loadState();
}

async function loadState() {
  setStatus('Carregando...');
  const response = await fetch('/api/manager/state', {
    headers: getAuthHeaders(),
  });
  const data = await response.json();

  if (!response.ok) {
    setStatus(data.error || 'Nao foi possivel carregar.');
    return;
  }

  state = data;
  renderState();
  setStatus('Pronto.');
}

async function loadMigrations() {
  setStatus('Carregando migrations...');
  const response = await fetch('/api/manager/migrations', {
    headers: getAuthHeaders(),
  });
  const data = await response.json();

  if (!response.ok) {
    setStatus(data.error || 'Nao foi possivel carregar migrations.');
    return;
  }

  migrations = data.migrations || [];
  renderMigrations();
  setStatus('Migrations carregadas.');
}

async function applyMigration(filename) {
  setStatus(`Aplicando ${filename}...`);
  const response = await fetch('/api/manager/migrations/apply', {
    method: 'POST',
    headers: {
      ...getAuthHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ filename }),
  });
  const data = await response.json();

  if (!response.ok) {
    setStatus(data.error || 'Nao foi possivel aplicar migration.');
    return;
  }

  migrations = data.migrations || [];
  renderMigrations();
  await loadState();
  setStatus(`${filename} aplicada.`);
}

async function applyPendingMigrations() {
  const pending = migrations.filter((migration) => !migration.applied);

  for (const migration of pending) {
    await applyMigration(migration.filename);
  }

  if (pending.length === 0) {
    setStatus('Nao ha migrations pendentes.');
  }
}

async function save(url, method, payload) {
  setStatus('Salvando...');
  const response = await fetch(url, {
    method,
    headers: {
      ...getAuthHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json();

  if (!response.ok) {
    setStatus(data.error || 'Nao foi possivel salvar.');
    return;
  }

  state = data;
  renderState();
  setStatus('Salvo.');
}

async function deleteSelectedMap() {
  const map = getSelectedMap();

  if (!map) {
    setStatus('Selecione um mapa para remover.');
    return;
  }

  if (!window.confirm(`Remover o mapa "${map.name}"?`)) {
    return;
  }

  setStatus('Removendo mapa...');
  const response = await fetch(`/api/manager/maps/${encodeURIComponent(map.id)}`, {
    method: 'DELETE',
    headers: getAuthHeaders(),
  });
  const data = await response.json();

  if (!response.ok) {
    setStatus(data.error || 'Nao foi possivel remover o mapa.');
    return;
  }

  state = data;
  selectedMapId = state.settings.defaultMapId || state.maps[0]?.id || null;
  editor.map = null;
  editor.data = createEmptyMapData();
  renderState();
  setStatus('Mapa removido.');
}

function setManagerSection(section) {
  selectedSection = section;

  for (const button of managerSectionButtons) {
    button.classList.toggle('active', button.dataset.managerSection === section);
  }

  for (const panel of managerSections) {
    panel.classList.toggle('active', panel.dataset.section === section);
  }

  const activeButton = [...managerSectionButtons].find((button) => button.dataset.managerSection === section);
  sectionTitle.textContent = activeButton?.textContent || 'Gerente';

  if (section === 'maps') {
    renderEditor();
  }
}

function setMapTab(tab) {
  for (const button of mapTabButtons) {
    button.classList.toggle('active', button.dataset.mapTab === tab);
  }

  for (const panel of mapTabPanels) {
    panel.classList.toggle('active', panel.dataset.mapTabPanel === tab);
  }

  if (tab === 'editor') {
    renderEditor();
  }
}

async function selectMap(mapId) {
  const map = state.maps.find((item) => item.id === Number(mapId));

  if (!map) {
    return;
  }

  selectedMapId = map.id;
  fillMapForm(map);
  editorMapSelect.value = map.id;
  renderMaps();
  renderBackgroundPreview();
  await loadMapEditor(map.id);
}

function getSelectedMap() {
  return state.maps.find((map) => map.id === Number(selectedMapId)) || null;
}

function renderState() {
  if (!selectedMapId && state.maps.length > 0) {
    selectedMapId = state.settings.defaultMapId || state.maps[0].id;
  }

  settingsForm.elements.gameName.value = state.settings.gameName || '';
  renderMapOptions(mapSelect, false);
  renderMapOptions(editorMapSelect, false);
  renderMapOptions(teleportTargetSelect, false);
  mapSelect.value = state.settings.defaultMapId || '';
  editorMapSelect.value = selectedMapId || state.settings.defaultMapId || state.maps[0]?.id || '';
  renderMapOptionsForExits();
  const selectedMap = getSelectedMap();
  if (selectedMap) {
    fillMapForm(selectedMap);
  } else {
    setDefaultMapFormValues();
  }
  renderMaps();
  renderBackgroundPreview();
  renderTaxonomy('races');
  renderTaxonomy('classes');

  if (state.maps.length > 0 && (!editor.map || editor.map.id !== Number(editorMapSelect.value))) {
    loadMapEditor(Number(editorMapSelect.value));
  }
}

function renderMigrations() {
  migrationList.innerHTML = '';

  if (migrations.length === 0) {
    migrationList.innerHTML = '<p class="status">Nenhuma migration encontrada.</p>';
    return;
  }

  for (const migration of migrations) {
    const row = document.createElement('div');
    row.className = 'migration-row';

    const name = document.createElement('strong');
    name.textContent = migration.filename;

    const badge = document.createElement('span');
    badge.className = migration.applied ? 'badge ok' : 'badge';
    badge.textContent = migration.applied ? 'Aplicada' : 'Pendente';

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = migration.applied ? 'Aplicada' : 'Aplicar';
    button.disabled = migration.applied;
    button.addEventListener('click', () => applyMigration(migration.filename));

    row.append(name, badge, button);
    migrationList.append(row);
  }
}

function renderMapOptions(select, includeEmpty) {
  select.innerHTML = includeEmpty ? '<option value="">Nenhum</option>' : '';

  for (const map of state.maps) {
    const option = document.createElement('option');
    option.value = map.id;
    option.textContent = `${map.id} - ${map.name}`;
    select.append(option);
  }
}

function renderMapOptionsForExits() {
  for (const select of mapExitSelects) {
    renderMapOptions(select, true);
  }
}

function renderMaps() {
  mapList.innerHTML = '';

  if (state.maps.length === 0) {
    mapList.innerHTML = '<p class="status">Nenhum mapa cadastrado.</p>';
    return;
  }

  for (const map of state.maps) {
    const item = document.createElement('button');
    item.className = `item${map.id === selectedMapId ? ' active' : ''}`;
    item.type = 'button';
    item.innerHTML = `
      <strong>${escapeHtml(map.name)}</strong>
      <span class="map-summary">${map.widthCells} x ${map.heightCells} celulas, ${map.cellSize}px por celula, velocidade ${map.movementSpeed || 5}</span>
      <small>Entrada: Col ${map.entryColumn} / Lin ${map.entryRow}</small>
      <small>Saidas: N ${map.exits.north || '-'} | L ${map.exits.east || '-'} | S ${map.exits.south || '-'} | O ${map.exits.west || '-'}</small>
    `;
    item.addEventListener('click', () => selectMap(map.id));
    mapList.append(item);
  }
}

function renderTaxonomy(type) {
  const list = document.querySelector(`[data-list="${type}"]`);
  const form = document.querySelector(`[data-taxonomy-form="${type}"]`);
  list.innerHTML = '';

  for (const item of state[type]) {
    const button = document.createElement('button');
    button.className = 'item';
    button.type = 'button';
    button.innerHTML = `
      <strong>${escapeHtml(item.name)}</strong>
      <small>${item.isActive ? 'Ativa' : 'Inativa'}</small>
      ${type === 'races' ? `<small>${item.spriteManifestPath ? 'Sprites importados' : 'Sem sprites'}</small>` : ''}
      <span>${escapeHtml(item.description || '')}</span>
    `;
    button.addEventListener('click', () => {
      form.elements.id.value = item.id;
      form.elements.name.value = item.name;
      form.elements.description.value = item.description || '';
      form.elements.isActive.value = String(item.isActive);
      if (form.elements.spritePackage) {
        form.elements.spritePackage.value = '';
      }
    });
    list.append(button);
  }
}

async function saveRaceForm(form) {
  const payload = formToObject(form);
  delete payload.spritePackage;
  setStatus('Salvando raca...');

  const response = await fetch('/api/manager/races', {
    method: 'POST',
    headers: {
      ...getAuthHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json();

  if (!response.ok) {
    setStatus(data.error || 'Nao foi possivel salvar a raca.');
    return;
  }

  state = data;
  renderState();

  const raceId = data.savedId || Number(payload.id || 0);
  const file = raceSpritePackageInput?.files?.[0] || null;

  if (file && raceId) {
    await uploadRaceSpritePackage(raceId, file);
  } else {
    setStatus('Raca salva.');
  }

  form.reset();
  form.elements.id.value = '';
}

async function uploadRaceSpritePackage(raceId, file) {
  setStatus('Importando sprites da raca...');
  const dataUrl = await fileToDataUrl(file);
  const response = await fetch('/api/manager/races/sprites', {
    method: 'POST',
    headers: {
      ...getAuthHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      raceId,
      dataUrl,
    }),
  });
  const data = await response.json();

  if (!response.ok) {
    setStatus(data.error || 'Nao foi possivel importar os sprites.');
    return;
  }

  state = data;
  renderState();
  setStatus('Sprites importados.');
}

function fillMapForm(map) {
  mapForm.elements.id.value = map.id;
  mapForm.elements.name.value = map.name;
  mapForm.elements.widthCells.value = map.widthCells;
  mapForm.elements.heightCells.value = map.heightCells;
  mapForm.elements.cellSize.value = map.cellSize;
  mapForm.elements.characterSize.value = map.characterSize;
  mapForm.elements.movementSpeed.value = map.movementSpeed || 5;
  mapForm.elements.showGrid.value = String(map.showGrid !== false);
  mapForm.elements.showCoordinates.value = String(map.showCoordinates !== false);
  mapForm.elements.entryColumn.value = map.entryColumn;
  mapForm.elements.entryRow.value = map.entryRow;
  mapForm.elements.backgroundColor.value = map.backgroundColor;
  mapForm.elements.northMapId.value = map.exits.north || '';
  mapForm.elements.eastMapId.value = map.exits.east || '';
  mapForm.elements.southMapId.value = map.exits.south || '';
  mapForm.elements.westMapId.value = map.exits.west || '';
}

function renderBackgroundPreview() {
  const map = getSelectedMap();

  if (!backgroundPreview) {
    return;
  }

  if (!map?.backgroundImagePath) {
    backgroundPreview.textContent = 'Nenhuma imagem vinculada.';
    return;
  }

  backgroundPreview.innerHTML = '';
  const image = document.createElement('img');
  image.alt = `Background de ${map.name}`;
  image.src = appendAssetVersion(map.backgroundImagePath, Date.now());
  backgroundPreview.append(image);
}

function setDefaultMapFormValues() {
  if (mapForm.elements.id.value) {
    return;
  }

  mapForm.elements.name.value ||= 'Novo mapa';
  mapForm.elements.widthCells.value ||= 100;
  mapForm.elements.heightCells.value ||= 100;
  mapForm.elements.cellSize.value ||= 16;
  mapForm.elements.characterSize.value ||= 64;
  mapForm.elements.movementSpeed.value ||= 5;
  mapForm.elements.showGrid.value ||= 'true';
  mapForm.elements.showCoordinates.value ||= 'true';
  mapForm.elements.entryColumn.value ||= Math.ceil(Number(mapForm.elements.widthCells.value || 100) / 2);
  mapForm.elements.entryRow.value ||= Math.ceil(Number(mapForm.elements.heightCells.value || 100) / 2);
  mapForm.elements.backgroundColor.value ||= '#15161d';
}

function clampMapEntryFields() {
  const widthCells = clamp(Number(mapForm.elements.widthCells.value || 1), 1, 5000);
  const heightCells = clamp(Number(mapForm.elements.heightCells.value || 1), 1, 5000);
  const entryColumn = Number(mapForm.elements.entryColumn.value || Math.ceil(widthCells / 2));
  const entryRow = Number(mapForm.elements.entryRow.value || Math.ceil(heightCells / 2));

  mapForm.elements.entryColumn.value = clamp(entryColumn, 1, widthCells);
  mapForm.elements.entryRow.value = clamp(entryRow, 1, heightCells);
}

async function loadMapEditor(mapId) {
  if (!mapId) {
    return;
  }

  setStatus('Carregando editor...');
  const response = await fetch(`/api/manager/map-editor?mapId=${encodeURIComponent(mapId)}`, {
    headers: getAuthHeaders(),
  });
  const data = await response.json();

  if (!response.ok) {
    setStatus(data.error || 'Nao foi possivel carregar o editor.');
    return;
  }

  editor.map = data.map;
  editor.data = normalizeClientMapData(data.data, editor.map);
  editor.zoom = 1;
  editor.offsetX = Math.max(0, ((editor.map.entryColumn - 12) * editor.map.cellSize));
  editor.offsetY = Math.max(0, ((editor.map.entryRow - 10) * editor.map.cellSize));
  editor.backgroundImage = null;
  preloadEditorBackground();
  renderTeleportFormDefaults();
  renderTeleportList();
  renderEditor();
  setStatus('Editor carregado.');
}

async function saveMapEditor() {
  if (!editor.map) {
    return;
  }

  setStatus('Salvando editor...');
  const response = await fetch('/api/manager/map-editor', {
    method: 'PUT',
    headers: {
      ...getAuthHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      mapId: editor.map.id,
      data: editor.data,
    }),
  });
  const data = await response.json();

  if (!response.ok) {
    setStatus(data.error || 'Nao foi possivel salvar o editor.');
    return;
  }

  editor.data = normalizeClientMapData(data.data, editor.map);
  renderTeleportList();
  renderEditor();
  setStatus('Editor salvo.');
}

async function uploadMapBackground() {
  const file = editorBackgroundInput.files[0];

  if (!editor.map || !file) {
    return;
  }

  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    setStatus('Use PNG, JPG ou WEBP.');
    return;
  }

  if (file.size > 6 * 1024 * 1024) {
    setStatus('Imagem muito grande. Limite de 6 MB.');
    return;
  }

  setStatus('Enviando imagem...');
  const dataUrl = await fileToDataUrl(file);
  const response = await fetch('/api/manager/map-background', {
    method: 'POST',
    headers: {
      ...getAuthHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      mapId: editor.map.id,
      dataUrl,
    }),
  });
  const data = await response.json();

  if (!response.ok) {
    setStatus(data.error || 'Nao foi possivel enviar a imagem.');
    return;
  }

  state = data;
  selectedMapId = editor.map.id;
  const updatedMap = state.maps.find((map) => map.id === editor.map.id);
  editor.map = updatedMap || editor.map;
  preloadEditorBackground(true);
  editorBackgroundInput.value = '';
  renderState();
  renderBackgroundPreview();
  setStatus('Imagem enviada.');
}

function setEditorMode(mode) {
  editor.mode = mode;

  for (const button of editorModeButtons) {
    button.classList.toggle('active', button.dataset.editorMode === mode);
  }

  editorCanvas.style.cursor = mode === 'pan' ? 'grab' : 'crosshair';
}

function setEditorZoom(zoom, anchor = null) {
  if (!editor.map) {
    return;
  }

  const nextZoom = clamp(zoom, 0.25, 8);

  if (anchor) {
    const before = screenToWorld(anchor.x, anchor.y);
    editor.zoom = nextZoom;
    const after = screenToWorld(anchor.x, anchor.y);
    editor.offsetX += before.x - after.x;
    editor.offsetY += before.y - after.y;
  } else {
    editor.zoom = nextZoom;
  }

  clampEditorOffset();
  renderEditor();
}

function beginEditorDrag(event) {
  if (!editor.map) {
    return;
  }

  event.preventDefault();
  editor.isDragging = true;
  editor.dragButton = event.button;
  editor.paintedCells.clear();
  ensureEditorDataCollections();

  if (Number.isInteger(event.pointerId)) {
    editorCanvas.setPointerCapture?.(event.pointerId);
  }

  if (editor.mode === 'pan' || event.button === 2) {
    editorCanvas.style.cursor = 'grabbing';
    return;
  }

  const cell = eventToCell(event);

  if (!cell) {
    return;
  }

  if (editor.mode === 'collision') {
    const key = getCellKey(cell.column, cell.row);
    editor.brushAddsCollision = !editor.data.blockedCellSet.has(key);
  }

  paintEditorCell(cell);
}

function continueEditorDrag(event) {
  if (!editor.map || !editor.isDragging) {
    return;
  }

  event.preventDefault();

  if (editor.mode === 'pan' || editor.dragButton === 2) {
    editor.offsetX -= event.movementX / editor.zoom;
    editor.offsetY -= event.movementY / editor.zoom;
    clampEditorOffset();
    renderEditor();
    return;
  }

  if (['collision', 'teleport', 'speed', 'level', 'erase'].includes(editor.mode)) {
    const cell = eventToCell(event);
    if (cell) {
      paintEditorCell(cell);
    }
  }
}

function endEditorDrag() {
  if (!editor.isDragging) {
    return;
  }

  editor.isDragging = false;
  editorCanvas.style.cursor = editor.mode === 'pan' ? 'grab' : 'crosshair';
}

function handleEditorWheel(event) {
  event.preventDefault();
  const rect = editorCanvas.getBoundingClientRect();
  const anchor = {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
  const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
  setEditorZoom(editor.zoom * factor, anchor);
}

function paintEditorCell(cell) {
  ensureEditorDataCollections();

  const key = getCellKey(cell.column, cell.row);

  if (editor.paintedCells.has(key)) {
    return;
  }

  editor.paintedCells.add(key);

  if (editor.mode === 'collision') {
    if (editor.brushAddsCollision) {
      editor.data.blockedCellSet.add(key);
    } else {
      editor.data.blockedCellSet.delete(key);
    }

    syncBlockedCellsArray();
    renderEditor();
    return;
  }

  if (editor.mode === 'teleport') {
    applyTeleportCell(cell);
    return;
  }

  if (editor.mode === 'speed') {
    applySpeedCell(cell);
    return;
  }

  if (editor.mode === 'level') {
    applyLevelCell(cell);
    return;
  }

  if (editor.mode === 'erase') {
    eraseCellParameters(cell);
  }
}

function upsertTeleportPoint(values) {
  if (!editor.map) {
    return;
  }

  const point = {
    id: values.id || cryptoRandomId(),
    column: Number(values.column),
    row: Number(values.row),
    targetMapId: Number(values.targetMapId),
    targetColumn: Number(values.targetColumn),
    targetRow: Number(values.targetRow),
  };

  if (!isCellInsideMap(point.column, point.row, editor.map)) {
    setStatus('Origem do teleporte fora do mapa.');
    return;
  }

  const targetMap = state.maps.find((map) => map.id === point.targetMapId);

  if (!targetMap || !isCellInsideMap(point.targetColumn, point.targetRow, targetMap)) {
    setStatus('Destino do teleporte invalido.');
    return;
  }

  const index = editor.data.teleportPoints.findIndex((item) => item.id === point.id);

  if (index >= 0) {
    editor.data.teleportPoints[index] = point;
  } else {
    editor.data.teleportPoints.push(point);
  }

  teleportForm.reset();
  renderTeleportFormDefaults();
  renderTeleportList();
  renderEditor();
  setStatus('Teleporte pronto para salvar.');
}

function removeTeleportPoint(id) {
  editor.data.teleportPoints = editor.data.teleportPoints.filter((point) => point.id !== id);
  renderTeleportList();
  renderEditor();
}

function editTeleportPoint(point) {
  teleportForm.elements.id.value = point.id;
  teleportForm.elements.column.value = point.column;
  teleportForm.elements.row.value = point.row;
  teleportForm.elements.targetMapId.value = point.targetMapId;
  teleportForm.elements.targetColumn.value = point.targetColumn;
  teleportForm.elements.targetRow.value = point.targetRow;
}

function fillTeleportOrigin(cell) {
  const existing = editor.data.teleportPoints.find((point) => point.column === cell.column && point.row === cell.row);

  if (existing) {
    editTeleportPoint(existing);
    return;
  }

  teleportForm.elements.id.value = '';
  teleportForm.elements.column.value = cell.column;
  teleportForm.elements.row.value = cell.row;
  renderTeleportFormDefaults();
}

function renderTeleportFormDefaults() {
  if (!editor.map) {
    return;
  }

  teleportForm.elements.targetMapId.value ||= editor.map.id;
  teleportForm.elements.targetColumn.value ||= editor.map.entryColumn;
  teleportForm.elements.targetRow.value ||= editor.map.entryRow;
}

function renderTeleportList() {
  teleportList.innerHTML = '';

  if (!editor.data.teleportPoints.length) {
    teleportList.innerHTML = '<p class="status">Nenhum teleporte neste mapa.</p>';
    return;
  }

  for (const point of editor.data.teleportPoints) {
    const targetMap = state.maps.find((map) => map.id === point.targetMapId);
    const row = document.createElement('div');
    row.className = 'teleport-row';
    row.innerHTML = `
      <strong>Col ${point.column} / Lin ${point.row}</strong>
      <small>Para ${escapeHtml(targetMap?.name || `Mapa ${point.targetMapId}`)} em Col ${point.targetColumn} / Lin ${point.targetRow}</small>
    `;

    const actions = document.createElement('div');
    actions.className = 'editor-actions';

    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.textContent = 'Editar';
    editButton.addEventListener('click', () => editTeleportPoint(point));

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.textContent = 'Remover';
    removeButton.addEventListener('click', () => removeTeleportPoint(point.id));

    actions.append(editButton, removeButton);
    row.append(actions);
    teleportList.append(row);
  }
}

function applyTeleportCell(cell) {
  if (!editor.map) {
    return;
  }

  ensureEditorDataCollections();
  renderTeleportFormDefaults();

  const values = formToObject(teleportForm);
  const targetMapId = Number(values.targetMapId || editor.map.id);
  const targetMap = state.maps.find((map) => map.id === targetMapId);
  const targetColumn = Number(values.targetColumn || targetMap?.entryColumn || editor.map.entryColumn);
  const targetRow = Number(values.targetRow || targetMap?.entryRow || editor.map.entryRow);

  if (!targetMap || !isCellInsideMap(targetColumn, targetRow, targetMap)) {
    fillTeleportOrigin(cell);
    setStatus('Defina um destino valido para usar o pincel de teleporte.');
    return;
  }

  editor.data.teleportPoints = editor.data.teleportPoints.filter((point) => (
    point.column !== cell.column || point.row !== cell.row
  ));
  editor.data.teleportPoints.push({
    id: cryptoRandomId(),
    column: cell.column,
    row: cell.row,
    targetMapId,
    targetColumn,
    targetRow,
  });

  renderTeleportList();
  renderEditor();
  setStatus('Teleporte aplicado com pincel.');
}

function applySpeedCell(cell) {
  ensureEditorDataCollections();
  const level = getSelectedCellParamLevel();
  const multiplier = SPEED_LEVEL_MULTIPLIERS[level] || 1;

  editor.data.speedCells = editor.data.speedCells.filter((item) => (
    item.column !== cell.column || item.row !== cell.row
  ));
  editor.data.speedCells.push({
    id: cryptoRandomId(),
    column: cell.column,
    row: cell.row,
    level,
    multiplier,
  });

  renderEditor();
  setStatus(`Velocidade V${level} aplicada na celula.`);
}

function applyLevelCell(cell) {
  ensureEditorDataCollections();
  const level = getSelectedCellParamLevel();

  editor.data.levelCells = editor.data.levelCells.filter((item) => (
    item.column !== cell.column || item.row !== cell.row
  ));
  editor.data.levelCells.push({
    id: cryptoRandomId(),
    column: cell.column,
    row: cell.row,
    level,
  });

  renderEditor();
  setStatus(`Nivel N${level} aplicado na celula.`);
}

function eraseCellParameters(cell) {
  ensureEditorDataCollections();
  const key = getCellKey(cell.column, cell.row);
  editor.data.blockedCellSet.delete(key);
  syncBlockedCellsArray();
  editor.data.teleportPoints = editor.data.teleportPoints.filter((point) => (
    point.column !== cell.column || point.row !== cell.row
  ));
  editor.data.speedCells = editor.data.speedCells.filter((item) => (
    item.column !== cell.column || item.row !== cell.row
  ));
  editor.data.levelCells = editor.data.levelCells.filter((item) => (
    item.column !== cell.column || item.row !== cell.row
  ));
  renderTeleportList();
  renderEditor();
  setStatus('Parametros da celula apagados.');
}

function getSelectedCellParamLevel() {
  return clamp(Number(cellParamLevelSelect.value || 3), 1, 5);
}

function ensureEditorDataCollections() {
  const data = editor.data || createEmptyMapData();
  data.blockedCells = Array.isArray(data.blockedCells) ? data.blockedCells : [];
  data.blockedCellSet = data.blockedCellSet instanceof Set ? data.blockedCellSet : new Set(data.blockedCells);
  data.teleportPoints = Array.isArray(data.teleportPoints) ? data.teleportPoints : [];
  data.speedCells = Array.isArray(data.speedCells) ? data.speedCells : [];
  data.levelCells = Array.isArray(data.levelCells) ? data.levelCells : [];
  editor.data = data;
}

function renderEditor() {
  resizeEditorCanvas();
  editorContext.fillStyle = '#0d0f14';
  editorContext.fillRect(0, 0, editorCanvas.width, editorCanvas.height);

  if (!editor.map) {
    return;
  }

  editorContext.save();
  editorContext.scale(editor.zoom, editor.zoom);
  editorContext.translate(-editor.offsetX, -editor.offsetY);
  editorContext.fillStyle = editor.map.backgroundColor || '#15161d';
  editorContext.fillRect(0, 0, getMapPixelWidth(editor.map), getMapPixelHeight(editor.map));

  if (editor.backgroundImage?.complete && editor.backgroundImage.naturalWidth > 0) {
    editorContext.drawImage(editor.backgroundImage, 0, 0, getMapPixelWidth(editor.map), getMapPixelHeight(editor.map));
  }

  renderEditorCollisions();
  renderEditorSpeedCells();
  renderEditorLevelCells();
  renderEditorTeleports();
  renderEditorEntryPoint();
  renderEditorGrid();
  renderEditorCoordinates();
  renderEditorCellBadges();
  editorContext.restore();
  renderEditorHud();
}

function renderEditorGrid() {
  const bounds = getVisibleCellBounds();
  editorContext.strokeStyle = editor.map.gridColor || 'rgba(185, 139, 87, 0.12)';
  editorContext.lineWidth = 1 / editor.zoom;

  for (let column = bounds.firstColumn; column <= bounds.lastColumn + 1; column += 1) {
    const x = (column - 1) * editor.map.cellSize;
    editorContext.beginPath();
    editorContext.moveTo(x, (bounds.firstRow - 1) * editor.map.cellSize);
    editorContext.lineTo(x, bounds.lastRow * editor.map.cellSize);
    editorContext.stroke();
  }

  for (let row = bounds.firstRow; row <= bounds.lastRow + 1; row += 1) {
    const y = (row - 1) * editor.map.cellSize;
    editorContext.beginPath();
    editorContext.moveTo((bounds.firstColumn - 1) * editor.map.cellSize, y);
    editorContext.lineTo(bounds.lastColumn * editor.map.cellSize, y);
    editorContext.stroke();
  }
}

function renderEditorCoordinates() {
  if (editor.map.showCoordinates === false) {
    return;
  }

  const bounds = getVisibleCellBounds();
  const fontSize = Math.max(10 / editor.zoom, 8);

  editorContext.save();
  editorContext.font = `${fontSize}px Arial`;
  editorContext.fillStyle = 'rgba(244, 244, 245, 0.56)';
  editorContext.textBaseline = 'top';

  for (let column = bounds.firstColumn; column <= bounds.lastColumn; column += 1) {
    const x = (column - 1) * editor.map.cellSize + 3 / editor.zoom;
    const y = (bounds.firstRow - 1) * editor.map.cellSize + 3 / editor.zoom;
    editorContext.textAlign = 'left';
    editorContext.fillText(String(column), x, y);
  }

  for (let row = bounds.firstRow; row <= bounds.lastRow; row += 1) {
    const x = (bounds.firstColumn - 1) * editor.map.cellSize + 3 / editor.zoom;
    const y = (row - 1) * editor.map.cellSize + 15 / editor.zoom;
    editorContext.textAlign = 'left';
    editorContext.fillText(String(row), x, y);
  }

  editorContext.restore();
}

function renderEditorCollisions() {
  editorContext.fillStyle = 'rgba(195, 62, 70, 0.62)';

  for (const key of editor.data.blockedCellSet) {
    const [column, row] = key.split(',').map(Number);

    if (!isCellVisible(column, row)) {
      continue;
    }

    editorContext.fillRect(
      (column - 1) * editor.map.cellSize,
      (row - 1) * editor.map.cellSize,
      editor.map.cellSize,
      editor.map.cellSize,
    );
  }
}

function renderEditorSpeedCells() {
  for (const cell of editor.data.speedCells) {
    if (!isCellVisible(cell.column, cell.row)) {
      continue;
    }

    editorContext.fillStyle = cell.multiplier >= 1
      ? 'rgba(34, 197, 94, 0.28)'
      : 'rgba(245, 158, 11, 0.32)';
    editorContext.fillRect(
      (cell.column - 1) * editor.map.cellSize,
      (cell.row - 1) * editor.map.cellSize,
      editor.map.cellSize,
      editor.map.cellSize,
    );
  }
}

function renderEditorLevelCells() {
  for (const cell of editor.data.levelCells) {
    if (!isCellVisible(cell.column, cell.row)) {
      continue;
    }

    editorContext.fillStyle = 'rgba(168, 85, 247, 0.28)';
    editorContext.fillRect(
      (cell.column - 1) * editor.map.cellSize,
      (cell.row - 1) * editor.map.cellSize,
      editor.map.cellSize,
      editor.map.cellSize,
    );
  }
}

function renderEditorTeleports() {
  editorContext.fillStyle = 'rgba(82, 173, 227, 0.78)';

  for (const point of editor.data.teleportPoints) {
    if (!isCellVisible(point.column, point.row)) {
      continue;
    }

    const x = (point.column - 1) * editor.map.cellSize;
    const y = (point.row - 1) * editor.map.cellSize;
    editorContext.fillRect(x + 2, y + 2, editor.map.cellSize - 4, editor.map.cellSize - 4);
  }
}

function renderEditorEntryPoint() {
  editorContext.strokeStyle = 'rgba(169, 214, 177, 0.95)';
  editorContext.lineWidth = Math.max(2 / editor.zoom, 1);
  editorContext.strokeRect(
    (editor.map.entryColumn - 1) * editor.map.cellSize + 1,
    (editor.map.entryRow - 1) * editor.map.cellSize + 1,
    editor.map.cellSize - 2,
    editor.map.cellSize - 2,
  );
}

function renderEditorCellBadges() {
  const cells = new Map();

  for (const key of editor.data.blockedCellSet) {
    const [column, row] = key.split(',').map(Number);
    addCellBadge(cells, column, row, { text: 'C', color: '#fecaca', background: 'rgba(153, 27, 27, 0.9)' });
  }

  for (const point of editor.data.teleportPoints) {
    addCellBadge(cells, point.column, point.row, { text: 'T', color: '#e0f2fe', background: 'rgba(3, 105, 161, 0.9)' });
  }

  for (const cell of editor.data.speedCells) {
    addCellBadge(cells, cell.column, cell.row, { text: `V${cell.level || 3}`, color: '#dcfce7', background: 'rgba(21, 128, 61, 0.9)' });
  }

  for (const cell of editor.data.levelCells) {
    addCellBadge(cells, cell.column, cell.row, { text: `N${cell.level}`, color: '#f3e8ff', background: 'rgba(126, 34, 206, 0.9)' });
  }

  for (const [key, badges] of cells) {
    const [column, row] = key.split(',').map(Number);

    if (!isCellVisible(column, row)) {
      continue;
    }

    badges.forEach((badge, index) => renderCellBadge(column, row, badge, index));
  }
}

function addCellBadge(cells, column, row, badge) {
  const key = getCellKey(column, row);
  const badges = cells.get(key) || [];
  badges.push(badge);
  cells.set(key, badges);
}

function renderCellBadge(column, row, badge, index) {
  const size = Math.max(11 / editor.zoom, 10);
  const padding = Math.max(3 / editor.zoom, 2);
  const x = (column - 1) * editor.map.cellSize + 2 / editor.zoom;
  const y = (row - 1) * editor.map.cellSize + 2 / editor.zoom + index * (size + padding);
  const width = Math.max((badge.text.length * 7 + 6) / editor.zoom, 14);
  const height = size + padding;

  editorContext.save();
  editorContext.fillStyle = badge.background;
  editorContext.fillRect(x, y, width, height);
  editorContext.font = `${size}px Arial`;
  editorContext.fillStyle = badge.color;
  editorContext.textAlign = 'center';
  editorContext.textBaseline = 'middle';
  editorContext.fillText(badge.text, x + width / 2, y + height / 2);
  editorContext.restore();
}

function renderEditorHud() {
  editorContext.save();
  editorContext.font = '13px Arial';
  editorContext.fillStyle = 'rgba(8, 9, 13, 0.82)';
  editorContext.fillRect(12, 12, 250, 28);
  editorContext.fillStyle = '#e3dac8';
  editorContext.fillText(`${editor.map.name} | Zoom ${Math.round(editor.zoom * 100)}%`, 22, 30);
  editorContext.restore();
}

function preloadEditorBackground(force = false) {
  if (!editor.map?.backgroundImagePath) {
    editor.backgroundImage = null;
    renderEditor();
    return;
  }

  if (editor.backgroundImage && !force) {
    return;
  }

  const image = new Image();
  image.onload = renderEditor;
  image.src = appendAssetVersion(editor.map.backgroundImagePath, Date.now());
  editor.backgroundImage = image;
}

function appendAssetVersion(source, version) {
  if (!source || !version) {
    return source;
  }

  return `${source}${source.includes('?') ? '&' : '?'}v=${encodeURIComponent(version)}`;
}

function resizeEditorCanvas() {
  const rect = editorCanvas.getBoundingClientRect();
  const width = Math.max(320, Math.floor(rect.width));
  const height = Math.max(360, Math.floor(rect.height));

  if (editorCanvas.width !== width || editorCanvas.height !== height) {
    editorCanvas.width = width;
    editorCanvas.height = height;
  }
}

function getVisibleCellBounds() {
  return {
    firstColumn: clamp(Math.floor(editor.offsetX / editor.map.cellSize) + 1, 1, editor.map.widthCells),
    lastColumn: clamp(Math.ceil((editor.offsetX + editorCanvas.width / editor.zoom) / editor.map.cellSize), 1, editor.map.widthCells),
    firstRow: clamp(Math.floor(editor.offsetY / editor.map.cellSize) + 1, 1, editor.map.heightCells),
    lastRow: clamp(Math.ceil((editor.offsetY + editorCanvas.height / editor.zoom) / editor.map.cellSize), 1, editor.map.heightCells),
  };
}

function eventToCell(event) {
  const rect = editorCanvas.getBoundingClientRect();
  const worldPoint = screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
  const column = Math.floor(worldPoint.x / editor.map.cellSize) + 1;
  const row = Math.floor(worldPoint.y / editor.map.cellSize) + 1;

  if (!isCellInsideMap(column, row, editor.map)) {
    return null;
  }

  return { column, row };
}

function screenToWorld(x, y) {
  return {
    x: editor.offsetX + x / editor.zoom,
    y: editor.offsetY + y / editor.zoom,
  };
}

function clampEditorOffset() {
  editor.offsetX = clamp(editor.offsetX, 0, Math.max(0, getMapPixelWidth(editor.map) - editorCanvas.width / editor.zoom));
  editor.offsetY = clamp(editor.offsetY, 0, Math.max(0, getMapPixelHeight(editor.map) - editorCanvas.height / editor.zoom));
}

function isCellVisible(column, row) {
  const bounds = getVisibleCellBounds();
  return column >= bounds.firstColumn && column <= bounds.lastColumn && row >= bounds.firstRow && row <= bounds.lastRow;
}

function normalizeClientMapData(data, map = null) {
  const blockedCells = Array.isArray(data?.blockedCells) ? data.blockedCells : [];

  return {
    version: 1,
    widthCells: Number(data?.widthCells) || 0,
    heightCells: Number(data?.heightCells) || 0,
    blockedCells,
    blockedCellSet: new Set(blockedCells),
    teleportPoints: Array.isArray(data?.teleportPoints) ? data.teleportPoints : [],
    speedCells: normalizeSpeedCells(data),
    levelCells: normalizeLevelCells(data),
  };
}

function normalizeSpeedCells(data) {
  const directCells = Array.isArray(data?.speedCells) ? data.speedCells : [];
  const legacyAreas = Array.isArray(data?.speedAreas) ? data.speedAreas : [];
  const cells = directCells.map(normalizeSpeedCell).filter(Boolean);

  for (const area of legacyAreas) {
    const column = Number(area?.column);
    const row = Number(area?.row);
    const width = Number(area?.width);
    const height = Number(area?.height);

    if (!Number.isInteger(column) || !Number.isInteger(row) || !Number.isInteger(width) || !Number.isInteger(height)) {
      continue;
    }

    for (let offsetRow = 0; offsetRow < height; offsetRow += 1) {
      for (let offsetColumn = 0; offsetColumn < width; offsetColumn += 1) {
        cells.push(normalizeSpeedCell({
          column: column + offsetColumn,
          row: row + offsetRow,
          multiplier: area.multiplier,
        }));
      }
    }
  }

  return cells.filter(Boolean);
}

function normalizeSpeedCell(cell) {
  const normalized = {
    id: String(cell?.id || cryptoRandomId()),
    column: Number(cell?.column),
    row: Number(cell?.row),
    level: clamp(Number(cell?.level || getSpeedLevelFromMultiplier(Number(cell?.multiplier))), 1, 5),
    multiplier: Number(cell?.multiplier),
  };

  if (
    !Number.isInteger(normalized.column) ||
    !Number.isInteger(normalized.row)
  ) {
    return null;
  }

  normalized.multiplier = SPEED_LEVEL_MULTIPLIERS[normalized.level] || 1;
  return normalized;
}

function getSpeedLevelFromMultiplier(multiplier) {
  if (multiplier <= 0.625) return 1;
  if (multiplier <= 0.875) return 2;
  if (multiplier <= 1.125) return 3;
  if (multiplier <= 1.375) return 4;
  return 5;
}

function normalizeLevelCells(data) {
  const directCells = Array.isArray(data?.levelCells) ? data.levelCells : [];
  return directCells.map(normalizeLevelCell).filter(Boolean);
}

function normalizeLevelCell(cell) {
  const normalized = {
    id: String(cell?.id || cryptoRandomId()),
    column: Number(cell?.column),
    row: Number(cell?.row),
    level: clamp(Number(cell?.level || 3), 1, 5),
  };

  if (!Number.isInteger(normalized.column) || !Number.isInteger(normalized.row)) {
    return null;
  }

  return normalized;
}

function createEmptyMapData() {
  return normalizeClientMapData({}, null);
}

function syncBlockedCellsArray() {
  editor.data.blockedCells = [...editor.data.blockedCellSet].sort(compareCellKeys);
}

function compareCellKeys(a, b) {
  const [aColumn, aRow] = a.split(',').map(Number);
  const [bColumn, bRow] = b.split(',').map(Number);
  return aRow - bRow || aColumn - bColumn;
}

function isCellInsideMap(column, row, map) {
  return column >= 1 && column <= map.widthCells && row >= 1 && row <= map.heightCells;
}

function getCellKey(column, row) {
  return `${column},${row}`;
}

function getMapPixelWidth(map) {
  return map.widthCells * map.cellSize;
}

function getMapPixelHeight(map) {
  return map.heightCells * map.cellSize;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function cryptoRandomId() {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formToObject(form) {
  return Object.fromEntries(new FormData(form));
}

function getAuthHeaders() {
  return {
    Authorization: `Bearer ${managerToken}`,
  };
}

function unlock() {
  document.body.classList.remove('locked');
  loginStatus.textContent = '';
}

function setStatus(text) {
  statusElement.textContent = text;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
