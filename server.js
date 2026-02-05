import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import fs from 'fs';

const content = JSON.parse(fs.readFileSync('./data/content.json', 'utf8'));
const dungeonDefs = JSON.parse(fs.readFileSync('./data/dungeons.json', 'utf8'));

const PORT = Number.parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const WS_PATH = process.env.WS_PATH || '/ws';
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || '';

const TICK_RATE = 20;
const TILE_SIZE = content.tileSize;

const app = express();
app.use(express.static('public'));
app.get('/api/content', (_req, res) => res.json(content));
app.get('/api/dungeons', (_req, res) => res.json(dungeonDefs));
app.get('/api/runtime', (_req, res) => res.json({ port: PORT, host: HOST, wsPath: WS_PATH, publicBaseUrl: PUBLIC_BASE_URL }));
app.get('/api/lobbies', (_req, res) => {
  const lobbies = [...lobbyMap.values()].map((l) => ({
    code: l.code,
    inRun: l.inRun,
    hostId: l.hostId,
    players: [...l.clients.values()].map((c) => ({ id: c.id, name: c.name, ready: c.ready, spectator: c.spectator }))
  }));
  res.json({ count: lobbies.length, lobbies });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: WS_PATH });

const lobbyMap = new Map();

function randCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let out = '';
  for (let i = 0; i < 5; i += 1) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
function createLobbyCode() {
  let code = randCode();
  while (lobbyMap.has(code)) code = randCode();
  return code;
}
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function spotlightVerbsForDungeon(dungeonId) {
  return content.dungeons.find((d) => d.id === dungeonId)?.verbs ?? ['push_pull', 'pound', 'reveal'];
}

function makeLobby(code, hostId) {
  return {
    code,
    hostId,
    inRun: false,
    mode: 'dungeon-run',
    dungeonId: 'd1',
    difficulty: 'standard',
    roomIndex: 0,
    objectiveProgress: 0,
    objectiveRequired: 2,
    bossPhase: 0,
    bossHP: 100,
    bossCharge: 0,
    bossChargeRequired: 2,
    tick: 0,
    traces: [],
    inputLog: [],
    clients: new Map(),
    players: new Map(),
    ghosts: new Map()
  };
}

function lobbyView(lobby) {
  return {
    code: lobby.code,
    hostId: lobby.hostId,
    inRun: lobby.inRun,
    dungeonId: lobby.dungeonId,
    difficulty: lobby.difficulty,
    players: [...lobby.clients.values()].map((c) => ({
      id: c.id,
      name: c.name,
      ready: c.ready,
      spectator: c.spectator,
      characterId: c.characterId
    }))
  };
}

function roomSnapshot(lobby) {
  return {
    code: lobby.code,
    mode: lobby.mode,
    dungeonId: lobby.dungeonId,
    difficulty: lobby.difficulty,
    roomIndex: lobby.roomIndex,
    objectiveProgress: lobby.objectiveProgress,
    objectiveRequired: lobby.objectiveRequired,
    bossPhase: lobby.bossPhase,
    bossHP: lobby.bossHP,
    bossCharge: lobby.bossCharge,
    bossChargeRequired: lobby.bossChargeRequired,
    bossSpotlightVerbs: spotlightVerbsForDungeon(lobby.dungeonId),
    players: [...lobby.players.values()].map((p) => ({ ...p, ws: undefined })),
    ghosts: [...lobby.ghosts.values()],
    tick: lobby.tick,
    traces: lobby.traces.slice(-20),
    inputLog: lobby.inputLog.slice(-50)
  };
}

function recalcBossChargeRequired(lobby) {
  const activeParticipants = lobby.players.size + lobby.ghosts.size;
  lobby.bossChargeRequired = clamp(Math.ceil(activeParticipants / 2), 1, 4);
}

function broadcastLobby(lobby) {
  const msg = JSON.stringify({ type: 'lobby_update', lobby: lobbyView(lobby) });
  for (const c of lobby.clients.values()) {
    if (c.ws.readyState === 1) c.ws.send(msg);
  }
}

function ensureHostOnDisconnect(lobby) {
  if (lobby.clients.has(lobby.hostId)) return;
  const first = [...lobby.clients.values()][0];
  if (first) lobby.hostId = first.id;
}

