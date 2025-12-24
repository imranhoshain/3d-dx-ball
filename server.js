const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const clientOrigin = process.env.CLIENT_ORIGIN;
const allowAllOrigins = process.env.ALLOW_ALL_ORIGINS === '1';
const originRegexRaw = process.env.CLIENT_ORIGIN_REGEX;
const allowedOrigins = clientOrigin
  ? clientOrigin.split(',').map((origin) => origin.trim()).filter(Boolean)
  : null;
const originRegex = originRegexRaw ? new RegExp(originRegexRaw) : null;

function getHostname(origin) {
  try {
    return new URL(origin).hostname;
  } catch (err) {
    return '';
  }
}

function getBaseDomain(host) {
  if (!host) return '';
  const cleaned = host.split(':')[0];
  const parts = cleaned.split('.').filter(Boolean);
  if (parts.length < 2) return cleaned;
  return parts.slice(-2).join('.');
}

function isOriginAllowed(origin, host) {
  if (!origin) return true;
  if (allowAllOrigins) return true;
  if (allowedOrigins && allowedOrigins.includes(origin)) return true;
  if (originRegex && originRegex.test(origin)) return true;
  const baseDomain = getBaseDomain(host);
  const originHost = getHostname(origin);
  if (!baseDomain || !originHost) return false;
  return originHost === baseDomain || originHost.endsWith(`.${baseDomain}`);
}

const io = new Server(server, {
  cors: { origin: true },
  allowRequest: (req, callback) => {
    const origin = req.headers.origin;
    const host = req.headers.host;
    callback(null, isOriginAllowed(origin, host));
  },
});

const PORT = process.env.PORT || 3000;
const TRUST_PROXY = process.env.TRUST_PROXY === '1';

if (TRUST_PROXY) {
  app.set('trust proxy', 1);
}

app.disable('x-powered-by');

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: true,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'", "'unsafe-inline'"],
        'style-src': ["'self'", 'https://fonts.googleapis.com'],
        'font-src': ["'self'", 'https://fonts.gstatic.com'],
        'img-src': ["'self'", 'data:'],
        'connect-src': ["'self'", 'ws:', 'wss:'],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
);

app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
  })
);

app.use(express.static(path.join(__dirname, 'public')));

const scoreboard = [];
const players = new Map();
const knownNames = new Set();
const knownPhones = new Set();

const MAX_SCORES = 10;
const MAX_SCORE = 1000000;
const MAX_TIME = 60 * 60 * 3;
const MAX_LEVEL = 200;
const SCORE_COOLDOWN_MS = 1200;

const dataDir = path.join(__dirname, 'data');
const csvPath = path.join(dataDir, 'players.csv');

function ensureCsv() {
  fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(csvPath)) {
    fs.writeFileSync(csvPath, 'timestamp,name,phone\n');
  }
}

function sanitizeName(name) {
  if (!name || typeof name !== 'string') return 'Pilot';
  return name.replace(/[^a-zA-Z0-9 _-]/g, '').trim().slice(0, 18) || 'Pilot';
}

function normalizeNameKey(name) {
  return sanitizeName(name).toLowerCase();
}

function normalizePhone(rawPhone) {
  if (!rawPhone || typeof rawPhone !== 'string') {
    return { normalized: '', valid: true };
  }
  const trimmed = rawPhone.trim();
  if (!trimmed) {
    return { normalized: '', valid: true };
  }
  const digits = trimmed.replace(/\D/g, '');
  const normalized = trimmed.startsWith('+') ? `+${digits}` : digits;
  const valid = digits.length >= 7 && digits.length <= 15;
  return { normalized, valid };
}

function unescapeCsvValue(value) {
  if (value == null) return '';
  let safe = String(value).trim();
  if (safe.startsWith('"') && safe.endsWith('"')) {
    safe = safe.slice(1, -1).replace(/""/g, '"');
  }
  if (safe.startsWith("'")) {
    safe = safe.slice(1);
  }
  return safe;
}

function rememberPlayer(name, phone) {
  const nameKey = normalizeNameKey(name);
  if (nameKey) knownNames.add(nameKey);
  if (phone) knownPhones.add(phone);
}

