const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const mysql = require('mysql2/promise');
const { WebSocket, WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 8080;
const PLAYER_SIZE = 24;
const SOCKET_HEARTBEAT_INTERVAL = 25000;
const PLAYER_DISCONNECT_GRACE_MS = 30000;
const MAX_REQUEST_BODY_SIZE = 12 * 1024 * 1024;
const APP_VERSION = '2026-06-03-cell-params-1';
const CLIENT_DIR = path.resolve(__dirname, '..', 'client');
const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'database', 'migrations');
const MAP_ASSETS_DIR = path.join(CLIENT_DIR, 'assets', 'maps');
const MAP_DATA_DIR = path.join(MAP_ASSETS_DIR, 'data');
const MAP_BACKGROUND_DIR = path.join(MAP_ASSETS_DIR, 'backgrounds');
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const MANAGER_TOKEN = process.env.MANAGER_TOKEN || '';
const DEFAULT_GAME_CONFIG = {
  gameName: 'Vigilia dos Portoes',
  map: {
    id: 1,
    name: 'Mapa Inicial',
    widthCells: 1000,
    heightCells: 1000,
    cellSize: 32,
    characterSize: 64,
    movementSpeed: 5,
    entryColumn: 500,
    entryRow: 500,
    backgroundColor: '#15161d',
    backgroundImagePath: null,
    mapDataPath: '/assets/maps/data/map-1.json',
    gridColor: 'rgba(185, 139, 87, 0.08)',
    exits: {
      north: null,
      east: null,
      south: null,
      west: null,
    },
  },
};

const db = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'mmorpg_dark',
  waitForConnections: true,
  connectionLimit: 10,
});

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://localhost:${PORT}`);

    if (request.method === 'GET' && request.url === '/api/health') {
      await healthCheck(response);
      return;
    }

    if (request.method === 'GET' && request.url === '/api/version') {
      sendJson(response, 200, { version: APP_VERSION });
      return;
    }

    if (request.method === 'GET' && request.url === '/api/game-config') {
      await reloadGameConfig();
      sendJson(response, 200, createGameConfigPayload(gameConfig.map, await readMapData(gameConfig.map)));
      return;
    }

    if (request.url.startsWith('/api/manager')) {
      await handleManagerRequest(request, response);
      return;
    }

    if (request.method === 'POST' && request.url === '/api/register') {
      await register(request, response);
      return;
    }

    if (request.method === 'POST' && request.url === '/api/login') {
      await login(request, response);
      return;
    }

    serveStaticFile(request, response);
  } catch (error) {
    handleUnexpectedError(error, response);
  }
});

const wss = new WebSocketServer({ server });
const players = new Map();
const playersByUserId = new Map();
let gameConfig = DEFAULT_GAME_CONFIG;
const mapsById = new Map([[DEFAULT_GAME_CONFIG.map.id, DEFAULT_GAME_CONFIG.map]]);
const mapDataCache = new Map();
const heartbeatInterval = setInterval(() => {
  for (const socket of wss.clients) {
    if (!socket.isAlive) {
      socket.terminate();
      continue;
    }

    socket.isAlive = false;
    socket.ping();
  }
}, SOCKET_HEARTBEAT_INTERVAL);

wss.on('close', () => {
  clearInterval(heartbeatInterval);
});

async function healthCheck(response) {
  try {
    await db.query('SELECT 1');
    sendJson(response, 200, { ok: true });
  } catch (error) {
    console.error('Database health check failed:', {
      code: error.code,
      errno: error.errno,
      sqlState: error.sqlState,
      message: error.message,
    });

    sendJson(response, 500, {
      ok: false,
      error: 'Nao foi possivel conectar ao banco de dados.',
      code: error.code || 'UNKNOWN',
    });
  }
}

async function handleManagerRequest(request, response) {
  const url = new URL(request.url, `http://localhost:${PORT}`);

  if (request.method === 'POST' && url.pathname === '/api/manager/session') {
    const body = await readRequestBody(request);

    if (!isManagerTokenValid(body.token)) {
      sendJson(response, 401, { error: 'Token de gerente invalido.' });
      return;
    }

    sendJson(response, 200, { ok: true });
    return;
  }

  if (!isManagerRequestAuthorized(request)) {
    sendJson(response, 401, { error: 'Acesso de gerente necessario.' });
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/manager/state') {
    sendJson(response, 200, await getManagerState());
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/manager/migrations') {
    sendJson(response, 200, { migrations: await getMigrations() });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/manager/migrations/apply') {
    const body = await readRequestBody(request);
    await applyMigration(String(body.filename || ''));
    await reloadGameConfig();
    await broadcastGameState();
    sendJson(response, 200, { migrations: await getMigrations() });
    return;
  }

  if (request.method === 'PUT' && url.pathname === '/api/manager/settings') {
    const body = await readRequestBody(request);
    await saveGameSettings(body);
    await reloadGameConfig();
    resetPlayersToDefaultMapEntry();
    await broadcastGameState();
    sendJson(response, 200, await getManagerState());
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/manager/maps') {
    const body = await readRequestBody(request);
    const mapId = body.id ? Number(body.id) : null;
    await saveMap(body);
    await reloadGameConfig();
    if (mapId) {
      resetPlayersOnMapEntry(mapId);
    } else {
      resetPlayersToDefaultMapEntry();
    }
    await broadcastGameState();
    sendJson(response, 200, await getManagerState());
    return;
  }

  const deleteMapMatch = url.pathname.match(/^\/api\/manager\/maps\/(\d+)$/);

  if (request.method === 'DELETE' && deleteMapMatch) {
    await deleteMap(toPositiveInt(deleteMapMatch[1], 'Mapa invalido.'));
    await reloadGameConfig();
    resetPlayersToDefaultMapEntry();
    await broadcastGameState();
    sendJson(response, 200, await getManagerState());
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/manager/map-editor') {
    const mapId = toPositiveInt(url.searchParams.get('mapId'), 'Mapa invalido.');
    const map = await getMapById(mapId);

    sendJson(response, 200, {
      map,
      data: await readMapData(map),
    });
    return;
  }

  if (request.method === 'PUT' && url.pathname === '/api/manager/map-editor') {
    const body = await readRequestBody(request);
    const mapId = toPositiveInt(body.mapId, 'Mapa invalido.');
    const map = await getMapById(mapId);
    const data = normalizeMapData(body.data || body, map);

    await writeMapData(map, data);
    await broadcastGameState();
    sendJson(response, 200, {
      map,
      data,
    });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/manager/map-background') {
    const body = await readRequestBody(request);
    const mapId = toPositiveInt(body.mapId, 'Mapa invalido.');
    const map = await getMapById(mapId);
    const backgroundImagePath = await saveMapBackground(map.id, String(body.dataUrl || ''));

    await db.execute('UPDATE maps SET background_image_path = ? WHERE id = ?', [backgroundImagePath, map.id]);
    await reloadGameConfig();
    await broadcastGameState();
    sendJson(response, 200, await getManagerState());
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/manager/races') {
    const body = await readRequestBody(request);
    await saveTaxonomy('races', body);
    sendJson(response, 200, await getManagerState());
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/manager/classes') {
    const body = await readRequestBody(request);
    await saveTaxonomy('character_classes', body);
    sendJson(response, 200, await getManagerState());
    return;
  }

  sendJson(response, 404, { error: 'Rota de gerente nao encontrada.' });
}