function startRun(lobby) {
  if (lobby.inRun) return;
  lobby.inRun = true;
  lobby.roomIndex = 0;
  lobby.objectiveProgress = 0;
  lobby.objectiveRequired = 2;
  lobby.bossPhase = 0;
  lobby.bossHP = 100;
  lobby.bossCharge = 0;
  lobby.ghosts.clear();
  lobby.players.clear();

  for (const c of lobby.clients.values()) {
    if (c.spectator) continue;
    const spawnCellX = Math.floor(Math.random() * 4) - 2;
    const spawnCellY = Math.floor(Math.random() * 4) - 2;
    lobby.players.set(c.id, {
      id: c.id,
      ws: c.ws,
      name: c.name,
      cellX: spawnCellX,
      cellY: spawnCellY,
      x: spawnCellX * TILE_SIZE,
      y: spawnCellY * TILE_SIZE,
      targetX: spawnCellX * TILE_SIZE,
      targetY: spawnCellY * TILE_SIZE,
      hp: 100,
      characterId: c.characterId,
      djinn: c.djinn,
      statPenaltyTicks: 0
    });
  }
  recalcBossChargeRequired(lobby);

  const snap = JSON.stringify({ type: 'run_started', state: roomSnapshot(lobby), lobby: lobbyView(lobby) });
  for (const c of lobby.clients.values()) {
    if (c.ws.readyState === 1) c.ws.send(snap);
  }
}

function applyInput(lobby, player, input) {
  lobby.inputLog.push({ tick: lobby.tick, playerId: player.id, input });
  if (input.type === 'move') {
    const map = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
    const [dx, dy] = map[input.dir] || [0, 0];
    player.cellX = clamp(player.cellX + dx, -6, 6);
    player.cellY = clamp(player.cellY + dy, -6, 6);
    player.targetX = player.cellX * TILE_SIZE;
    player.targetY = player.cellY * TILE_SIZE;
    player.buffer = input.buffer || [];
  }
  if (input.type === 'verb') {
    lobby.traces.push({ t: lobby.tick, by: player.id, verb: input.verb, cell: input.cell });
    if (lobby.roomIndex < 2 && (input.verb === 'reveal' || input.verb === 'pound' || input.verb === 'growth')) {
      lobby.objectiveProgress = Math.min(lobby.objectiveRequired, lobby.objectiveProgress + 1);
    }
    if (lobby.roomIndex === 2) {
      const spotlight = spotlightVerbsForDungeon(lobby.dungeonId);
      if (spotlight.includes(input.verb) && lobby.bossCharge >= lobby.bossChargeRequired) {
        lobby.bossHP = Math.max(0, lobby.bossHP - 12);
        lobby.bossCharge = 0;
        lobby.traces.push({ t: lobby.tick, by: player.id, bossHit: true, verb: input.verb });
      }
      if (lobby.bossHP === 0 && lobby.bossPhase < 1) {
        lobby.bossPhase += 1;
        lobby.bossHP = 100;
        lobby.bossCharge = 0;
      }
    }
  }
  if (input.type === 'djinn') {
    const d = player.djinn.find((x) => x.id === input.id);
    if (d && d.state === 'set') d.state = 'standby';
  }
  if (input.type === 'summon') {
    const standby = player.djinn.filter((d) => d.state === 'standby');
    const summon = content.summons.find((s) => s.id === input.id);
    if (summon && standby.length >= summon.costStandby) {
      standby.slice(0, summon.costStandby).forEach((d) => (d.state = 'set'));
      player.statPenaltyTicks = TICK_RATE * 20;
      lobby.traces.push({ t: lobby.tick, by: player.id, summon: summon.name });
    }
  }
  if (input.type === 'contribute') {
    if (lobby.roomIndex < 2) {
      lobby.objectiveProgress = Math.min(lobby.objectiveRequired, lobby.objectiveProgress + 1);
      if (lobby.objectiveProgress >= lobby.objectiveRequired) {
        lobby.roomIndex = Math.min(2, lobby.roomIndex + 1);
        lobby.objectiveProgress = 0;
        lobby.objectiveRequired = lobby.roomIndex === 1 ? 3 : 4;
      }
    } else {
      lobby.bossCharge = Math.min(lobby.bossChargeRequired, lobby.bossCharge + 1);
      lobby.traces.push({ t: lobby.tick, by: player.id, bossCharge: lobby.bossCharge });
    }
  }
}

function tickLobby(lobby) {
  lobby.tick += 1;
  recalcBossChargeRequired(lobby);
  for (const player of lobby.players.values()) {
    const speed = 0.25;
    const snapX = player.cellX * TILE_SIZE;
    const snapY = player.cellY * TILE_SIZE;
    player.targetX = snapX;
    player.targetY = snapY;
    player.x += Math.sign(player.targetX - player.x) * Math.min(Math.abs(player.targetX - player.x), speed);
    player.y += Math.sign(player.targetY - player.y) * Math.min(Math.abs(player.targetY - player.y), speed);
    if (Math.abs(player.targetX - player.x) < 0.001) player.x = player.targetX;
    if (Math.abs(player.targetY - player.y) < 0.001) player.y = player.targetY;
    if (player.statPenaltyTicks > 0) player.statPenaltyTicks -= 1;
  }
  for (const ghost of lobby.ghosts.values()) {
    const nearest = [...lobby.players.values()][0];
    if (nearest) {
      ghost.x += Math.sign(nearest.x - ghost.x) * 0.1;
      ghost.y += Math.sign(nearest.y - ghost.y) * 0.1;
    }
  }
}

