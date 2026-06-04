const canvas = document.getElementById('gameCanvas');
const context = canvas.getContext('2d');
context.imageSmoothingEnabled = false;
const token = localStorage.getItem('authToken');
const username = localStorage.getItem('username');
const usernameElement = document.querySelector('[data-username]');
const logoutButton = document.querySelector('[data-logout]');
const gameTitleElement = document.querySelector('[data-game-title]');
const connectionStatusElement = document.querySelector('[data-connection-status]');

if (!token) {
  window.location.href = '/';
}

if (usernameElement) {
  usernameElement.textContent = username ? `Logado como ${username}` : '';
}

if (logoutButton) {
  logoutButton.addEventListener('click', () => {
    localStorage.removeItem('authToken');
    localStorage.removeItem('username');
    window.location.href = '/';
  });
}

const socketProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const socketUrl = `${socketProtocol}//${window.location.host}?token=${encodeURIComponent(token)}`;

const players = new Map();
const pressedKeys = new Set();

const PLAYER_SIZE = 24;
const BACKGROUND_COLOR = '#111217';
const GRID_LABEL_COLOR = 'rgba(227, 218, 200, 0.58)';
const WORLD_BORDER_COLOR = 'rgba(185, 139, 87, 0.28)';
const PLAYER_SKIN_COLOR = '#c9a06d';
const PLAYER_CLOAK_COLOR = '#5f2630';
const PLAYER_ARMOR_COLOR = '#8f8270';
const PLAYER_OUTLINE_COLOR = '#1b1110';
const PLAYER_STEEL_COLOR = '#c3c7bf';
const DEFAULT_CHARACTER_DIRECTION = 'south';
const CELL_LEVEL_SCALES = {
  1: 0.8,
  2: 0.9,
  3: 1,
  4: 1.1,
  5: 1.2,
};
const MIN_CAMERA_ZOOM = 0.8;
const MAX_CAMERA_ZOOM = 1.2;
const ZOOM_STEP = 0.2;
const MOVEMENT_SEND_INTERVAL_MS = 50;
const MAX_MOVEMENT_ELAPSED_MS = 120;
const DEFAULT_WORLD = {
  width: 32000,
  height: 32000,
  widthCells: 1000,
  heightCells: 1000,
  cellSize: 32,
  characterSize: 64,
  movementSpeed: 5,
  backgroundColor: '#15161d',
  backgroundImagePath: null,
  mapDataPath: '/assets/maps/data/map-1.json',
  blockedCells: [],
  teleportPoints: [],
  speedCells: [],
  levelCells: [],
  gridColor: 'rgba(185, 139, 87, 0.08)',
  showGrid: true,
  showCoordinates: true,
  mapId: 1,
  mapName: 'Mapa Inicial',
  exits: {
    north: null,
    east: null,
    south: null,
    west: null,
  },
};
const CHARACTER_SPRITE_SOURCES = {
  north: '/assets/char/rotations/north.png',
  'north-east': '/assets/char/rotations/north-east.png',
  east: '/assets/char/rotations/east.png',
  'south-east': '/assets/char/rotations/south-east.png',
  south: '/assets/char/rotations/south.png',
  'south-west': '/assets/char/rotations/south-west.png',
  west: '/assets/char/rotations/west.png',
  'north-west': '/assets/char/rotations/north-west.png',
};
const LEGACY_DIRECTIONS = {
  up: 'north',
  right: 'east',
  down: 'south',
  left: 'west',
};
const fallbackCharacterSprites = Object.fromEntries(
  Object.entries(CHARACTER_SPRITE_SOURCES).map(([direction, source]) => {
    const image = new Image();
    image.src = source;
    return [direction, image];
  }),
);
const backgroundImages = new Map();
const raceSpriteSets = new Map();
let lastSentDirection = { dx: 0, dy: 0 };
let world = { ...DEFAULT_WORLD };
let camera = { x: 0, y: 0 };
let cameraZoom = 1;
let clickMoveTarget = null;
let socket = null;
let heartbeatId = null;
let reconnectId = null;
let reconnectAttempts = 0;
let lastMovementSentAt = 0;
const activeTouchPointers = new Map();
let pinchGesture = null;

