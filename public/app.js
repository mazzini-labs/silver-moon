import * as THREE from 'https://unpkg.com/three@0.164.1/build/three.module.js';

const state = {
  content: null,
  dungeons: null,
  ws: null,
  runtime: { wsPath: '/ws', publicBaseUrl: '' },
  mode: 'solo',
  roomCode: '',
  playerId: `p-${Math.random().toString(16).slice(2, 8)}`,
  name: `Player-${Math.floor(Math.random() * 99)}`,
  characterId: 'c1',
  selectedDjinn: [],
  dungeonId: 'd1',
  difficulty: 'standard',
  lobby: null,
  isHost: false,
  isSpectator: false,
  ready: false,
  inRun: false,
  server: null,
  paused: false,
  verbIndex: 0,
  replayLog: [],
  uiLog: [],
  showThemePreview: false
};

const verbs = ['push_pull', 'lift_throw', 'pound', 'freeze', 'growth', 'tether', 'reveal', 'swap'];

const screens = {
  play: document.getElementById('screen-play'),
  setup: document.getElementById('screen-setup'),
  lobby: document.getElementById('screen-lobby'),
  options: document.getElementById('screen-options')
};

const hud = document.getElementById('hud');
const partyEl = document.getElementById('party');
const hotbarEl = document.getElementById('hotbar');
const hintEl = document.getElementById('hintLog');
const bossEl = document.getElementById('bossWidget');
const minimapEl = document.getElementById('minimap');
const debugEl = document.getElementById('debug');
const pauseMenu = document.getElementById('pauseMenu');
const confirmOverlayEl = document.getElementById('confirmOverlay');

const lobbyCodeDisplay = document.getElementById('lobbyCodeDisplay');
const lobbyRoleEl = document.getElementById('lobbyRole');
const lobbyRosterEl = document.getElementById('lobbyRoster');
const readyBtn = document.getElementById('readyBtn');
const hostStartBtn = document.getElementById('hostStartBtn');

const dungeonSelect = document.getElementById('dungeonSelect');
const avatarSelect = document.getElementById('avatarSelect');
const djinnSelect = document.getElementById('djinnSelect');
const loadoutPortrait = document.getElementById('loadoutPortrait');
const coreStatsEl = document.getElementById('loadoutCoreStats');
const battleStatsEl = document.getElementById('loadoutBattleStats');

const uiScale = document.getElementById('uiScale');
const uiInternal = document.getElementById('uiInternal');
const INTERNAL_W = 480;
const INTERNAL_H = 270;

function applyUIScale() {
  const scale = Math.max(1, Math.floor(Math.min(window.innerWidth / INTERNAL_W, window.innerHeight / INTERNAL_H)));
  const w = INTERNAL_W * scale;
  const h = INTERNAL_H * scale;
  const x = Math.floor((window.innerWidth - w) / 2);
  const y = Math.floor((window.innerHeight - h) / 2);
  uiScale.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
  uiInternal.style.width = `${INTERNAL_W}px`;
  uiInternal.style.height = `${INTERNAL_H}px`;
}

function logUI(message) {
  state.uiLog.push(message);
  if (state.uiLog.length > 16) state.uiLog.shift();
}

class ConfirmChoiceOverlay {
  constructor(rootEl, getPortrait) {
    this.root = rootEl;
    this.getPortrait = getPortrait;
    this.resolve = null;
    this.selection = 0;
    this.opened = false;
    this.portraits = [];
    this.audioCtx = null;

    this.root.innerHTML = `
      <div class="confirm-dialog ui-panel ui-text">
        <div class="confirm-message ui-subpanel" id="confirmMessage"></div>
        <div class="confirm-portraits" id="confirmPortraits"></div>
        <div class="confirm-buttons">
          <button class="confirm-choice-btn ui-btn" data-choice="0">YES</button>
          <button class="confirm-choice-btn ui-btn" data-choice="1">NO</button>
        </div>
      </div>
    `;

    this.messageEl = this.root.querySelector('#confirmMessage');
    this.portraitWrap = this.root.querySelector('#confirmPortraits');
    this.buttons = [...this.root.querySelectorAll('.confirm-choice-btn')];
    this.buttons.forEach((b) => {
      b.onclick = () => this.confirm(Number(b.dataset.choice));
      b.onmouseenter = () => this.setSelection(Number(b.dataset.choice));
    });
  }

  isOpen() { return this.opened; }