function isKnownPlayer(name, phone) {
  const nameKey = normalizeNameKey(name);
  if (phone && knownPhones.has(phone)) return true;
  if (nameKey && knownNames.has(nameKey)) return true;
  return false;
}

function escapeCsvValue(value) {
  let safe = String(value ?? '');
  if (/^[=+@-]/.test(safe)) {
    safe = `'${safe}`;
  }
  if (/[\",\\n]/.test(safe)) {
    safe = `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

function logPlayerEntry(entry) {
  const timestamp = new Date().toISOString();
  const row = [
    escapeCsvValue(timestamp),
    escapeCsvValue(entry.name),
    escapeCsvValue(entry.phone || ''),
  ].join(',');
  fs.appendFile(csvPath, `${row}\n`, (err) => {
    if (err) {
      console.error('Failed to write player entry', err);
    }
  });
}

function loadKnownPlayers() {
  ensureCsv();
  let data = '';
  try {
    data = fs.readFileSync(csvPath, 'utf8');
  } catch (err) {
    console.error('Failed to read player CSV', err);
    return;
  }
  const lines = data.split(/\r?\n/);
  lines.slice(1).forEach((line) => {
    if (!line.trim()) return;
    const [, rawName, rawPhone] = line.split(',');
    if (!rawName) return;
    const name = sanitizeName(unescapeCsvValue(rawName));
    const phoneCheck = normalizePhone(unescapeCsvValue(rawPhone || ''));
    const phone = phoneCheck.valid ? phoneCheck.normalized : '';
    rememberPlayer(name, phone);
  });
}

function addScore(entry) {
  scoreboard.push(entry);
  scoreboard.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.time !== b.time) return a.time - b.time;
    return b.ts - a.ts;
  });
  if (scoreboard.length > MAX_SCORES) {
    scoreboard.length = MAX_SCORES;
  }
}

io.on('connection', (socket) => {
  socket.on('player:join', (payload, ack) => {
    const raw = payload && typeof payload === 'object' ? payload : { name: payload };
    const name = sanitizeName(raw.name);
    const phoneCheck = normalizePhone(raw.phone);

    if (!phoneCheck.valid) {
      const message = 'Phone number is invalid. Use 7-15 digits.';
      if (typeof ack === 'function') {
        ack({ ok: false, message });
      } else {
        socket.emit('player:error', { message });
      }
      return;
    }

    const phone = phoneCheck.normalized;
    if (!isKnownPlayer(name, phone)) {
      rememberPlayer(name, phone);
      logPlayerEntry({ name, phone });
    }

    players.set(socket.id, { name, phone, lastScoreAt: 0 });

    if (typeof ack === 'function') {
      ack({ ok: true });
    }

    socket.emit('scoreboard:update', scoreboard);
    io.emit('presence:update', { count: players.size });
  });

  socket.on('score:submit', (payload) => {
    if (!payload || typeof payload !== 'object') return;
    const player = players.get(socket.id);
    if (!player) return;
    const now = Date.now();
    if (player && now - player.lastScoreAt < SCORE_COOLDOWN_MS) return;
    player.lastScoreAt = now;
    const name = player.name || 'Pilot';
    const score = Number.isFinite(payload.score)
      ? Math.min(MAX_SCORE, Math.max(0, Math.floor(payload.score)))
      : 0;
    const time = Number.isFinite(payload.time)
      ? Math.min(MAX_TIME, Math.max(0, Math.floor(payload.time)))
      : 0;
    const level = Number.isFinite(payload.level)
      ? Math.min(MAX_LEVEL, Math.max(1, Math.floor(payload.level)))
      : 1;

    addScore({ name, score, time, level, ts: Date.now() });
    io.emit('scoreboard:update', scoreboard);
  });

  socket.on('disconnect', () => {
    players.delete(socket.id);
    io.emit('presence:update', { count: players.size });
  });
});

loadKnownPlayers();

server.listen(PORT, () => {
  console.log(`Dex Ball running on http://localhost:${PORT}`);
});