resizeCanvasToViewport();
window.addEventListener('resize', resizeCanvasToViewport);
window.visualViewport?.addEventListener('resize', resizeCanvasToViewport);

connectSocket();
loadGameConfig();
setInterval(loadGameConfig, 7000);

function connectSocket() {
  clearTimeout(reconnectId);
  setConnectionStatus('Conectando', true);

  socket = new WebSocket(socketUrl);

  socket.addEventListener('open', () => {
    reconnectAttempts = 0;
    lastSentDirection = { dx: 0, dy: 0 };
    lastMovementSentAt = 0;
    setConnectionStatus('Online', false);
    startHeartbeat();
    sendMovementIntent(true);
    console.log('Connected to game server.');
  });

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);

    if (message.type === 'state') {
      applyStateMessage(message);
    }
  });

  socket.addEventListener('close', () => {
    stopHeartbeat();
    scheduleReconnect();
    console.log('Disconnected from game server.');
  });

  socket.addEventListener('error', () => {
    setConnectionStatus('Instavel', true);
  });
}

function applyStateMessage(message) {
  if (message.game?.name) {
    document.title = `Jogo - ${message.game.name}`;

    if (gameTitleElement) {
      gameTitleElement.textContent = message.game.name;
    }
  }

  if (message.world) {
    const previousMapId = world.mapId;
    world = {
      ...DEFAULT_WORLD,
      ...message.world,
      width: Number(message.world.width) || DEFAULT_WORLD.width,
      height: Number(message.world.height) || DEFAULT_WORLD.height,
      widthCells: Number(message.world.widthCells) || DEFAULT_WORLD.widthCells,
      heightCells: Number(message.world.heightCells) || DEFAULT_WORLD.heightCells,
      cellSize: Number(message.world.cellSize) || DEFAULT_WORLD.cellSize,
      characterSize: Number(message.world.characterSize) || DEFAULT_WORLD.characterSize,
      movementSpeed: Number(message.world.movementSpeed) || DEFAULT_WORLD.movementSpeed,
      blockedCells: Array.isArray(message.world.blockedCells) ? message.world.blockedCells : [],
      teleportPoints: Array.isArray(message.world.teleportPoints) ? message.world.teleportPoints : [],
      speedCells: Array.isArray(message.world.speedCells) ? message.world.speedCells : [],
      levelCells: Array.isArray(message.world.levelCells) ? message.world.levelCells : [],
      showGrid: message.world.showGrid !== false,
      showCoordinates: message.world.showCoordinates !== false,
    };

    if (world.mapId !== previousMapId) {
      camera = { x: 0, y: 0 };
    }

    preloadBackgroundImage(world.backgroundImagePath);
  }

  if (!Array.isArray(message.players)) {
    return;
  }

  players.clear();

  for (const player of message.players) {
    preloadRaceSpriteSet(player.race);
    players.set(player.id, player);
  }
}

async function loadGameConfig() {
  try {
    const response = await fetch('/api/game-config', { cache: 'no-store' });

    if (!response.ok) {
      return;
    }

    applyStateMessage(await response.json());
  } catch {
    // WebSocket state remains the primary source while HTTP config is unavailable.
  }
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatId = setInterval(() => {
    sendSocketMessage({ type: 'ping', at: Date.now() });
  }, 15000);
}

function stopHeartbeat() {
  clearInterval(heartbeatId);
  heartbeatId = null;
}

function scheduleReconnect() {
  setConnectionStatus('Reconectando', true);
  const delay = Math.min(12000, 1000 * 2 ** reconnectAttempts);
  reconnectAttempts += 1;
  reconnectId = setTimeout(connectSocket, delay);
}