function isManagerRequestAuthorized(request) {
  if (!MANAGER_TOKEN) {
    return false;
  }

  const authorization = String(request.headers.authorization || '');
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';

  return isManagerTokenValid(token);
}

function isManagerTokenValid(token) {
  if (!MANAGER_TOKEN || !token) {
    return false;
  }

  const received = Buffer.from(token);
  const expected = Buffer.from(MANAGER_TOKEN);

  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

async function getManagerState() {
  const [settingsRows] = await db.execute(
    'SELECT id, game_name, default_map_id FROM game_settings WHERE id = 1 LIMIT 1',
  );
  const [mapRows] = await db.execute(
    'SELECT * FROM maps ORDER BY id',
  );
  const [raceRows] = await db.execute(
    'SELECT id, name, description, is_active FROM races ORDER BY name',
  );
  const [classRows] = await db.execute(
    'SELECT id, name, description, is_active FROM character_classes ORDER BY name',
  );

  const settings = settingsRows[0] || {
    game_name: DEFAULT_GAME_CONFIG.gameName,
    default_map_id: DEFAULT_GAME_CONFIG.map.id,
  };

  return {
    settings: {
      gameName: settings.game_name,
      defaultMapId: settings.default_map_id,
    },
    maps: mapRows.map(mapMapRow),
    races: raceRows.map(mapTaxonomyRow),
    classes: classRows.map(mapTaxonomyRow),
  };
}

async function getMigrations() {
  await ensureMigrationsTable();

  const files = getMigrationFiles();
  const [rows] = await db.execute('SELECT filename, applied_at FROM schema_migrations ORDER BY filename');
  const applied = new Map(rows.map((row) => [row.filename, row.applied_at]));

  return files.map((filename) => ({
    filename,
    applied: applied.has(filename),
    appliedAt: applied.get(filename) || null,
  }));
}

async function applyMigration(filename) {
  await ensureMigrationsTable();

  if (!getMigrationFiles().includes(filename)) {
    throw Object.assign(new Error('Migration nao encontrada.'), { statusCode: 404 });
  }

  const [existing] = await db.execute(
    'SELECT id FROM schema_migrations WHERE filename = ? LIMIT 1',
    [filename],
  );

  if (existing[0]) {
    return;
  }

  const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, filename), 'utf8');
  const statements = splitSqlStatements(sql);

  for (const statement of statements) {
    try {
      await db.query(statement);
    } catch (error) {
      if (!isIgnorableMigrationError(error)) {
        throw error;
      }
    }
  }

  await db.execute('INSERT INTO schema_migrations (filename) VALUES (?)', [filename]);
}

function isIgnorableMigrationError(error) {
  return ['ER_DUP_FIELDNAME', 'ER_DUP_KEYNAME'].includes(error.code);
}

