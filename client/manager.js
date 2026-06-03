const tokenForm = document.querySelector('[data-token-form]');
const loginStatus = document.querySelector('[data-login-status]');
const statusElement = document.querySelector('[data-status]');
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

let managerToken = localStorage.getItem('managerToken') || '';
let state = {
  settings: {},
  maps: [],
  races: [],
  classes: [],
};
let migrations = [];

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

settingsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await save('/api/manager/settings', 'PUT', formToObject(settingsForm));
});

mapForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  await save('/api/manager/maps', 'POST', formToObject(mapForm));
  mapForm.reset();
  mapForm.elements.id.value = '';
  setDefaultMapFormValues();
});

for (const form of taxonomyForms) {
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    await save(`/api/manager/${form.dataset.taxonomyForm}`, 'POST', formToObject(form));
    form.reset();
    form.elements.id.value = '';
  });
}

refreshMigrationsButton.addEventListener('click', loadMigrations);
applyPendingButton.addEventListener('click', applyPendingMigrations);

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

function renderState() {
  settingsForm.elements.gameName.value = state.settings.gameName || '';
  renderMapOptions(mapSelect, false);
  mapSelect.value = state.settings.defaultMapId || '';
  renderMapOptionsForExits();
  setDefaultMapFormValues();
  renderMaps();
  renderTaxonomy('races');
  renderTaxonomy('classes');
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

  for (const map of state.maps) {
    const item = document.createElement('button');
    item.className = 'item';
    item.type = 'button';
    item.innerHTML = `
      <strong>${escapeHtml(map.name)}</strong>
      <span class="map-summary">${map.widthCells} x ${map.heightCells} celulas, ${map.cellSize}px por celula, personagem ${map.characterSize}px</span>
      <small>Entrada: Col ${map.entryColumn} / Lin ${map.entryRow}</small>
      <small>Saidas: N ${map.exits.north || '-'} | L ${map.exits.east || '-'} | S ${map.exits.south || '-'} | O ${map.exits.west || '-'}</small>
    `;
    item.addEventListener('click', () => fillMapForm(map));
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
      <span>${escapeHtml(item.description || '')}</span>
    `;
    button.addEventListener('click', () => {
      form.elements.id.value = item.id;
      form.elements.name.value = item.name;
      form.elements.description.value = item.description || '';
      form.elements.isActive.value = String(item.isActive);
    });
    list.append(button);
  }
}

function fillMapForm(map) {
  mapForm.elements.id.value = map.id;
  mapForm.elements.name.value = map.name;
  mapForm.elements.widthCells.value = map.widthCells;
  mapForm.elements.heightCells.value = map.heightCells;
  mapForm.elements.cellSize.value = map.cellSize;
  mapForm.elements.characterSize.value = map.characterSize;
  mapForm.elements.entryColumn.value = map.entryColumn;
  mapForm.elements.entryRow.value = map.entryRow;
  mapForm.elements.backgroundColor.value = map.backgroundColor;
  mapForm.elements.northMapId.value = map.exits.north || '';
  mapForm.elements.eastMapId.value = map.exits.east || '';
  mapForm.elements.southMapId.value = map.exits.south || '';
  mapForm.elements.westMapId.value = map.exits.west || '';
}

function setDefaultMapFormValues() {
  if (mapForm.elements.id.value) {
    return;
  }

  mapForm.elements.name.value ||= 'Novo mapa';
  mapForm.elements.widthCells.value ||= 1000;
  mapForm.elements.heightCells.value ||= 1000;
  mapForm.elements.cellSize.value ||= 32;
  mapForm.elements.characterSize.value ||= 64;
  mapForm.elements.entryColumn.value ||= 500;
  mapForm.elements.entryRow.value ||= 500;
  mapForm.elements.backgroundColor.value ||= '#15161d';
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

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
