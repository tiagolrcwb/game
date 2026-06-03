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
const DEFAULT_WORLD = {
  width: 32000,
  height: 32000,
  widthCells: 1000,
  heightCells: 1000,
  cellSize: 32,
  characterSize: 64,
  backgroundColor: '#15161d',
  gridColor: 'rgba(185, 139, 87, 0.08)',
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
const characterSprites = Object.fromEntries(
  Object.entries(CHARACTER_SPRITE_SOURCES).map(([direction, source]) => {
    const image = new Image();
    image.src = source;
    return [direction, image];
  }),
);
let lastSentDirection = { dx: 0, dy: 0 };
let world = { ...DEFAULT_WORLD };
let camera = { x: 0, y: 0 };
let socket = null;
let heartbeatId = null;
let reconnectId = null;
let reconnectAttempts = 0;

connectSocket();

function connectSocket() {
  clearTimeout(reconnectId);
  setConnectionStatus('Conectando', true);

  socket = new WebSocket(socketUrl);

  socket.addEventListener('open', () => {
    reconnectAttempts = 0;
    lastSentDirection = { dx: 0, dy: 0 };
    setConnectionStatus('Online', false);
    startHeartbeat();
    sendMovementIntent();
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
    };

    if (world.mapId !== previousMapId) {
      camera = { x: 0, y: 0 };
    }
  }

  players.clear();

  for (const player of message.players) {
    players.set(player.id, player);
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
    pressedKeys.add(event.key.toLowerCase());
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

function getMovementDirection() {
  let dx = 0;
  let dy = 0;

  if (pressedKeys.has('a') || pressedKeys.has('arrowleft')) dx -= 1;
  if (pressedKeys.has('d') || pressedKeys.has('arrowright')) dx += 1;
  if (pressedKeys.has('w') || pressedKeys.has('arrowup')) dy -= 1;
  if (pressedKeys.has('s') || pressedKeys.has('arrowdown')) dy += 1;

  return { dx, dy };
}

function sendMovementIntent() {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }

  const { dx, dy } = getMovementDirection();

  if (dx !== 0 || dy !== 0 || dx !== lastSentDirection.dx || dy !== lastSentDirection.dy) {
    sendSocketMessage({ type: 'move', dx, dy });
    lastSentDirection = { dx, dy };
  }
}

function updateCamera() {
  const target = getCameraTarget();

  if (!target) {
    return;
  }

  const marginX = canvas.width * 0.34;
  const marginY = canvas.height * 0.32;
  const targetScreenX = target.x + PLAYER_SIZE / 2 - camera.x;
  const targetScreenY = target.y + PLAYER_SIZE / 2 - camera.y;
  let nextCameraX = camera.x;
  let nextCameraY = camera.y;

  if (targetScreenX > canvas.width - marginX) {
    nextCameraX = target.x + PLAYER_SIZE / 2 - (canvas.width - marginX);
  } else if (targetScreenX < marginX) {
    nextCameraX = target.x + PLAYER_SIZE / 2 - marginX;
  }

  if (targetScreenY > canvas.height - marginY) {
    nextCameraY = target.y + PLAYER_SIZE / 2 - (canvas.height - marginY);
  } else if (targetScreenY < marginY) {
    nextCameraY = target.y + PLAYER_SIZE / 2 - marginY;
  }

  camera = {
    x: clamp(nextCameraX, 0, Math.max(0, world.width - canvas.width)),
    y: clamp(nextCameraY, 0, Math.max(0, world.height - canvas.height)),
  };
}

function getCameraTarget() {
  return Array.from(players.values()).find((player) => player.username === username) || players.values().next().value;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function renderBackground() {
  context.fillStyle = BACKGROUND_COLOR;
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.save();
  context.translate(-camera.x, -camera.y);

  context.fillStyle = world.backgroundColor;
  context.fillRect(0, 0, world.width, world.height);

  context.strokeStyle = world.gridColor;
  context.lineWidth = 1;

  const firstGridX = Math.floor(camera.x / world.cellSize) * world.cellSize;
  const lastGridX = Math.min(world.width, camera.x + canvas.width + world.cellSize);
  const firstGridY = Math.floor(camera.y / world.cellSize) * world.cellSize;
  const lastGridY = Math.min(world.height, camera.y + canvas.height + world.cellSize);

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

  context.strokeStyle = WORLD_BORDER_COLOR;
  context.strokeRect(0.5, 0.5, world.width - 1, world.height - 1);
  context.restore();

  renderGridLabels(firstGridX, lastGridX, firstGridY, lastGridY);
  renderActiveCellLabel();
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
  const label = `Col ${column + 1} / Lin ${row + 1}`;

  context.save();
  context.font = '13px Arial';
  context.textAlign = 'left';
  context.textBaseline = 'top';
  context.fillStyle = 'rgba(8, 9, 13, 0.78)';
  context.fillRect(12, 12, 122, 26);
  context.strokeStyle = 'rgba(185, 139, 87, 0.42)';
  context.strokeRect(12.5, 12.5, 121, 25);
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
    x: player.x - camera.x,
    y: player.y - camera.y,
  };
}

function isPlayerVisible(player) {
  return (
    player.x > -world.characterSize &&
    player.x < canvas.width + world.characterSize &&
    player.y > -world.characterSize &&
    player.y < canvas.height + world.characterSize
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

  context.fillStyle = 'rgba(0, 0, 0, 0.34)';
  context.fillRect(player.x - 7, player.y + PLAYER_SIZE / 2 + 9, PLAYER_SIZE + 14, 6);

  context.save();
  context.drawImage(sprite, drawX, drawY, world.characterSize, world.characterSize);
  context.restore();
}

function getCharacterDrawX(player) {
  return Math.round(player.x + PLAYER_SIZE / 2 - world.characterSize / 2);
}

function getCharacterDrawY(player) {
  return Math.round(player.y + PLAYER_SIZE / 2 - world.characterSize / 2);
}

function getCharacterSprite(player) {
  const direction = LEGACY_DIRECTIONS[player.direction] || player.direction || DEFAULT_CHARACTER_DIRECTION;
  const sprite = characterSprites[direction] || characterSprites[DEFAULT_CHARACTER_DIRECTION];

  return sprite && sprite.complete && sprite.naturalWidth > 0 ? sprite : null;
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
  renderPlayers();
  requestAnimationFrame(gameLoop);
}

gameLoop();