async function ensureMigrationsTable() {
  await db.execute(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      filename VARCHAR(190) NOT NULL,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY schema_migrations_filename_unique (filename)
    ) ENGINE=InnoDB
      DEFAULT CHARSET=utf8mb4
      COLLATE=utf8mb4_unicode_ci`,
  );
}

function getMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    return [];
  }

  return fs.readdirSync(MIGRATIONS_DIR)
    .filter((filename) => filename.endsWith('.sql'))
    .sort();
}

function splitSqlStatements(sql) {
  return sql
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function saveGameSettings(body) {
  const gameName = normalizeText(body.gameName, 3, 80);
  const defaultMapId = toPositiveInt(body.defaultMapId, 'Mapa inicial invalido.');
  await ensureMapIdsExist([defaultMapId]);

  await db.execute(
    `INSERT INTO game_settings (id, game_name, default_map_id)
      VALUES (1, ?, ?)
      ON DUPLICATE KEY UPDATE game_name = VALUES(game_name), default_map_id = VALUES(default_map_id)`,
    [gameName, defaultMapId],
  );
}

async function saveMap(body) {
  const id = body.id ? toPositiveInt(body.id, 'Mapa invalido.') : null;
  const widthCells = toBoundedInt(body.widthCells, 10, 5000, 'Largura do mapa invalida.');
  const heightCells = toBoundedInt(body.heightCells, 10, 5000, 'Altura do mapa invalida.');
  const map = {
    name: normalizeText(body.name, 3, 80),
    widthCells,
    heightCells,
    cellSize: toBoundedInt(body.cellSize, 16, 128, 'Tamanho da celula invalido.'),
    characterSize: toBoundedInt(body.characterSize, 16, 256, 'Tamanho do personagem invalido.'),
    movementSpeed: toBoundedFloat(body.movementSpeed || 5, 1, 20, 'Velocidade de deslocamento invalida.'),
    entryColumn: toBoundedInt(body.entryColumn, 1, widthCells, 'Coluna de entrada invalida.'),
    entryRow: toBoundedInt(body.entryRow, 1, heightCells, 'Linha de entrada invalida.'),
    backgroundColor: normalizeColor(body.backgroundColor, '#15161d'),
    gridColor: normalizeText(body.gridColor || 'rgba(185, 139, 87, 0.08)', 3, 40),
    northMapId: nullablePositiveInt(body.northMapId),
    eastMapId: nullablePositiveInt(body.eastMapId),
    southMapId: nullablePositiveInt(body.southMapId),
    westMapId: nullablePositiveInt(body.westMapId),
  };
  await ensureMapIdsExist([map.northMapId, map.eastMapId, map.southMapId, map.westMapId].filter(Boolean));

  if (id) {
    await db.execute(
      `UPDATE maps
        SET name = ?, width_cells = ?, height_cells = ?, cell_size = ?, character_size = ?,
          movement_speed = ?, entry_column = ?, entry_row = ?,
          background_color = ?, grid_color = ?, north_map_id = ?, east_map_id = ?,
          south_map_id = ?, west_map_id = ?
        WHERE id = ?`,
      [
        map.name,
        map.widthCells,
        map.heightCells,
        map.cellSize,
        map.characterSize,
        map.movementSpeed,
        map.entryColumn,
        map.entryRow,
        map.backgroundColor,
        map.gridColor,
        map.northMapId,
        map.eastMapId,
        map.southMapId,
        map.westMapId,
        id,
      ],
    );
    return;
  }

  await db.execute(
    `INSERT INTO maps
      (name, width_cells, height_cells, cell_size, character_size, movement_speed, entry_column, entry_row, background_color, grid_color,
        north_map_id, east_map_id, south_map_id, west_map_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      map.name,
      map.widthCells,
      map.heightCells,
      map.cellSize,
      map.characterSize,
      map.movementSpeed,
      map.entryColumn,
      map.entryRow,
      map.backgroundColor,
      map.gridColor,
      map.northMapId,
      map.eastMapId,
      map.southMapId,
      map.westMapId,
    ],
  );
}

async function deleteMap(mapId) {
  const [settingsRows] = await db.execute('SELECT default_map_id FROM game_settings WHERE id = 1 LIMIT 1');
  const defaultMapId = Number(settingsRows[0]?.default_map_id || DEFAULT_GAME_CONFIG.map.id);

  if (mapId === defaultMapId) {
    throw Object.assign(new Error('Nao e possivel remover o mapa inicial do jogo.'), { statusCode: 400 });
  }

  const [mapRows] = await db.execute('SELECT id, background_image_path FROM maps WHERE id = ? LIMIT 1', [mapId]);

  if (!mapRows[0]) {
    throw Object.assign(new Error('Mapa nao encontrado.'), { statusCode: 404 });
  }

  const [countRows] = await db.execute('SELECT COUNT(*) AS total FROM maps');

  if (Number(countRows[0]?.total || 0) <= 1) {
    throw Object.assign(new Error('O jogo precisa manter pelo menos um mapa.'), { statusCode: 400 });
  }

  await db.execute(
    `UPDATE maps
      SET north_map_id = IF(north_map_id = ?, NULL, north_map_id),
        east_map_id = IF(east_map_id = ?, NULL, east_map_id),
        south_map_id = IF(south_map_id = ?, NULL, south_map_id),
        west_map_id = IF(west_map_id = ?, NULL, west_map_id)`,
    [mapId, mapId, mapId, mapId],
  );
  await db.execute('DELETE FROM maps WHERE id = ?', [mapId]);
  mapDataCache.delete(mapId);
  deleteMapAssetFiles(mapId, mapRows[0].background_image_path);
}

async function ensureMapIdsExist(ids) {
  if (ids.length === 0) {
    return;
  }

  const placeholders = ids.map(() => '?').join(', ');
  const [rows] = await db.execute(`SELECT id FROM maps WHERE id IN (${placeholders})`, ids);
  const foundIds = new Set(rows.map((row) => row.id));

  if (ids.some((id) => !foundIds.has(id))) {
    throw Object.assign(new Error('Um dos mapas selecionados nao existe.'), { statusCode: 400 });
  }
}

async function getMapById(mapId) {
  const [rows] = await db.execute('SELECT * FROM maps WHERE id = ? LIMIT 1', [mapId]);

  if (!rows[0]) {
    throw Object.assign(new Error('Mapa nao encontrado.'), { statusCode: 404 });
  }

  return mapMapRow(rows[0]);
}

function ensureMapAssetDirectories() {
  for (const directory of [MAP_DATA_DIR, MAP_BACKGROUND_DIR]) {
    fs.mkdirSync(directory, { recursive: true });
  }
}

function getMapDataPublicPath(mapId) {
  return `/assets/maps/data/map-${mapId}.json`;
}