  tone(freq, durationMs) {
    if (!this.audioCtx) this.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = this.audioCtx;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.08, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000);
    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + durationMs / 1000 + 0.01);
  }
  playMove() { this.tone(540, 50); }
  playConfirm() { this.tone(860, 90); }

  setSelection(index) {
    const next = index === 0 ? 0 : 1;
    if (next === this.selection) return;
    this.selection = next;
    this.playMove();
    this.renderSelection();
  }

  renderSelection() {
    this.portraits.forEach((el, i) => {
      const selected = i === this.selection;
      el.classList.toggle('selected', selected);
      el.classList.toggle('breathe', selected);
    });
  }

  open(message, characterId) {
    if (this.opened) return Promise.resolve(null);
    this.opened = true;
    this.selection = 0;
    this.messageEl.textContent = message;
    const portraits = [this.getPortrait(characterId, 'yes'), this.getPortrait(characterId, 'no')];
    this.portraitWrap.innerHTML = '';
    this.portraits = portraits.map((src, i) => {
      const img = document.createElement('img');
      img.className = 'confirm-portrait';
      img.src = src;
      img.draggable = false;
      img.onmouseenter = () => this.setSelection(i);
      img.onclick = () => this.confirm(i);
      this.portraitWrap.append(img);
      return img;
    });
    this.renderSelection();
    this.root.classList.remove('hidden');
    return new Promise((resolve) => { this.resolve = resolve; });
  }

  confirm(index) {
    if (!this.opened) return;
    this.playConfirm();
    this.close(index === 0);
  }
  cancel() { if (this.opened) this.close(null); }
  close(result) {
    this.opened = false;
    this.root.classList.add('hidden');
    if (this.resolve) this.resolve(result);
    this.resolve = null;
  }
}

function show(name) {
  Object.values(screens).forEach((s) => s.classList.remove('active'));
  screens[name].classList.add('active');
}

function buildPortraitFactory(characters) {
  const byId = new Map();
  const palette = ['#cc6655', '#f0b84a', '#66b3d9', '#82d17a', '#8a78d8', '#d96fb8', '#73d9c1', '#d9d56f'];
  for (let i = 0; i < characters.length; i += 1) {
    const c = document.createElement('canvas');
    c.width = 24;
    c.height = 24;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#111'; ctx.fillRect(0, 0, 24, 24);
    ctx.fillStyle = '#1f77ff'; ctx.fillRect(1, 1, 22, 22);
    ctx.fillStyle = '#f2d7b0'; ctx.fillRect(6, 5, 12, 10);
    ctx.fillStyle = palette[i % palette.length]; ctx.fillRect(4, 3, 16, 5); ctx.fillRect(6, 15, 12, 6);
    ctx.fillStyle = '#000'; ctx.fillRect(9, 9, 2, 2); ctx.fillRect(13, 9, 2, 2);
    byId.set(characters[i].id, c.toDataURL());
  }
  return (characterId, mode='base') => {
    const base = byId.get(characterId) || [...byId.values()][0];
    if (mode === 'base') return base;
    const c = document.createElement('canvas'); c.width = 24; c.height = 24;
    const ctx = c.getContext('2d'); ctx.imageSmoothingEnabled = false;
    const img = new Image(); img.src = base; ctx.drawImage(img, 0, 0);
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = mode === 'yes' ? 'rgba(50,230,120,0.25)' : 'rgba(240,100,100,0.25)';
    ctx.fillRect(0, 0, 24, 24);
    return c.toDataURL();
  };
}

const [content, dungeons, runtime] = await Promise.all([
  fetch('/api/content').then((r) => r.json()),
  fetch('/api/dungeons').then((r) => r.json()),
  fetch('/api/runtime').then((r) => r.json()).catch(() => ({ wsPath: '/ws', publicBaseUrl: '' }))
]);
state.content = content;
state.dungeons = dungeons;
state.runtime = { wsPath: runtime.wsPath || '/ws', publicBaseUrl: runtime.publicBaseUrl || '' };

const getPortrait = buildPortraitFactory(content.characters);
const confirmOverlay = new ConfirmChoiceOverlay(confirmOverlayEl, getPortrait);

