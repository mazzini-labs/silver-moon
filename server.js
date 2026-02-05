import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import fs from 'fs';

const content = JSON.parse(fs.readFileSync('./data/content.json', 'utf8'));
const dungeonDefs = JSON.parse(fs.readFileSync('./data/dungeons.json', 'utf8'));

const TICK_RATE = 20;
const TILE_SIZE = content.tileSize;
const app = express();
app.use(express.static('public'));
app.get('/api/content', (_req, res) => res.json(content));
app.get('/api/dungeons', (_req, res) => res.json(dungeonDefs));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const rooms = new Map();

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
    tick: 0,
    traces: [],
    inputLog: []
  };
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
    const dir = input.dir;
    const map = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
    const [dx, dy] = map[dir] || [0, 0];
    player.targetX = player.x + dx * TILE_SIZE;
    player.targetY = player.y + dy * TILE_SIZE;
    player.buffer = input.buffer || [];
  }
  if (input.type === 'verb') {
    room.traces.push({ t: room.tick, by: player.id, verb: input.verb, cell: input.cell });
    if (input.verb === 'reveal' || input.verb === 'pound' || input.verb === 'growth') {
      room.objectiveProgress = Math.min(room.objectiveRequired, room.objectiveProgress + 1);
    }
    if (room.roomIndex === 2) {
      room.bossHP = Math.max(0, room.bossHP - 8);
      if (room.bossHP === 0 && room.bossPhase < 1) {
        room.bossPhase += 1;
        room.bossHP = 100;
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
    room.objectiveProgress = Math.min(room.objectiveRequired, room.objectiveProgress + 1);
    if (room.objectiveProgress >= room.objectiveRequired) {
      room.roomIndex = Math.min(2, room.roomIndex + 1);
      room.objectiveProgress = 0;
      room.objectiveRequired = room.roomIndex === 1 ? 3 : 4;
    }
  }
}

function tickRoom(room) {
  room.tick += 1;
  for (const player of room.players.values()) {
    const speed = 0.25;
    player.x += Math.sign(player.targetX - player.x) * Math.min(Math.abs(player.targetX - player.x), speed);
    player.y += Math.sign(player.targetY - player.y) * Math.min(Math.abs(player.targetY - player.y), speed);
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
      const ghostTakeover = currentRoom.ghosts.get(playerId);
      if (ghostTakeover) currentRoom.ghosts.delete(playerId);
      currentRoom.players.set(playerId, {
        id: playerId,
        ws,
        name: msg.name,
        x: Math.random() * 4,
        y: Math.random() * 4,
        targetX: 0,
        targetY: 0,
        hp: 100,
        characterId: msg.characterId,
        djinn: msg.djinn,
        statPenaltyTicks: 0
      });
      ws.send(JSON.stringify({ type: 'joined', code }));
    }
    if (msg.type === 'input' && currentRoom) {
      const p = currentRoom.players.get(playerId);
      if (p) applyInput(currentRoom, p, msg.payload);
    }
    if (msg.type === 'pause' && currentRoom) {
      if (msg.action === 'restart-room') {
        currentRoom.objectiveProgress = 0;
      }
      if (msg.action === 'abandon-run') {
        currentRoom.roomIndex = 0;
        currentRoom.dungeonId = 'd1';
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
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Silver Moon running at http://localhost:${PORT}`));