function getMapDataFilePath(mapId) {
  return path.join(MAP_DATA_DIR, `map-${mapId}.json`);
}

function deleteMapAssetFiles(mapId, backgroundImagePath) {
  const dataFilePath = getMapDataFilePath(mapId);

  if (fs.existsSync(dataFilePath)) {
    fs.unlinkSync(dataFilePath);
  }

  if (!backgroundImagePath) {
    return;
  }

  const backgroundFilePath = path.resolve(CLIENT_DIR, `.${backgroundImagePath}`);

  if (backgroundFilePath.startsWith(`${MAP_BACKGROUND_DIR}${path.sep}`) && fs.existsSync(backgroundFilePath)) {
    fs.unlinkSync(backgroundFilePath);
  }
}

function createDefaultMapData(map) {
  return {
    version: 1,
    widthCells: map.widthCells,
    heightCells: map.heightCells,
    blockedCells: [],
    teleportPoints: [],
    speedCells: [],
    levelCells: [],
  };
}

async function readMapData(map) {
  ensureMapAssetDirectories();

  if (mapDataCache.has(map.id)) {
    return mapDataCache.get(map.id);
  }

  const filePath = getMapDataFilePath(map.id);
  let data = createDefaultMapData(map);

  if (fs.existsSync(filePath)) {
    try {
      data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
      console.warn(`Invalid map data for map ${map.id}:`, error.message);
    }
  }

  data = normalizeMapData(data, map);
  mapDataCache.set(map.id, data);
  return data;
}

async function writeMapData(map, data) {
  ensureMapAssetDirectories();
  const normalized = normalizeMapData(data, map);
  const filePath = getMapDataFilePath(map.id);

  fs.writeFileSync(filePath, `${JSON.stringify(normalized, null, 2)}\n`);
  mapDataCache.set(map.id, normalized);
  await db.execute('UPDATE maps SET map_data_path = ? WHERE id = ?', [getMapDataPublicPath(map.id), map.id]);
}

function normalizeMapData(data, map) {
  const blockedCells = Array.isArray(data.blockedCells)
    ? [...new Set(data.blockedCells.map(normalizeCellKey).filter((cellKey) => isCellKeyInsideMap(cellKey, map)))]
    : [];
  const teleportPoints = Array.isArray(data.teleportPoints)
    ? data.teleportPoints.map((point) => normalizeTeleportPoint(point, map)).filter(Boolean)
    : [];
  const speedCells = normalizeSpeedCells(data, map);
  const levelCells = normalizeLevelCells(data, map);

  return {
    version: 1,
    widthCells: map.widthCells,
    heightCells: map.heightCells,
    blockedCells,
    teleportPoints,
    speedCells,
    levelCells,
  };
}

function normalizeSpeedCells(data, map) {
  const cells = Array.isArray(data.speedCells)
    ? data.speedCells.map((cell) => normalizeSpeedCell(cell, map)).filter(Boolean)
    : [];
  const areas = Array.isArray(data.speedAreas) ? data.speedAreas : [];

  for (const area of areas) {
    const column = Number(area?.column);
    const row = Number(area?.row);
    const width = Number(area?.width);
    const height = Number(area?.height);

    if (
      !Number.isInteger(column) ||
      !Number.isInteger(row) ||
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 1 ||
      height < 1
    ) {
      continue;
    }

    for (let offsetRow = 0; offsetRow < height; offsetRow += 1) {
      for (let offsetColumn = 0; offsetColumn < width; offsetColumn += 1) {
        const cell = normalizeSpeedCell({
          column: column + offsetColumn,
          row: row + offsetRow,
          multiplier: area.multiplier,
        }, map);

        if (cell) {
          cells.push(cell);
        }
      }
    }
  }

  const byCell = new Map();
  for (const cell of cells) {
    byCell.set(getCellKey(cell.column, cell.row), cell);
  }

  return [...byCell.values()];
}

function normalizeSpeedCell(cell, map) {
  const column = Number(cell?.column);
  const row = Number(cell?.row);
  const multiplier = Number(cell?.multiplier);

  if (
    !Number.isInteger(column) ||
    !Number.isInteger(row) ||
    !isCellKeyInsideMap(`${column},${row}`, map)
  ) {
    return null;
  }

  return {
    id: String(cell.id || crypto.randomUUID()),
    column,
    row,
    multiplier: clamp(Number.isFinite(multiplier) ? multiplier : 1, 0.2, 3),
  };
}

function normalizeLevelCells(data, map) {
  const cells = Array.isArray(data.levelCells)
    ? data.levelCells.map((cell) => normalizeLevelCell(cell, map)).filter(Boolean)
    : [];
  const byCell = new Map();

  for (const cell of cells) {
    byCell.set(getCellKey(cell.column, cell.row), cell);
  }

  return [...byCell.values()];
}

function normalizeLevelCell(cell, map) {
  const column = Number(cell?.column);
  const row = Number(cell?.row);
  const level = Number(cell?.level);

  if (
    !Number.isInteger(column) ||
    !Number.isInteger(row) ||
    !isCellKeyInsideMap(`${column},${row}`, map)
  ) {
    return null;
  }

  return {
    id: String(cell.id || crypto.randomUUID()),
    column,
    row,
    level: clamp(Number.isInteger(level) ? level : 3, 1, 5),
  };
}

function normalizeCellKey(value) {
  if (typeof value === 'string') {
    const [column, row] = value.split(',').map(Number);
    return Number.isInteger(column) && Number.isInteger(row) ? `${column},${row}` : '';
  }

  if (value && typeof value === 'object') {
    const column = Number(value.column);
    const row = Number(value.row);
    return Number.isInteger(column) && Number.isInteger(row) ? `${column},${row}` : '';
  }

  return '';
}