function updateLoadoutStatus() {
  const char = content.characters.find((c) => c.id === avatarSelect.value) || content.characters[0];
  state.characterId = char.id;
  const pctx = loadoutPortrait.getContext('2d');
  pctx.imageSmoothingEnabled = false;
  pctx.clearRect(0, 0, 80, 80);
  const img = new Image();
  img.src = getPortrait(char.id, 'base');
  pctx.drawImage(img, 8, 8, 64, 64);

  coreStatsEl.innerHTML = `
    <div class="k">${char.name}</div><div></div><div class="v"></div>
    <div class="k">LV</div><div></div><div class="v">1</div>
    <div class="k">HP</div><div></div><div class="v">${char.stats.hp}/${char.stats.hp}</div>
    <div class="k">PP</div><div></div><div class="v">${char.stats.focus * 2}/${char.stats.focus * 2}</div>
  `;
  battleStatsEl.innerHTML = `
    <div class="k">Attack</div><div></div><div class="v">${char.stats.atk}</div>
    <div class="k">Defense</div><div></div><div class="v">${Math.round(char.stats.hp / 10)}</div>
    <div class="k">Agility</div><div></div><div class="v">${char.stats.speed}</div>
    <div class="k">Luck</div><div></div><div class="v">${Math.max(1, Math.floor(char.stats.focus / 3))}</div>
  `;
}

function renderLobby() {
  if (!state.lobby) return;
  lobbyCodeDisplay.textContent = state.lobby.code;
  lobbyRoleEl.textContent = state.isHost ? 'Role: Host' : state.isSpectator ? 'Role: Spectator (late join)' : 'Role: Guest';
  lobbyRosterEl.textContent = state.lobby.players.map((p) => {
    const host = p.id === state.lobby.hostId ? '[HOST] ' : '';
    const ready = p.spectator ? 'spectator' : (p.ready ? 'ready' : 'not ready');
    const you = p.id === state.playerId ? ' (you)' : '';
    return `${host}${p.name}${you} — ${ready}`;
  }).join('\n');
  readyBtn.disabled = state.isSpectator || state.inRun;
  readyBtn.textContent = state.ready ? 'Set Not Ready' : 'Set Ready';
  const allReady = state.lobby.players.filter((p) => !p.spectator).every((p) => p.ready);
  hostStartBtn.disabled = !state.isHost || state.inRun || !allReady;
}

function connect() {
  const base = state.runtime.publicBaseUrl || `${location.protocol}//${location.host}`;
  const baseUrl = new URL(base, window.location.href);
  const wsProto = baseUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsPath = state.runtime.wsPath || '/ws';
  state.ws = new WebSocket(`${wsProto}//${baseUrl.host}${wsPath}`);

  state.ws.onopen = () => {
    const payload = {
      playerId: state.playerId,
      name: state.name,
      characterId: state.characterId,
      djinn: state.selectedDjinn.map((id) => ({ id, state: 'set' })),
      dungeonId: state.dungeonId,
      difficulty: state.difficulty
    };
    if (state.mode === 'host' || state.mode === 'solo') {
      state.ws.send(JSON.stringify({ type: 'create_lobby', mode: state.mode, ...payload }));
    } else {
      state.ws.send(JSON.stringify({ type: 'join_lobby', code: state.roomCode, ...payload }));
    }
  };

  state.ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'join_error') {
      alert(msg.message);
      show('play');
      return;
    }
    if (msg.type === 'joined_lobby') {
      state.roomCode = msg.code;
      state.isHost = Boolean(msg.host);
      state.isSpectator = Boolean(msg.spectator);
      state.ready = state.mode === 'host' || state.mode === 'solo' || state.isSpectator;
      logUI(`joined lobby ${msg.code}`);
    }
    if (msg.type === 'lobby_update') {
      state.lobby = msg.lobby;
      const me = state.lobby.players.find((p) => p.id === state.playerId);
      if (me) { state.ready = me.ready; state.isSpectator = me.spectator; }
      renderLobby();
    }
    if (msg.type === 'start_denied') {
      logUI(msg.message);
      renderHUD();
    }
    if (msg.type === 'run_started') {
      state.inRun = true;
      state.server = msg.state;
      state.lobby = msg.lobby;
      hud.classList.remove('hidden');
      show('play');
      screens.play.classList.remove('active');
      renderHUD();
      syncMeshes();
      logUI('run started');
    }
    if (msg.type === 'snapshot') {
      state.server = msg.state;
      if (msg.lobby) state.lobby = msg.lobby;
      if (state.inRun) { renderHUD(); syncMeshes(); }
    }
  };
}

async function askYesNo(message) {
  const result = await confirmOverlay.open(message, state.characterId);
  logUI(`confirm ${message} => ${result === null ? 'cancel' : result ? 'yes' : 'no'}`);
  return result;
}