function sendSocketMessage(message) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return false;
  }

  socket.send(JSON.stringify(message));
  return true;
}

function setConnectionStatus(text, isOffline) {
  if (!connectionStatusElement) {
    return;
  }

  connectionStatusElement.textContent = text;
  connectionStatusElement.classList.toggle('offline', isOffline);
}

window.addEventListener('keydown', (event) => {
  if (isMovementKey(event.key)) {
    clickMoveTarget = null;
    pressedKeys.add(event.key.toLowerCase());
    sendMovementIntent(true);
    event.preventDefault();
  }
});

window.addEventListener('keyup', (event) => {
  if (isMovementKey(event.key)) {
    pressedKeys.delete(event.key.toLowerCase());
    event.preventDefault();
  }
});

function isMovementKey(key) {
  return ['w', 'a', 's', 'd', 'arrowup', 'arrowleft', 'arrowdown', 'arrowright'].includes(key.toLowerCase());
}

canvas.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) {
    return;
  }

  event.preventDefault();
  canvas.setPointerCapture?.(event.pointerId);
  clickMoveTarget = null;

  if (event.pointerType === 'touch') {
    activeTouchPointers.set(event.pointerId, getCanvasPoint(event));

    if (activeTouchPointers.size >= 2) {
      startPinchGesture();
      sendMovementIntent(true);
      return;
    }
  }

  const cell = getClickedCell(event);

  if (!cell || isBlockedClickTarget(cell)) {
    pressedKeys.clear();
    sendMovementIntent(true);
    return;
  }

  pressedKeys.clear();
  clickMoveTarget = {
    mapId: world.mapId,
    column: cell.column,
    row: cell.row,
  };
  sendMovementIntent(true);
});

canvas.addEventListener('pointermove', (event) => {
  if (event.pointerType !== 'touch' || !activeTouchPointers.has(event.pointerId)) {
    return;
  }

  activeTouchPointers.set(event.pointerId, getCanvasPoint(event));

  if (activeTouchPointers.size < 2) {
    return;
  }

  event.preventDefault();
  updatePinchZoom();
});

canvas.addEventListener('pointerup', endTouchPointer);
canvas.addEventListener('pointercancel', endTouchPointer);

canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  const direction = event.deltaY < 0 ? 1 : -1;
  zoomAtCanvasPoint(getCanvasPoint(event), cameraZoom + direction * ZOOM_STEP);
}, { passive: false });

function getMovementDirection() {
  let dx = 0;
  let dy = 0;

  if (pressedKeys.has('a') || pressedKeys.has('arrowleft')) dx -= 1;
  if (pressedKeys.has('d') || pressedKeys.has('arrowright')) dx += 1;
  if (pressedKeys.has('w') || pressedKeys.has('arrowup')) dy -= 1;
  if (pressedKeys.has('s') || pressedKeys.has('arrowdown')) dy += 1;

  if (dx !== 0 || dy !== 0) {
    return { dx, dy };
  }

  return getClickMoveDirection();
}

function getClickMoveDirection() {
  const player = getLocalPlayer();

  if (!clickMoveTarget || clickMoveTarget.mapId !== world.mapId) {
    clickMoveTarget = null;
    return { dx: 0, dy: 0 };
  }

  if (!player) {
    return { dx: 0, dy: 0 };
  }

  const currentCell = getPlayerCell(player);

  if (currentCell.column === clickMoveTarget.column && currentCell.row === clickMoveTarget.row) {
    clickMoveTarget = null;
    return { dx: 0, dy: 0 };
  }

  return {
    dx: Math.sign(clickMoveTarget.column - currentCell.column),
    dy: Math.sign(clickMoveTarget.row - currentCell.row),
  };
}