function isCellKeyInsideMap(cellKey, map) {
  const [column, row] = cellKey.split(',').map(Number);
  return column >= 1 && column <= map.widthCells && row >= 1 && row <= map.heightCells;
}

function normalizeTeleportPoint(point, map) {
  const column = Number(point?.column);
  const row = Number(point?.row);
  const targetMapId = Number(point?.targetMapId);
  const targetColumn = Number(point?.targetColumn || 0);
  const targetRow = Number(point?.targetRow || 0);

  if (
    !Number.isInteger(column) ||
    !Number.isInteger(row) ||
    !Number.isInteger(targetMapId) ||
    !isCellKeyInsideMap(`${column},${row}`, map) ||
    !mapsById.has(targetMapId)
  ) {
    return null;
  }

  const targetMap = mapsById.get(targetMapId);

  return {
    id: String(point.id || crypto.randomUUID()),
    column,
    row,
    targetMapId,
    targetColumn: Number.isInteger(targetColumn) && targetColumn >= 1 && targetColumn <= targetMap.widthCells
      ? targetColumn
      : targetMap.entryColumn,
    targetRow: Number.isInteger(targetRow) && targetRow >= 1 && targetRow <= targetMap.heightCells
      ? targetRow
      : targetMap.entryRow,
  };
}

async function saveMapBackground(mapId, dataUrl) {
  ensureMapAssetDirectories();

  const match = dataUrl.match(/^data:image\/(png|jpeg|webp);base64,([a-zA-Z0-9+/=]+)$/);

  if (!match) {
    throw Object.assign(new Error('Imagem invalida. Use PNG, JPG ou WEBP.'), { statusCode: 400 });
  }

  const extension = match[1] === 'jpeg' ? 'jpg' : match[1];
  const content = Buffer.from(match[2], 'base64');

  if (content.length > 6 * 1024 * 1024) {
    throw Object.assign(new Error('Imagem muito grande. Limite de 6 MB.'), { statusCode: 400 });
  }

  const fileName = `map-${mapId}.${extension}`;
  fs.writeFileSync(path.join(MAP_BACKGROUND_DIR, fileName), content);
  return `/assets/maps/backgrounds/${fileName}`;
}

async function saveTaxonomy(table, body) {
  if (!['races', 'character_classes'].includes(table)) {
    throw new Error('Invalid taxonomy table.');
  }

  const id = body.id ? toPositiveInt(body.id, 'Cadastro invalido.') : null;
  const name = normalizeText(body.name, 2, 60);
  const description = String(body.description || '').trim().slice(0, 1200);
  const isActive = body.isActive === false || body.isActive === 'false' ? 0 : 1;

  if (id) {
    await db.execute(
      `UPDATE ${table} SET name = ?, description = ?, is_active = ? WHERE id = ?`,
      [name, description, isActive, id],
    );
    return;
  }

  await db.execute(
    `INSERT INTO ${table} (name, description, is_active)
      VALUES (?, ?, ?)
      ON DUPLICATE KEY UPDATE description = VALUES(description), is_active = VALUES(is_active)`,
    [name, description, isActive],
  );
}

function mapMapRow(row) {
  return {
    id: row.id,
    name: row.name,
    widthCells: row.width_cells,
    heightCells: row.height_cells,
    cellSize: row.cell_size,
    characterSize: row.character_size,
    movementSpeed: Number(row.movement_speed || 5),
    entryColumn: row.entry_column,
    entryRow: row.entry_row,
    backgroundColor: row.background_color,
    backgroundImagePath: row.background_image_path || null,
    mapDataPath: row.map_data_path || getMapDataPublicPath(row.id),
    gridColor: row.grid_color,
    exits: {
      north: row.north_map_id,
      east: row.east_map_id,
      south: row.south_map_id,
      west: row.west_map_id,
    },
  };
}

function mapTaxonomyRow(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description || '',
    isActive: Boolean(row.is_active),
  };
}

async function reloadGameConfig() {
  try {
    const [mapRows] = await db.execute(
      'SELECT * FROM maps ORDER BY id',
    );
    mapsById.clear();

    for (const row of mapRows) {
      const map = mapMapRow(row);
      mapsById.set(map.id, map);
    }

    const [rows] = await db.execute(
      `SELECT gs.game_name, m.*
        FROM game_settings gs
        JOIN maps m ON m.id = gs.default_map_id
        WHERE gs.id = 1
        LIMIT 1`,
    );

    if (!rows[0]) {
      gameConfig = DEFAULT_GAME_CONFIG;
      mapsById.set(DEFAULT_GAME_CONFIG.map.id, DEFAULT_GAME_CONFIG.map);
      return;
    }

    gameConfig = {
      gameName: rows[0].game_name,
      map: mapMapRow(rows[0]),
    };
  } catch (error) {
    console.warn('Using fallback game config:', error.code || error.message);
    gameConfig = DEFAULT_GAME_CONFIG;
    mapsById.clear();
    mapsById.set(DEFAULT_GAME_CONFIG.map.id, DEFAULT_GAME_CONFIG.map);
  }
}

function getMapForPlayer(player) {
  return mapsById.get(player?.mapId) || gameConfig.map;
}

function getWorldWidth(map = gameConfig.map) {
  return map.widthCells * map.cellSize;
}

function getWorldHeight(map = gameConfig.map) {
  return map.heightCells * map.cellSize;
}

function normalizeText(value, minLength, maxLength) {
  const text = String(value || '').trim();

  if (text.length < minLength || text.length > maxLength) {
    throw Object.assign(new Error('Texto invalido.'), { statusCode: 400 });
  }

  return text;
}