for (const d of content.dungeons) {
  const op = document.createElement('option'); op.value = d.id; op.textContent = `${d.name} (${d.id})`; dungeonSelect.append(op);
}
for (const c of content.characters) {
  const op = document.createElement('option'); op.value = c.id; op.textContent = `${c.element}/${c.weapon} - ${c.name}`; avatarSelect.append(op);
}
for (const d of Object.values(content.djinn).flat()) {
  const op = document.createElement('option'); op.value = d.id; op.textContent = `${d.name}: ${d.active}`; djinnSelect.append(op);
}
updateLoadoutStatus();
avatarSelect.addEventListener('change', updateLoadoutStatus);

for (const btn of document.querySelectorAll('[data-mode]')) {
  btn.onclick = () => {
    state.mode = btn.dataset.mode;
    if (state.mode === 'join') state.roomCode = (document.getElementById('joinCode').value || '').toUpperCase().trim();
    show('setup');
  };
}
document.getElementById('optionsBtn').onclick = () => show('options');
document.getElementById('closeOptions').onclick = () => show('setup');

readyBtn.onclick = () => {
  if (!state.ws || state.ws.readyState !== 1 || state.isSpectator || state.inRun) return;
  state.ws.send(JSON.stringify({ type: 'set_ready', ready: !state.ready }));
};
hostStartBtn.onclick = () => {
  if (!state.ws || state.ws.readyState !== 1 || !state.isHost) return;
  state.ws.send(JSON.stringify({ type: 'start_run' }));
};

document.getElementById('startBtn').onclick = () => {
  state.characterId = avatarSelect.value;
  state.selectedDjinn = [...djinnSelect.selectedOptions].slice(0, 8).map((o) => o.value);
  if (state.selectedDjinn.length === 0) state.selectedDjinn = Object.values(content.djinn).flat().slice(0, 8).map((d) => d.id);
  state.dungeonId = dungeonSelect.value;
  state.difficulty = document.getElementById('difficultySelect').value;
  connect();
  show('lobby');
  logUI('connecting to lobby...');
};

// three scene
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#2a3550');
const camera = new THREE.PerspectiveCamera(33, window.innerWidth / window.innerHeight, 0.1, 150);
function updateCameraForRoom(roomCenterX, roomCenterZ) {
  const pitch = THREE.MathUtils.degToRad(40);
  const yaw = THREE.MathUtils.degToRad(50);
  const distance = 23;
  const horizontal = distance * Math.cos(pitch);
  const y = distance * Math.sin(pitch);
  const x = roomCenterX + horizontal * Math.sin(yaw);
  const z = roomCenterZ + horizontal * Math.cos(yaw);
  camera.position.set(x, y, z);
  camera.lookAt(roomCenterX, 1.2, roomCenterZ);
  camera.rotation.z = 0;
}
updateCameraForRoom(0, 0);

scene.add(new THREE.AmbientLight(0xffffff, 0.85));
const dir = new THREE.DirectionalLight(0xffffff, 0.62);
dir.position.set(8, 14, 6);
scene.add(dir);

const matGround = new THREE.MeshLambertMaterial({ color: '#5f6f84' });
const matPath = new THREE.MeshLambertMaterial({ color: '#6f7f95' });
const matWall = new THREE.MeshLambertMaterial({ color: '#3a4254', transparent: true, opacity: 1 });
const matHouse = new THREE.MeshLambertMaterial({ color: '#76869e' });
const matRoof = new THREE.MeshLambertMaterial({ color: '#9f4b42', transparent: true, opacity: 1 });
const matDoor = new THREE.MeshLambertMaterial({ color: '#3b2b24' });
const matPlayer = new THREE.MeshLambertMaterial({ color: '#ffcc66' });
const matGhost = new THREE.MeshLambertMaterial({ color: '#96a7ff' });
const matPreview = new THREE.MeshBasicMaterial({ color: '#00ffcc', wireframe: true });

