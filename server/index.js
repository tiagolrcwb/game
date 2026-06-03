const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const mysql = require('mysql2/promise');
const { WebSocket, WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 8080;
const WORLD_WIDTH = 3200;
const WORLD_HEIGHT = 3200;
const PLAYER_SIZE = 24;
const PLAYER_SPEED = 5;
const CLIENT_DIR = path.resolve(__dirname, '..', 'client');
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

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
    if (request.method === 'GET' && request.url === '/api/health') {
      await healthCheck(response);
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

async function healthCheck(response) {
  await db.query('SELECT 1');
  sendJson(response, 200, { ok: true });
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

      if (rawBody.length > 1024 * 1024) {
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
  if (extension === '.png') return 'image/png';

  return 'application/octet-stream';
}

function createPlayer(id, user) {
  return {
    id,
    userId: user.id,
    username: user.username,
    x: Math.floor(Math.random() * (WORLD_WIDTH - PLAYER_SIZE)),
    y: Math.floor(Math.random() * (WORLD_HEIGHT - PLAYER_SIZE)),
    direction: 'south',
    isMoving: false,
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function broadcastGameState() {
  const message = JSON.stringify({
    type: 'state',
    world: {
      width: WORLD_WIDTH,
      height: WORLD_HEIGHT,
    },
    players: Array.from(players.values()),
  });

  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

function handleMove(player, dx, dy) {
  const normalizedDx = Math.sign(Number(dx) || 0);
  const normalizedDy = Math.sign(Number(dy) || 0);

  player.isMoving = normalizedDx !== 0 || normalizedDy !== 0;

  if (player.isMoving) {
    player.direction = getPlayerDirection(normalizedDx, normalizedDy);
  }

  player.x = clamp(player.x + normalizedDx * PLAYER_SPEED, 0, WORLD_WIDTH - PLAYER_SIZE);
  player.y = clamp(player.y + normalizedDy * PLAYER_SPEED, 0, WORLD_HEIGHT - PLAYER_SIZE);
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
  const player = createPlayer(playerId, user);

  players.set(playerId, player);
  console.log(`Player connected: ${user.username} (${playerId})`);
  broadcastGameState();

  socket.on('message', (rawMessage) => {
    try {
      const message = JSON.parse(rawMessage.toString());

      if (message.type === 'move') {
        handleMove(player, message.dx, message.dy);
        broadcastGameState();
      }
    } catch (error) {
      console.warn(`Invalid message from ${user.username}:`, error.message);
    }
  });

  socket.on('close', () => {
    players.delete(playerId);
    console.log(`Player disconnected: ${user.username} (${playerId})`);
    broadcastGameState();
  });
});

server.listen(PORT, () => {
  console.log(`Client running on http://localhost:${PORT}`);
  console.log(`WebSocket server running on ws://localhost:${PORT}`);
});