function normalizeColor(value, fallback) {
  const color = String(value || fallback).trim();

  if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
    throw Object.assign(new Error('Cor invalida.'), { statusCode: 400 });
  }

  return color;
}

function toPositiveInt(value, message) {
  const number = Number(value);

  if (!Number.isInteger(number) || number <= 0) {
    throw Object.assign(new Error(message), { statusCode: 400 });
  }

  return number;
}

function toBoundedInt(value, min, max, message) {
  const number = Number(value);

  if (!Number.isInteger(number) || number < min || number > max) {
    throw Object.assign(new Error(message), { statusCode: 400 });
  }

  return number;
}

function toBoundedFloat(value, min, max, message) {
  const number = Number(value);

  if (!Number.isFinite(number) || number < min || number > max) {
    throw Object.assign(new Error(message), { statusCode: 400 });
  }

  return Math.round(number * 100) / 100;
}

function nullablePositiveInt(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  return toPositiveInt(value, 'Mapa de saida invalido.');
}

async function register(request, response) {
  const body = await readRequestBody(request);
  const username = String(body.username || '').trim();
  const password = String(body.password || '');

  if (!isValidUsername(username)) {
    sendJson(response, 400, { error: 'Use um nome de usuario com 3 a 20 letras, numeros ou underscore.' });
    return;
  }

  if (password.length < 6) {
    sendJson(response, 400, { error: 'A senha precisa ter pelo menos 6 caracteres.' });
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  try {
    const [result] = await db.execute(
      'INSERT INTO users (username, password_hash) VALUES (?, ?)',
      [username, passwordHash],
    );

    const token = createToken({ id: result.insertId, username });
    sendJson(response, 201, { token, user: { id: result.insertId, username } });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      sendJson(response, 409, { error: 'Esse nome de usuario ja esta em uso.' });
      return;
    }

    throw error;
  }
}

async function login(request, response) {
  const body = await readRequestBody(request);
  const username = String(body.username || '').trim();
  const password = String(body.password || '');

  const [rows] = await db.execute(
    'SELECT id, username, password_hash FROM users WHERE username = ? LIMIT 1',
    [username],
  );

  const user = rows[0];
  const isPasswordValid = user ? await bcrypt.compare(password, user.password_hash) : false;

  if (!user || !isPasswordValid) {
    sendJson(response, 401, { error: 'Usuario ou senha invalidos.' });
    return;
  }

  const token = createToken({ id: user.id, username: user.username });
  sendJson(response, 200, { token, user: { id: user.id, username: user.username } });
}

function createToken(user) {
  return jwt.sign(user, JWT_SECRET, { expiresIn: '7d' });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch {
    return null;
  }
}

function isValidUsername(username) {
  return /^[a-zA-Z0-9_]{3,20}$/.test(username);
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let rawBody = '';

    request.on('data', (chunk) => {
      rawBody += chunk;

      if (rawBody.length > MAX_REQUEST_BODY_SIZE) {
        request.destroy();
      }
    });

    request.on('end', () => {
      try {
        if (!rawBody) {
          resolve({});
          return;
        }

        if (isFormUrlEncoded(request)) {
          resolve(Object.fromEntries(new URLSearchParams(rawBody)));
          return;
        }

        resolve(JSON.parse(rawBody));
      } catch (error) {
        reject(error);
      }
    });

    request.on('error', reject);
  });
}

function isFormUrlEncoded(request) {
  return String(request.headers['content-type'] || '').includes('application/x-www-form-urlencoded');
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

function handleUnexpectedError(error, response) {
  console.error('Unexpected server error:', {
    code: error.code,
    errno: error.errno,
    sqlState: error.sqlState,
    message: error.message,
  });

  if (error.code === 'ER_NO_SUCH_TABLE') {
    sendJson(response, 500, { error: 'Banco de dados ainda nao preparado. Importe o schema das tabelas.' });
    return;
  }

  if (error.statusCode) {
    sendJson(response, error.statusCode, { error: error.message });
    return;
  }

  if (['ECONNREFUSED', 'ER_ACCESS_DENIED_ERROR', 'ENOTFOUND'].includes(error.code)) {
    sendJson(response, 500, { error: 'Nao foi possivel conectar ao banco de dados.' });
    return;
  }

  sendJson(response, 500, { error: 'Erro interno do servidor.' });
}

function serveStaticFile(request, response) {
  const url = new URL(request.url, `http://localhost:${PORT}`);
  const requestedPath = url.pathname === '/' ? '/index.html' : url.pathname;
  const filePath = path.resolve(CLIENT_DIR, `.${decodeURIComponent(requestedPath)}`);

  if (!filePath.startsWith(`${CLIENT_DIR}${path.sep}`) && filePath !== CLIENT_DIR) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }

    response.writeHead(200, { 'Content-Type': getContentType(filePath) });
    response.end(content);
  });
}

function getContentType(filePath) {
  const extension = path.extname(filePath);

  if (extension === '.html') return 'text/html; charset=utf-8';
  if (extension === '.js') return 'text/javascript; charset=utf-8';
  if (extension === '.css') return 'text/css; charset=utf-8';
  if (extension === '.json') return 'application/json; charset=utf-8';
  if (extension === '.png') return 'image/png';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.webp') return 'image/webp';

  return 'application/octet-stream';
}

function createPlayer(id, user) {
  const map = gameConfig.map;
  const spawn = getMapEntryPosition(map);

  return {
    id,
    userId: user.id,
    username: user.username,
    mapId: map.id,
    x: spawn.x,
    y: spawn.y,
    direction: 'south',
    isMoving: false,
    disconnectedAt: null,
    removalTimer: null,
  };
}