const world = new THREE.Group();
scene.add(world);
const walls = [];
const roofs = [];
for (let x = -7; x <= 7; x += 1) {
  for (let z = -7; z <= 7; z += 1) {
    const tile = new THREE.Mesh(new THREE.BoxGeometry(1, 0.1, 1), Math.abs(x - z) <= 1 ? matPath : matGround);
    tile.position.set(x, -0.05, z);
    world.add(tile);
    if ((Math.abs(x) === 7 || Math.abs(z) === 7) && (x + z) % 2 === 0) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(1, 2.3, 1), matWall.clone());
      wall.position.set(x, 1.1, z);
      walls.push(wall);
      world.add(wall);
    }
  }
}
function createDioramaBuilding(cfg) {
  const { x, z, w, d, h, roofH } = cfg;
  const building = new THREE.Group();
  building.position.set(x, 0, z);
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), matHouse);
  body.position.set(0, h / 2, 0);
  body.scale.set(1.15, 0.82, 1.35);
  const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.7, roofH, d + 0.9), matRoof.clone());
  roof.position.set(0, h + roofH / 2, 0);
  roof.scale.set(1.22, 1.45, 1.38);
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.65, 1.1, 0.12), matDoor);
  door.position.set(-w * 0.18, 0.55, d * 0.52);
  building.add(body, roof, door);
  world.add(building);
  roofs.push({ mesh: roof, footprint: { minX: x - (w * 0.75), maxX: x + (w * 0.75), minZ: z - (d * 0.75), maxZ: z + (d * 0.75) } });
}
createDioramaBuilding({ x: -4.2, z: -2.6, w: 2.5, d: 1.7, h: 1.8, roofH: 0.7 });
createDioramaBuilding({ x: -1.0, z: 0.6, w: 2.3, d: 1.6, h: 1.7, roofH: 0.65 });
createDioramaBuilding({ x: 2.2, z: 3.1, w: 2.7, d: 1.9, h: 1.9, roofH: 0.75 });
createDioramaBuilding({ x: 4.8, z: -0.4, w: 2.4, d: 1.8, h: 1.8, roofH: 0.72 });

const playerMeshes = new Map();
const ghostMeshes = new Map();
const preview = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), matPreview);
preview.position.set(0, 0.5, 0);
scene.add(preview);

function applyOcclusionDiscipline() {
  const ray = new THREE.Raycaster();
  for (const wall of walls) wall.material.opacity = 1;
  for (const roof of roofs) roof.mesh.material.opacity = 1;
  const localPlayer = state.server?.players?.find((p) => p.id === state.playerId);
  if (localPlayer) {
    for (const roof of roofs) {
      const f = roof.footprint;
      const inside = localPlayer.x >= f.minX && localPlayer.x <= f.maxX && localPlayer.y >= f.minZ && localPlayer.y <= f.maxZ;
      if (inside) roof.mesh.material.opacity = 0.18;
    }
  }
  for (const mesh of playerMeshes.values()) {
    const dirVec = mesh.position.clone().sub(camera.position).normalize();
    ray.set(camera.position, dirVec);
    const hits = ray.intersectObjects(walls, false);
    hits.forEach((h) => { if (h.distance < camera.position.distanceTo(mesh.position)) h.object.material.opacity = 0.22; });
  }
}

function syncMeshes() {
  if (!state.server) return;
  for (const p of state.server.players) {
    if (!playerMeshes.has(p.id)) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.6, 1.0), matPlayer.clone());
      mesh.material.color = new THREE.Color(p.id === state.playerId ? '#ffe066' : '#ff9f66');
      scene.add(mesh);
      playerMeshes.set(p.id, mesh);
    }
    playerMeshes.get(p.id).position.set(p.x, 0.8, p.y);
  }
  for (const [id, mesh] of playerMeshes.entries()) {
    if (!state.server.players.some((p) => p.id === id)) { scene.remove(mesh); playerMeshes.delete(id); }
  }
  for (const g of state.server.ghosts) {
    if (!ghostMeshes.has(g.id)) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.6, 1.0), matGhost);
      scene.add(mesh);
      ghostMeshes.set(g.id, mesh);
    }
    ghostMeshes.get(g.id).position.set(g.x, 0.8, g.y);
  }
  for (const [id, mesh] of ghostMeshes.entries()) {
    if (!state.server.ghosts.some((g) => g.id === id)) { scene.remove(mesh); ghostMeshes.delete(id); }
  }
  const roomShift = state.server.roomIndex * 4;
  updateCameraForRoom(roomShift, roomShift);
  applyOcclusionDiscipline();
}

