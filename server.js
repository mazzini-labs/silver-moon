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
app.get('/api/runtime', (_req, res) => {
  res.json({ port: PORT, host: HOST, wsPath: WS_PATH, publicBaseUrl: PUBLIC_BASE_URL });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: WS_PATH });

const rooms = new Map();

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function spotlightVerbsForDungeon(dungeonId) {
  return content.dungeons.find((d) => d.id === dungeonId)?.verbs ?? ['push_pull', 'pound', 'reveal'];
}

function mkRoom(code) {
  return {
    code,
    mode: 'dungeon-run',
    players: new Map(),
    ghosts: new Map(),
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
    inputLog: []
  };
}

function recalcBossChargeRequired(room) {
  const activeParticipants = room.players.size + room.ghosts.size;
  room.bossChargeRequired = clamp(Math.ceil(activeParticipants / 2), 1, 4);
}

function roomSnapshot(room) {
  return {
    code: room.code,
    mode: room.mode,
    dungeonId: room.dungeonId,
    difficulty: room.difficulty,
    roomIndex: room.roomIndex,
    objectiveProgress: room.objectiveProgress,
    objectiveRequired: room.objectiveRequired,
    bossPhase: room.bossPhase,
    bossHP: room.bossHP,
    bossCharge: room.bossCharge,
    bossChargeRequired: room.bossChargeRequired,
    bossSpotlightVerbs: spotlightVerbsForDungeon(room.dungeonId),
    players: [...room.players.values()].map((p) => ({ ...p, ws: undefined })),
    ghosts: [...room.ghosts.values()],
    tick: room.tick,
    traces: room.traces.slice(-20),
    inputLog: room.inputLog.slice(-50)
  };
}

function applyInput(room, player, input) {
  room.inputLog.push({ tick: room.tick, playerId: player.id, input });

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
    room.traces.push({ t: room.tick, by: player.id, verb: input.verb, cell: input.cell });

    if (room.roomIndex < 2 && (input.verb === 'reveal' || input.verb === 'pound' || input.verb === 'growth')) {
      room.objectiveProgress = Math.min(room.objectiveRequired, room.objectiveProgress + 1);
    }

    if (room.roomIndex === 2) {
      const spotlight = spotlightVerbsForDungeon(room.dungeonId);
      if (spotlight.includes(input.verb) && room.bossCharge >= room.bossChargeRequired) {
        room.bossHP = Math.max(0, room.bossHP - 12);
        room.bossCharge = 0;
        room.traces.push({ t: room.tick, by: player.id, bossHit: true, verb: input.verb });
      }
      if (room.bossHP === 0 && room.bossPhase < 1) {
        room.bossPhase += 1;
        room.bossHP = 100;
        room.bossCharge = 0;
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
      room.traces.push({ t: room.tick, by: player.id, summon: summon.name });
    }
  }

  if (input.type === 'contribute') {
    if (room.roomIndex < 2) {
      room.objectiveProgress = Math.min(room.objectiveRequired, room.objectiveProgress + 1);
      if (room.objectiveProgress >= room.objectiveRequired) {
        room.roomIndex = Math.min(2, room.roomIndex + 1);
        room.objectiveProgress = 0;
        room.objectiveRequired = room.roomIndex === 1 ? 3 : 4;
      }
    } else {
      room.bossCharge = Math.min(room.bossChargeRequired, room.bossCharge + 1);
      room.traces.push({ t: room.tick, by: player.id, bossCharge: room.bossCharge });
    }
  }
}

function tickRoom(room) {
  room.tick += 1;

  recalcBossChargeRequired(room);

  for (const player of room.players.values()) {
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

  for (const ghost of room.ghosts.values()) {
    const nearest = [...room.players.values()][0];
    if (nearest) {
      ghost.x += Math.sign(nearest.x - ghost.x) * 0.1;
      ghost.y += Math.sign(nearest.y - ghost.y) * 0.1;
    }
  }
}

setInterval(() => {
  for (const room of rooms.values()) {
    tickRoom(room);
    const snap = JSON.stringify({ type: 'snapshot', state: roomSnapshot(room) });
    for (const p of room.players.values()) p.ws.send(snap);
  }
}, 1000 / TICK_RATE);

wss.on('connection', (ws) => {
  let currentRoom;
  let playerId;

  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());

    if (msg.type === 'host' || msg.type === 'join' || msg.type === 'solo') {
      const code = msg.type === 'solo' ? `SOLO-${Math.floor(Math.random() * 1000)}` : (msg.code || `ROOM-${Math.floor(Math.random() * 1000)}`);
      if (!rooms.has(code)) rooms.set(code, mkRoom(code));
      currentRoom = rooms.get(code);
      currentRoom.dungeonId = msg.dungeonId || 'd1';
      currentRoom.difficulty = msg.difficulty || 'standard';
      playerId = msg.playerId;

      if (currentRoom.ghosts.has(playerId)) currentRoom.ghosts.delete(playerId);

      const spawnCellX = Math.floor(Math.random() * 4) - 2;
      const spawnCellY = Math.floor(Math.random() * 4) - 2;

      currentRoom.players.set(playerId, {
        id: playerId,
        ws,
        name: msg.name,
        cellX: spawnCellX,
        cellY: spawnCellY,
        x: spawnCellX * TILE_SIZE,
        y: spawnCellY * TILE_SIZE,
        targetX: spawnCellX * TILE_SIZE,
        targetY: spawnCellY * TILE_SIZE,
        hp: 100,
        characterId: msg.characterId,
        djinn: msg.djinn,
        statPenaltyTicks: 0
      });

      recalcBossChargeRequired(currentRoom);
      ws.send(JSON.stringify({ type: 'joined', code }));
    }

    if (msg.type === 'input' && currentRoom) {
      const p = currentRoom.players.get(playerId);
      if (p) applyInput(currentRoom, p, msg.payload);
    }

    if (msg.type === 'pause' && currentRoom) {
      if (msg.action === 'restart-room') {
        currentRoom.objectiveProgress = 0;
        if (currentRoom.roomIndex === 2) currentRoom.bossCharge = 0;
      }
      if (msg.action === 'abandon-run') {
        currentRoom.roomIndex = 0;
        currentRoom.dungeonId = 'd1';
        currentRoom.objectiveProgress = 0;
        currentRoom.bossCharge = 0;
        currentRoom.bossHP = 100;
        currentRoom.bossPhase = 0;
      }
    }
  });

  ws.on('close', () => {
    if (currentRoom && playerId) {
      const p = currentRoom.players.get(playerId);
      if (p) {
        currentRoom.players.delete(playerId);
        currentRoom.ghosts.set(playerId, {
          id: playerId,
          name: `${p.name} (ghost)`,
          x: p.x,
          y: p.y,
          ai: 'stay-near-party/avoid-hazards/contribute-nearest-objective'
        });
        recalcBossChargeRequired(currentRoom);
      }
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Silver Moon running at http://${HOST}:${PORT} (WS path: ${WS_PATH})`);
  if (PUBLIC_BASE_URL) console.log(`Public base URL override: ${PUBLIC_BASE_URL}`);
});