function getOrCreatePlayer(socketId, user) {
  const existing = playersByUserId.get(user.id);

  if (existing) {
    clearTimeout(existing.removalTimer);
    existing.removalTimer = null;
    existing.disconnectedAt = null;
    existing.id = socketId;
    players.set(socketId, existing);
    return existing;
  }

  const player = createPlayer(socketId, user);
  playersByUserId.set(user.id, player);
  players.set(socketId, player);
  return player;
}

function resetPlayersToDefaultMapEntry() {
  for (const player of playersByUserId.values()) {
    movePlayerToMapEntry(player, gameConfig.map.id);
  }
}

function resetPlayersOnMapEntry(mapId) {
  for (const player of playersByUserId.values()) {
    if (player.mapId === mapId) {
      movePlayerToMapEntry(player, mapId);
    }
  }
}

function movePlayerToMapEntry(player, mapId) {
  const map = mapsById.get(mapId) || gameConfig.map;
  const spawn = getMapEntryPosition(map);

  player.mapId = map.id;
  player.x = spawn.x;
  player.y = spawn.y;
  player.isMoving = false;
  player.direction = 'south';
}

function schedulePlayerRemoval(player, socketId) {
  player.isMoving = false;
  player.disconnectedAt = Date.now();
  players.delete(socketId);

  clearTimeout(player.removalTimer);
  player.removalTimer = setTimeout(() => {
    if (player.disconnectedAt) {
      playersByUserId.delete(player.userId);
      broadcastGameState();
    }
  }, PLAYER_DISCONNECT_GRACE_MS);
}