function sendMovementIntent(force = false) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }

  const now = performance.now();
  const { dx, dy } = getMovementDirection();
  const changedDirection = dx !== lastSentDirection.dx || dy !== lastSentDirection.dy;

  if (!force && !changedDirection && now - lastMovementSentAt < MOVEMENT_SEND_INTERVAL_MS) {
    return;
  }

  if (force || dx !== 0 || dy !== 0 || changedDirection) {
    const elapsedMs = lastMovementSentAt > 0
      ? clamp(now - lastMovementSentAt, 0, MAX_MOVEMENT_ELAPSED_MS)
      : MOVEMENT_SEND_INTERVAL_MS;
    sendSocketMessage({ type: 'move', dx, dy, elapsedMs });
    lastSentDirection = { dx, dy };
    lastMovementSentAt = now;
  }
}

function updateCamera() {
  const target = getCameraTarget();

  if (!target) {
    return;
  }

  const marginX = canvas.width * 0.34;
  const marginY = canvas.height * 0.32;
  const viewportWidth = getViewportWidth();
  const viewportHeight = getViewportHeight();
  const targetScreenX = target.x + PLAYER_SIZE / 2 - camera.x;
  const targetScreenY = target.y + PLAYER_SIZE / 2 - camera.y;
  let nextCameraX = camera.x;
  let nextCameraY = camera.y;

  if (targetScreenX > viewportWidth - marginX / cameraZoom) {
    nextCameraX = target.x + PLAYER_SIZE / 2 - (viewportWidth - marginX / cameraZoom);
  } else if (targetScreenX < marginX / cameraZoom) {
    nextCameraX = target.x + PLAYER_SIZE / 2 - marginX / cameraZoom;
  }

  if (targetScreenY > viewportHeight - marginY / cameraZoom) {
    nextCameraY = target.y + PLAYER_SIZE / 2 - (viewportHeight - marginY / cameraZoom);
  } else if (targetScreenY < marginY / cameraZoom) {
    nextCameraY = target.y + PLAYER_SIZE / 2 - marginY / cameraZoom;
  }

  camera = {
    x: clamp(nextCameraX, 0, Math.max(0, world.width - viewportWidth)),
    y: clamp(nextCameraY, 0, Math.max(0, world.height - viewportHeight)),
  };
}

function getCameraTarget() {
  return getLocalPlayer() || players.values().next().value;
}

function getLocalPlayer() {
  return Array.from(players.values()).find((player) => player.username === username) || null;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function appendAssetVersion(source, version) {
  if (!source || !version) {
    return source;
  }

  return `${source}${source.includes('?') ? '&' : '?'}v=${encodeURIComponent(version)}`;
}

function getViewportWidth() {
  return canvas.width / cameraZoom;
}

function getViewportHeight() {
  return canvas.height / cameraZoom;
}

function clampCameraToWorld() {
  camera = {
    x: clamp(camera.x, 0, Math.max(0, world.width - getViewportWidth())),
    y: clamp(camera.y, 0, Math.max(0, world.height - getViewportHeight())),
  };
}

function resizeCanvasToViewport() {
  const rect = canvas.getBoundingClientRect();
  const nextWidth = Math.max(320, Math.round(rect.width || window.innerWidth || canvas.width));
  const nextHeight = Math.max(240, Math.round(rect.height || window.innerHeight || canvas.height));

  if (canvas.width === nextWidth && canvas.height === nextHeight) {
    return;
  }

  canvas.width = nextWidth;
  canvas.height = nextHeight;
  context.imageSmoothingEnabled = false;
  clampCameraToWorld();
}

function getCanvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = rect.width > 0 ? canvas.width / rect.width : 1;
  const scaleY = rect.height > 0 ? canvas.height / rect.height : 1;

  return {
    x: (event.clientX - rect.left) * scaleX,
    y: (event.clientY - rect.top) * scaleY,
  };
}

function zoomAtCanvasPoint(point, nextZoom) {
  const clampedZoom = clamp(Math.round(nextZoom * 100) / 100, MIN_CAMERA_ZOOM, MAX_CAMERA_ZOOM);

  if (clampedZoom === cameraZoom) {
    return;
  }

  const worldPoint = {
    x: camera.x + point.x / cameraZoom,
    y: camera.y + point.y / cameraZoom,
  };

  cameraZoom = clampedZoom;
  camera = {
    x: worldPoint.x - point.x / cameraZoom,
    y: worldPoint.y - point.y / cameraZoom,
  };
  clampCameraToWorld();
}