function renderHUD() {
  if (!state.server) return;
  partyEl.innerHTML = `<b>Party (${state.server.players.length}/8)</b><br>${state.server.players.map((p) => `${p.name} HP:${Math.round(p.hp)} Djinn:${p.djinn.filter((d) => d.state === 'set').length}/${p.djinn.length}`).join('<br>')}`;
  hotbarEl.innerHTML = verbs.map((v, i) => `<span ${i === state.verbIndex ? 'class="ui-focus"' : ''}>[${i + 1}] ${v}</span>`).join(' | ');
  const objectiveLine = state.server.roomIndex < 2
    ? `Contribute to room seals (${state.server.objectiveProgress}/${state.server.objectiveRequired}).`
    : `Charge boss seals asynchronously (${state.server.bossCharge}/${state.server.bossChargeRequired}) then fire spotlight verbs.`;
  hintEl.innerHTML = `<b>Objective hints</b><br>${objectiveLine}<br>Late join policy: spectator only after run start.`;
  bossEl.innerHTML = `<b>Boss phase</b><br>Phase ${state.server.bossPhase + 1} HP ${state.server.bossHP}<br>Spotlight: ${(state.server.bossSpotlightVerbs || []).join(', ')}`;
  minimapEl.innerHTML = `Dungeon ${state.server.dungeonId}<br>Room ${state.server.roomIndex + 1}/3<br>Lobby ${state.roomCode || 'pending'}`;
  debugEl.innerHTML = `<b>Debug overlay</b><br>Tick:${state.server.tick}<br>Traces:${state.server.traces.map((t) => t.verb || t.summon || 'boss-charge').join(', ')}<br>UI:${state.uiLog.slice(-5).join(' | ')}`;
}

function sendInput(payload) {
  if (!state.ws || state.ws.readyState !== 1 || !state.inRun || state.isSpectator) return;
  state.replayLog.push(JSON.stringify(payload));
  state.ws.send(JSON.stringify({ type: 'input', payload }));
}

window.addEventListener('keydown', async (e) => {
  if (confirmOverlay.isOpen()) {
    const key = e.key.toLowerCase();
    if (key === 'arrowleft' || key === 'arrowup') { e.preventDefault(); confirmOverlay.setSelection(0); }
    else if (key === 'arrowright' || key === 'arrowdown') { e.preventDefault(); confirmOverlay.setSelection(1); }
    else if (key === 'enter' || key === ' ') { e.preventDefault(); confirmOverlay.confirm(confirmOverlay.selection); }
    else if (key === 'escape') { e.preventDefault(); confirmOverlay.cancel(); }
    return;
  }

  if (e.key.toLowerCase() === 't') {
    state.showThemePreview = !state.showThemePreview;
    logUI(`theme preview ${state.showThemePreview ? 'on' : 'off'}`);
    if (state.showThemePreview) show('setup');
    return;
  }

  if (e.key === 'Escape' && state.inRun) {
    state.paused = !state.paused;
    pauseMenu.classList.toggle('hidden', !state.paused);
    return;
  }
  if (!state.inRun || state.paused || state.isSpectator) return;

  const key = e.key.toLowerCase();
  const dirs = { w: 'up', a: 'left', s: 'down', d: 'right' };
  if (dirs[key]) sendInput({ type: 'move', dir: dirs[key], buffer: [dirs[key]] });
  const idx = Number(e.key) - 1;
  if (idx >= 0 && idx < 8) { state.verbIndex = idx; sendInput({ type: 'verb', verb: verbs[idx], cell: [Math.round(preview.position.x), Math.round(preview.position.z)] }); }
  if (key === 'q') sendInput({ type: 'djinn', id: state.selectedDjinn[0] });
  if (key === 'e') sendInput({ type: 'summon', id: state.content.summons[0].id });
  if (key === 'f') sendInput({ type: 'contribute' });
  if (key === 'y') {
    const result = await askYesNo('abandon run?');
    if (result === true && state.ws?.readyState === 1) state.ws.send(JSON.stringify({ type: 'pause', action: 'abandon-run' }));
  }
});

window.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  const mouse = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(mouse, camera);
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  ray.ray.intersectPlane(groundPlane, hit);
  preview.position.set(Math.round(hit.x), 0.5, Math.round(hit.z));
});

for (const btn of document.querySelectorAll('[data-pause]')) {
  btn.onclick = async () => {
    const action = btn.dataset.pause;
    if (action === 'resume') { state.paused = false; pauseMenu.classList.add('hidden'); return; }
    const prompt = action === 'restart-room' ? 'restart room?' : 'abandon run?';
    const result = await askYesNo(prompt);
    if (result === true && state.ws?.readyState === 1) {
      state.ws.send(JSON.stringify({ type: 'pause', action }));
      if (action === 'abandon-run') { state.paused = false; pauseMenu.classList.add('hidden'); }
    }
  };
}

function animate() {
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  applyUIScale();
});

applyUIScale();