function getMapEntryPosition(map) {
  const cellSize = map.cellSize;
  const column = clamp(map.entryColumn || 1, 1, map.widthCells);
  const row = clamp(map.entryRow || 1, 1, map.heightCells);

  return {
    x: clamp((column - 0.5) * cellSize - PLAYER_SIZE / 2, 0, getWorldWidth(map) - PLAYER_SIZE),
    y: clamp((row - 0.5) * cellSize - PLAYER_SIZE / 2, 0, getWorldHeight(map) - PLAYER_SIZE),
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

async function broadcastGameState() {
  for (const client of wss.clients) {
    if (client.readyState !== WebSocket.OPEN) {
      continue;
    }

    client.send(JSON.stringify(await createGameStateMessage(client.player)));
  }
}

async function createGameStateMessage(viewer) {
  const map = getMapForPlayer(viewer);
  const visiblePlayers = Array.from(players.values()).filter((player) => player.mapId === map.id);

  return {
    type: 'state',
    ...createGameConfigPayload(map, await readMapData(map)),
    players: visiblePlayers,
  };
}

function createGameConfigPayload(map, mapData = createDefaultMapData(map)) {
  return {
    version: APP_VERSION,
    game: {
      name: gameConfig.gameName,
    },
    world: {
      width: getWorldWidth(map),
      height: getWorldHeight(map),
      widthCells: map.widthCells,
      heightCells: map.heightCells,
      cellSize: map.cellSize,
      characterSize: map.characterSize,
      movementSpeed: map.movementSpeed,
      entryColumn: map.entryColumn,
      entryRow: map.entryRow,
      backgroundColor: map.backgroundColor,
      backgroundImagePath: map.backgroundImagePath,
      mapDataPath: map.mapDataPath || getMapDataPublicPath(map.id),
      gridColor: map.gridColor,
      mapId: map.id,
      mapName: map.name,
      exits: map.exits,
      blockedCells: mapData.blockedCells,
      teleportPoints: mapData.teleportPoints,
      speedCells: mapData.speedCells,
      levelCells: mapData.levelCells,
    },
  };
}

async function handleMove(player, dx, dy) {
  const map = getMapForPlayer(player);
  const mapData = await readMapData(map);
  const normalizedDx = Math.sign(Number(dx) || 0);
  const normalizedDy = Math.sign(Number(dy) || 0);

  player.isMoving = normalizedDx !== 0 || normalizedDy !== 0;

  if (player.isMoving) {
    player.direction = getPlayerDirection(normalizedDx, normalizedDy);
  }

  const movementSpeed = getMovementSpeedForPlayer(player, map, mapData);
  const nextX = player.x + normalizedDx * movementSpeed;
  const nextY = player.y + normalizedDy * movementSpeed;

  if (!isBlockedPosition(nextX, nextY, map, mapData)) {
    player.x = nextX;
    player.y = nextY;
  }

  if (tryTeleportAtMapEdge(player, map)) {
    return;
  }

  if (tryTeleportAtCell(player, map, mapData)) {
    return;
  }

  player.x = clamp(player.x, 0, getWorldWidth(map) - PLAYER_SIZE);
  player.y = clamp(player.y, 0, getWorldHeight(map) - PLAYER_SIZE);
}

function getMovementSpeedForPlayer(player, map, mapData) {
  const cell = getCellFromPosition(player.x + PLAYER_SIZE / 2, player.y + PLAYER_SIZE / 2, map);
  const speedCell = [...(mapData.speedCells || [])]
    .reverse()
    .find((item) => item.column === cell.column && item.row === cell.row);
  const multiplier = speedCell ? Number(speedCell.multiplier || 1) : 1;

  return clamp(Number(map.movementSpeed || 5) * multiplier, 0.5, 40);
}

function tryTeleportAtMapEdge(player, map) {
  const worldWidth = getWorldWidth(map);
  const worldHeight = getWorldHeight(map);

  if (player.x < 0 && map.exits.west) {
    teleportPlayer(player, map.exits.west, 'west');
    return true;
  }

  if (player.x > worldWidth - PLAYER_SIZE && map.exits.east) {
    teleportPlayer(player, map.exits.east, 'east');
    return true;
  }

  if (player.y < 0 && map.exits.north) {
    teleportPlayer(player, map.exits.north, 'north');
    return true;
  }

  if (player.y > worldHeight - PLAYER_SIZE && map.exits.south) {
    teleportPlayer(player, map.exits.south, 'south');
    return true;
  }

  return false;
}

function isBlockedPosition(x, y, map, mapData) {
  const blocked = new Set(mapData.blockedCells);
  const probeCells = [
    getCellFromPosition(x + PLAYER_SIZE / 2, y + PLAYER_SIZE / 2, map),
    getCellFromPosition(x + 3, y + 3, map),
    getCellFromPosition(x + PLAYER_SIZE - 3, y + 3, map),
    getCellFromPosition(x + 3, y + PLAYER_SIZE - 3, map),
    getCellFromPosition(x + PLAYER_SIZE - 3, y + PLAYER_SIZE - 3, map),
  ];

  return probeCells.some((cell) => blocked.has(`${cell.column},${cell.row}`));
}

function tryTeleportAtCell(player, map, mapData) {
  const cell = getCellFromPosition(player.x + PLAYER_SIZE / 2, player.y + PLAYER_SIZE / 2, map);
  const point = mapData.teleportPoints.find((teleportPoint) => (
    teleportPoint.column === cell.column && teleportPoint.row === cell.row
  ));

  if (!point) {
    return false;
  }

  teleportPlayerToCell(player, point.targetMapId, point.targetColumn, point.targetRow);
  return true;
}

function getCellFromPosition(x, y, map) {
  return {
    column: clamp(Math.floor(x / map.cellSize) + 1, 1, map.widthCells),
    row: clamp(Math.floor(y / map.cellSize) + 1, 1, map.heightCells),
  };
}

function getCellKey(column, row) {
  return `${column},${row}`;
}

function teleportPlayer(player, targetMapId, fromDirection) {
  const targetMap = mapsById.get(targetMapId);

  if (!targetMap) {
    return;
  }

  player.mapId = targetMap.id;

  if (fromDirection === 'west') {
    player.x = getWorldWidth(targetMap) - PLAYER_SIZE - targetMap.cellSize;
    player.y = clamp(player.y, 0, getWorldHeight(targetMap) - PLAYER_SIZE);
    return;
  }

  if (fromDirection === 'east') {
    player.x = targetMap.cellSize;
    player.y = clamp(player.y, 0, getWorldHeight(targetMap) - PLAYER_SIZE);
    return;
  }

  if (fromDirection === 'north') {
    player.x = clamp(player.x, 0, getWorldWidth(targetMap) - PLAYER_SIZE);
    player.y = getWorldHeight(targetMap) - PLAYER_SIZE - targetMap.cellSize;
    return;
  }

  if (fromDirection === 'south') {
    player.x = clamp(player.x, 0, getWorldWidth(targetMap) - PLAYER_SIZE);
    player.y = targetMap.cellSize;
  }
}

function teleportPlayerToCell(player, targetMapId, column, row) {
  const targetMap = mapsById.get(targetMapId);

  if (!targetMap) {
    return;
  }

  player.mapId = targetMap.id;
  player.x = clamp((column - 0.5) * targetMap.cellSize - PLAYER_SIZE / 2, 0, getWorldWidth(targetMap) - PLAYER_SIZE);
  player.y = clamp((row - 0.5) * targetMap.cellSize - PLAYER_SIZE / 2, 0, getWorldHeight(targetMap) - PLAYER_SIZE);
  player.isMoving = false;
}

function getPlayerDirection(dx, dy) {
  if (dy < 0 && dx > 0) return 'north-east';
  if (dy < 0 && dx < 0) return 'north-west';
  if (dy > 0 && dx > 0) return 'south-east';
  if (dy > 0 && dx < 0) return 'south-west';
  if (dy < 0) return 'north';
  if (dy > 0) return 'south';
  if (dx > 0) return 'east';
  if (dx < 0) return 'west';

  return 'south';
}

wss.on('connection', (socket, request) => {
  const url = new URL(request.url, `http://localhost:${PORT}`);
  const user = verifyToken(url.searchParams.get('token'));

  if (!user) {
    socket.close(1008, 'Unauthorized');
    return;
  }

  const playerId = crypto.randomUUID();
  const player = getOrCreatePlayer(playerId, user);
  socket.isAlive = true;
  socket.player = player;

  console.log(`Player connected: ${user.username} (${playerId})`);
  broadcastGameState();

  socket.on('pong', () => {
    socket.isAlive = true;
  });

  socket.on('message', async (rawMessage) => {
    try {
      const message = JSON.parse(rawMessage.toString());
      socket.isAlive = true;

      if (message.type === 'move') {
        await handleMove(player, message.dx, message.dy);
        await broadcastGameState();
        return;
      }

      if (message.type === 'ping') {
        socket.send(JSON.stringify({ type: 'pong', at: Date.now() }));
      }
    } catch (error) {
      console.warn(`Invalid message from ${user.username}:`, error.message);
    }
  });

  socket.on('close', () => {
    schedulePlayerRemoval(player, playerId);
    console.log(`Player disconnected: ${user.username} (${playerId})`);
    broadcastGameState();
  });
});

reloadGameConfig().finally(() => {
  server.listen(PORT, () => {
    console.log(`Client running on http://localhost:${PORT}`);
    console.log(`WebSocket server running on ws://localhost:${PORT}`);
  });
});