function startPinchGesture() {
  const points = [...activeTouchPointers.values()].slice(0, 2);
  pinchGesture = {
    distance: getPointDistance(points[0], points[1]),
    zoom: cameraZoom,
  };
}

function updatePinchZoom() {
  const points = [...activeTouchPointers.values()].slice(0, 2);

  if (!pinchGesture || points.length < 2) {
    startPinchGesture();
    return;
  }

  const distance = getPointDistance(points[0], points[1]);
  const midpoint = {
    x: (points[0].x + points[1].x) / 2,
    y: (points[0].y + points[1].y) / 2,
  };

  if (pinchGesture.distance > 0) {
    zoomAtCanvasPoint(midpoint, pinchGesture.zoom * (distance / pinchGesture.distance));
  }
}

function endTouchPointer(event) {
  if (event.pointerType !== 'touch') {
    return;
  }

  activeTouchPointers.delete(event.pointerId);

  if (activeTouchPointers.size < 2) {
    pinchGesture = null;
  } else {
    startPinchGesture();
  }
}

function getPointDistance(first, second) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function renderBackground() {
  context.fillStyle = BACKGROUND_COLOR;
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.save();
  context.scale(cameraZoom, cameraZoom);
  context.translate(-camera.x, -camera.y);

  context.fillStyle = world.backgroundColor;
  context.fillRect(0, 0, world.width, world.height);
  renderWorldBackgroundImage();

  const viewportWidth = getViewportWidth();
  const viewportHeight = getViewportHeight();
  const firstGridX = Math.floor(camera.x / world.cellSize) * world.cellSize;
  const lastGridX = Math.min(world.width, camera.x + viewportWidth + world.cellSize);
  const firstGridY = Math.floor(camera.y / world.cellSize) * world.cellSize;
  const lastGridY = Math.min(world.height, camera.y + viewportHeight + world.cellSize);

  if (world.showGrid) {
    context.strokeStyle = world.gridColor;
    context.lineWidth = 1;

    for (let x = firstGridX; x <= lastGridX; x += world.cellSize) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x, world.height);
      context.stroke();
    }

    for (let y = firstGridY; y <= lastGridY; y += world.cellSize) {
      context.beginPath();
      context.moveTo(firstGridX, y);
      context.lineTo(lastGridX, y);
      context.stroke();
    }
  }

  context.strokeStyle = WORLD_BORDER_COLOR;
  context.strokeRect(0.5, 0.5, world.width - 1, world.height - 1);
  context.restore();

  if (world.showCoordinates) {
    context.save();
    context.scale(cameraZoom, cameraZoom);
    renderGridLabels(firstGridX, lastGridX, firstGridY, lastGridY);
    renderActiveCellLabel();
    context.restore();
  }
  context.save();
  context.scale(cameraZoom, cameraZoom);
  renderClickMoveTarget();
  context.restore();
}

function preloadBackgroundImage(source) {
  if (!source || backgroundImages.has(source)) {
    return;
  }

  const image = new Image();
  image.src = appendAssetVersion(source, world.mapId || '');
  backgroundImages.set(source, image);
}

function renderWorldBackgroundImage() {
  const image = world.backgroundImagePath ? backgroundImages.get(world.backgroundImagePath) : null;

  if (!image || !image.complete || image.naturalWidth === 0) {
    return;
  }

  context.drawImage(image, 0, 0, world.width, world.height);
}