setInterval(() => {
  for (const lobby of lobbyMap.values()) {
    if (!lobby.inRun) continue;
    tickLobby(lobby);
    const snap = JSON.stringify({ type: 'snapshot', state: roomSnapshot(lobby), lobby: lobbyView(lobby) });
    for (const c of lobby.clients.values()) {
      if (c.ws.readyState === 1) c.ws.send(snap);
    }
  }
}, 1000 / TICK_RATE);

wss.on('connection', (ws) => {
  let currentLobby = null;
  let playerId = null;

  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());

    if (msg.type === 'create_lobby') {
      playerId = msg.playerId;
      const code = createLobbyCode();
      const lobby = makeLobby(code, playerId);
      lobby.dungeonId = msg.dungeonId || 'd1';
      lobby.difficulty = msg.difficulty || 'standard';
      lobby.clients.set(playerId, {
        id: playerId,
        ws,
        name: msg.name || `Player-${code}`,
        ready: true,
        spectator: false,
        characterId: msg.characterId,
        djinn: msg.djinn || []
      });
      lobbyMap.set(code, lobby);
      currentLobby = lobby;
      ws.send(JSON.stringify({ type: 'joined_lobby', code, host: true }));
      broadcastLobby(lobby);
      if (msg.mode === 'solo') startRun(lobby);
      return;
    }

    if (msg.type === 'join_lobby') {
      playerId = msg.playerId;
      const code = (msg.code || '').toUpperCase().trim();
      const lobby = lobbyMap.get(code);
      if (!lobby) {
        ws.send(JSON.stringify({ type: 'join_error', message: `Lobby ${code} not found` }));
        return;
      }
      currentLobby = lobby;
      lobby.dungeonId = msg.dungeonId || lobby.dungeonId;
      lobby.difficulty = msg.difficulty || lobby.difficulty;
      const spectator = lobby.inRun;
      lobby.clients.set(playerId, {
        id: playerId,
        ws,
        name: msg.name || `Guest-${code}`,
        ready: spectator,
        spectator,
        characterId: msg.characterId,
        djinn: msg.djinn || []
      });
      ws.send(JSON.stringify({ type: 'joined_lobby', code, host: lobby.hostId === playerId, spectator }));
      broadcastLobby(lobby);
      if (spectator) {
        ws.send(JSON.stringify({ type: 'snapshot', state: roomSnapshot(lobby), lobby: lobbyView(lobby) }));
      }
      return;
    }

    if (!currentLobby || !playerId) return;

    if (msg.type === 'set_ready') {
      const c = currentLobby.clients.get(playerId);
      if (c && !c.spectator) {
        c.ready = Boolean(msg.ready);
        broadcastLobby(currentLobby);
      }
    }

    if (msg.type === 'start_run') {
      if (playerId !== currentLobby.hostId || currentLobby.inRun) return;
      const active = [...currentLobby.clients.values()].filter((c) => !c.spectator);
      if (active.length === 0) return;
      const allReady = active.every((c) => c.ready);
      if (!allReady) {
        ws.send(JSON.stringify({ type: 'start_denied', message: 'All non-spectator players must be ready.' }));
        return;
      }
      startRun(currentLobby);
      broadcastLobby(currentLobby);
    }

    if (msg.type === 'input' && currentLobby.inRun) {
      const p = currentLobby.players.get(playerId);
      if (p) applyInput(currentLobby, p, msg.payload);
    }

    if (msg.type === 'pause' && currentLobby.inRun) {
      if (msg.action === 'restart-room') {
        currentLobby.objectiveProgress = 0;
        if (currentLobby.roomIndex === 2) currentLobby.bossCharge = 0;
      }
      if (msg.action === 'abandon-run') {
        currentLobby.roomIndex = 0;
        currentLobby.objectiveProgress = 0;
        currentLobby.objectiveRequired = 2;
        currentLobby.bossCharge = 0;
        currentLobby.bossHP = 100;
        currentLobby.bossPhase = 0;
      }
    }
  });

  ws.on('close', () => {
    if (!currentLobby || !playerId) return;
    const c = currentLobby.clients.get(playerId);
    if (!c) return;

    currentLobby.clients.delete(playerId);
    if (currentLobby.inRun) {
      const p = currentLobby.players.get(playerId);
      if (p) {
        currentLobby.players.delete(playerId);
        currentLobby.ghosts.set(playerId, {
          id: playerId,
          name: `${p.name} (ghost)`,
          x: p.x,
          y: p.y,
          ai: 'stay-near-party/avoid-hazards/contribute-nearest-objective'
        });
        recalcBossChargeRequired(currentLobby);
      }
    }

    ensureHostOnDisconnect(currentLobby);
    broadcastLobby(currentLobby);

    if (currentLobby.clients.size === 0) lobbyMap.delete(currentLobby.code);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Silver Moon running at http://${HOST}:${PORT} (WS path: ${WS_PATH})`);
  if (PUBLIC_BASE_URL) console.log(`Public base URL override: ${PUBLIC_BASE_URL}`);
});