function renderGridLabels(firstGridX, lastGridX, firstGridY, lastGridY) {
  context.save();
  context.font = '11px Arial';
  context.fillStyle = GRID_LABEL_COLOR;
  context.textAlign = 'left';
  context.textBaseline = 'top';

  for (let x = firstGridX; x <= lastGridX; x += world.cellSize) {
    const column = Math.floor(x / world.cellSize) + 1;
    context.fillText(String(column), Math.round(x - camera.x + 4), 4);
  }

  context.textAlign = 'right';

  for (let y = firstGridY; y <= lastGridY; y += world.cellSize) {
    const row = Math.floor(y / world.cellSize) + 1;
    context.fillText(String(row), 28, Math.round(y - camera.y + 4));
  }

  context.restore();
}

function renderActiveCellLabel() {
  const target = getCameraTarget();

  if (!target) {
    return;
  }

  const { column, row } = getPlayerCell(target);
  const label = `${world.mapName} | Col ${column + 1} / Lin ${row + 1}`;

  context.save();
  context.font = '13px Arial';
  context.textAlign = 'left';
  context.textBaseline = 'top';
  const labelWidth = Math.min(getViewportWidth() - 24, Math.max(172, context.measureText(label).width + 20));
  context.fillStyle = 'rgba(8, 9, 13, 0.78)';
  context.fillRect(12, 12, labelWidth, 26);
  context.strokeStyle = 'rgba(185, 139, 87, 0.42)';
  context.strokeRect(12.5, 12.5, labelWidth - 1, 25);
  context.fillStyle = '#e3dac8';
  context.fillText(label, 22, 18);
  context.restore();
}

function getPlayerCell(player) {
  return {
    column: clamp(Math.floor((player.x + PLAYER_SIZE / 2) / world.cellSize), 0, world.widthCells - 1),
    row: clamp(Math.floor((player.y + PLAYER_SIZE / 2) / world.cellSize), 0, world.heightCells - 1),
  };
}

function getClickedCell(event) {
  const point = getCanvasPoint(event);
  const worldX = point.x / cameraZoom + camera.x;
  const worldY = point.y / cameraZoom + camera.y;
  const column = Math.floor(worldX / world.cellSize);
  const row = Math.floor(worldY / world.cellSize);

  if (column < 0 || column >= world.widthCells || row < 0 || row >= world.heightCells) {
    return null;
  }

  return { column, row };
}

function isBlockedClickTarget(cell) {
  return world.blockedCells.includes(`${cell.column + 1},${cell.row + 1}`);
}

function renderClickMoveTarget() {
  if (!clickMoveTarget || clickMoveTarget.mapId !== world.mapId) {
    return;
  }

  const x = clickMoveTarget.column * world.cellSize - camera.x;
  const y = clickMoveTarget.row * world.cellSize - camera.y;
  const size = world.cellSize;

  if (x + size < 0 || y + size < 0 || x > getViewportWidth() || y > getViewportHeight()) {
    return;
  }

  context.save();
  context.strokeStyle = 'rgba(96, 165, 250, 0.95)';
  context.lineWidth = 2;
  context.strokeRect(Math.round(x) + 2.5, Math.round(y) + 2.5, Math.max(4, size - 5), Math.max(4, size - 5));
  context.fillStyle = 'rgba(96, 165, 250, 0.18)';
  context.fillRect(Math.round(x) + 3, Math.round(y) + 3, Math.max(3, size - 6), Math.max(3, size - 6));
  context.restore();
}

function renderPlayers() {
  for (const player of players.values()) {
    const screenPlayer = getScreenPlayer(player);

    if (!isPlayerVisible(screenPlayer)) {
      continue;
    }

    renderCharacter(screenPlayer);

    context.fillStyle = '#e3dac8';
    context.font = '12px Arial';
    context.textAlign = 'center';
    context.fillText(player.username || 'Jogador', screenPlayer.x + PLAYER_SIZE / 2, getCharacterLabelY(screenPlayer));
  }
}

function getScreenPlayer(player) {
  return {
    ...player,
    worldX: player.x,
    worldY: player.y,
    x: player.x - camera.x,
    y: player.y - camera.y,
  };
}

function isPlayerVisible(player) {
  const characterSize = getCharacterSize(player);

  return (
    player.x > -characterSize &&
    player.x < getViewportWidth() + characterSize &&
    player.y > -characterSize &&
    player.y < getViewportHeight() + characterSize
  );
}

function getCharacterLabelY(player) {
  if (getCharacterSprite(player)) {
    return getCharacterDrawY(player) - 8;
  }

  return player.y - 8;
}

function renderCharacter(player) {
  if (getCharacterSprite(player)) {
    renderSpriteCharacter(player);
    return;
  }

  renderFallbackCharacter(player.x, player.y);
}

function renderSpriteCharacter(player) {
  const sprite = getCharacterSprite(player);
  const drawX = getCharacterDrawX(player);
  const drawY = getCharacterDrawY(player);
  const characterSize = getCharacterSize(player);

  context.fillStyle = 'rgba(0, 0, 0, 0.34)';
  context.fillRect(player.x - 7, player.y + PLAYER_SIZE / 2 + 9, PLAYER_SIZE + 14, 6);

  context.save();
  context.drawImage(sprite, drawX, drawY, characterSize, characterSize);
  context.restore();
}

function getCharacterDrawX(player) {
  return Math.round(player.x + PLAYER_SIZE / 2 - getCharacterSize(player) / 2);
}

function getCharacterDrawY(player) {
  return Math.round(player.y + PLAYER_SIZE / 2 - getCharacterSize(player) / 2);
}

function getCharacterSize(player) {
  const column = clamp(Math.floor(((player.worldX ?? player.x) + PLAYER_SIZE / 2) / world.cellSize) + 1, 1, world.widthCells);
  const row = clamp(Math.floor(((player.worldY ?? player.y) + PLAYER_SIZE / 2) / world.cellSize) + 1, 1, world.heightCells);
  const cell = world.levelCells.find((item) => item.column === column && item.row === row);
  const level = clamp(Number(cell?.level || 3), 1, 5);
  const scale = CELL_LEVEL_SCALES[level] || 1;

  return Math.round(world.characterSize * scale);
}

function getCharacterSprite(player) {
  const direction = LEGACY_DIRECTIONS[player.direction] || player.direction || DEFAULT_CHARACTER_DIRECTION;
  const raceSpriteSet = getRaceSpriteSet(player.race);
  const sprite = getAnimatedRaceSprite(raceSpriteSet, player, direction)
    || getIdleRaceSprite(raceSpriteSet, direction)
    || fallbackCharacterSprites[direction]
    || fallbackCharacterSprites[DEFAULT_CHARACTER_DIRECTION];

  return sprite && sprite.complete && sprite.naturalWidth > 0 ? sprite : null;
}

function preloadRaceSpriteSet(race) {
  if (!race?.spriteManifestPath || raceSpriteSets.has(race.spriteManifestPath)) {
    return;
  }

  const spriteSet = {
    status: 'loading',
    basePath: race.spriteBasePath || race.spriteManifestPath.split('/').slice(0, -1).join('/'),
    idleAnimationKey: race.idleAnimationKey || 'idle',
    walkAnimationKey: race.walkAnimationKey || null,
    rotations: {},
    animations: {},
  };

  raceSpriteSets.set(race.spriteManifestPath, spriteSet);

  fetch(`${race.spriteManifestPath}?v=${encodeURIComponent(race.walkAnimationKey || '')}`, { cache: 'force-cache' })
    .then((response) => (response.ok ? response.json() : null))
    .then((metadata) => {
      if (!metadata) {
        spriteSet.status = 'error';
        return;
      }

      hydrateRaceSpriteSet(spriteSet, metadata);
      spriteSet.status = 'ready';
    })
    .catch(() => {
      spriteSet.status = 'error';
    });
}

function hydrateRaceSpriteSet(spriteSet, metadata) {
  const frames = metadata.states?.[0]?.frames || {};
  const rotations = frames.rotations || {};

  for (const [direction, source] of Object.entries(rotations)) {
    spriteSet.rotations[direction] = createSpriteImage(resolveRaceAssetPath(spriteSet.basePath, source));
  }

  for (const [animationKey, directions] of Object.entries(frames.animations || {})) {
    spriteSet.animations[animationKey] = {};

    for (const [direction, sources] of Object.entries(directions || {})) {
      spriteSet.animations[animationKey][direction] = sources.map((source) => (
        createSpriteImage(resolveRaceAssetPath(spriteSet.basePath, source))
      ));
    }
  }

  if (!spriteSet.walkAnimationKey) {
    spriteSet.walkAnimationKey = Object.keys(spriteSet.animations)[0] || null;
  }
}

function getRaceSpriteSet(race) {
  if (!race?.spriteManifestPath) {
    return null;
  }

  const spriteSet = raceSpriteSets.get(race.spriteManifestPath);
  return spriteSet?.status === 'ready' ? spriteSet : null;
}

function getAnimatedRaceSprite(spriteSet, player, direction) {
  if (!spriteSet || !player.isMoving || !spriteSet.walkAnimationKey) {
    return null;
  }

  const frames = spriteSet.animations[spriteSet.walkAnimationKey]?.[direction]
    || spriteSet.animations[spriteSet.walkAnimationKey]?.[DEFAULT_CHARACTER_DIRECTION];

  if (!frames?.length) {
    return null;
  }

  return frames[Math.floor(performance.now() / 120) % frames.length];
}

function getIdleRaceSprite(spriteSet, direction) {
  if (!spriteSet) {
    return null;
  }

  return spriteSet.rotations[direction] || spriteSet.rotations[DEFAULT_CHARACTER_DIRECTION] || null;
}

function createSpriteImage(source) {
  const image = new Image();
  image.src = source;
  return image;
}

function resolveRaceAssetPath(basePath, source) {
  if (!source) {
    return '';
  }

  if (source.startsWith('/')) {
    return source;
  }

  return `${basePath.replace(/\/$/, '')}/${source.replace(/^\//, '')}`;
}

function renderFallbackCharacter(x, y) {
  const centerX = x + PLAYER_SIZE / 2;

  context.fillStyle = 'rgba(0, 0, 0, 0.36)';
  context.fillRect(x + 3, y + 21, 18, 4);

  context.fillStyle = PLAYER_OUTLINE_COLOR;
  context.fillRect(x + 6, y + 5, 12, 17);
  context.fillRect(x + 8, y + 1, 8, 8);

  context.fillStyle = PLAYER_CLOAK_COLOR;
  context.fillRect(x + 5, y + 8, 14, 12);
  context.fillRect(x + 4, y + 13, 16, 8);

  context.fillStyle = PLAYER_ARMOR_COLOR;
  context.fillRect(x + 8, y + 9, 8, 10);
  context.fillRect(x + 7, y + 19, 4, 4);
  context.fillRect(x + 13, y + 19, 4, 4);

  context.fillStyle = PLAYER_SKIN_COLOR;
  context.fillRect(x + 9, y + 3, 6, 5);

  context.fillStyle = '#2b1b17';
  context.fillRect(x + 8, y + 2, 8, 2);
  context.fillRect(x + 7, y + 4, 2, 3);
  context.fillRect(x + 15, y + 4, 2, 3);

  context.fillStyle = PLAYER_STEEL_COLOR;
  context.fillRect(x + 18, y + 5, 2, 14);
  context.fillRect(x + 17, y + 4, 4, 2);
  context.fillRect(x + 19, y + 2, 1, 3);

  context.fillStyle = '#d7c79b';
  context.fillRect(centerX - 1, y + 10, 2, 7);
}

function gameLoop() {
  sendMovementIntent();
  updateCamera();
  renderBackground();
  context.save();
  context.scale(cameraZoom, cameraZoom);
  renderPlayers();
  context.restore();
  requestAnimationFrame(gameLoop);
}

gameLoop();
