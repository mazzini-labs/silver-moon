import * as THREE from 'https://unpkg.com/three@0.164.1/build/three.module.js';

const state = {
  content: null,
  dungeons: null,
  ws: null,
  mode: 'solo',
  roomCode: '',
  playerId: `p-${Math.random().toString(16).slice(2, 8)}`,
  name: `Player-${Math.floor(Math.random() * 99)}`,
  characterId: 'c1',
  selectedDjinn: [],
  dungeonId: 'd1',
  difficulty: 'standard',
  server: null,
  paused: false,
  verbIndex: 0,
  replayLog: [],
  uiLog: []
};

const verbs = ['push_pull', 'lift_throw', 'pound', 'freeze', 'growth', 'tether', 'reveal', 'swap'];

const screens = {
  play: document.getElementById('screen-play'),
  setup: document.getElementById('screen-setup'),
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

function logUI(message) {
  state.uiLog.push(message);
  if (state.uiLog.length > 12) state.uiLog.shift();
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
      <div class="confirm-dialog">
        <div class="confirm-message" id="confirmMessage"></div>
        <div class="confirm-portraits" id="confirmPortraits"></div>
        <div class="confirm-buttons">
          <button class="confirm-choice-btn" data-choice="0">YES</button>
          <button class="confirm-choice-btn" data-choice="1">NO</button>
        </div>
      </div>
    `;

    this.messageEl = this.root.querySelector('#confirmMessage');
    this.portraitWrap = this.root.querySelector('#confirmPortraits');
    this.buttons = [...this.root.querySelectorAll('.confirm-choice-btn')];

    this.buttons.forEach((button) => {
      button.onclick = () => this.confirm(Number(button.dataset.choice));
      button.onmouseenter = () => this.setSelection(Number(button.dataset.choice));
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
      img.style.width = '24px';
      img.style.height = '24px';
      img.style.imageRendering = 'pixelated';
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

  cancel() {
    if (!this.opened) return;
    this.close(null);
  }

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
  // Temporary 24x24 placeholders. Replace with authored sprite sheet at /public/sprites/portraits.png.
  const byId = new Map();
  const palette = ['#cc6655', '#f0b84a', '#66b3d9', '#82d17a', '#8a78d8', '#d96fb8', '#73d9c1', '#d9d56f'];

  for (let i = 0; i < characters.length; i += 1) {
    const c = document.createElement('canvas');
    c.width = 24;
    c.height = 24;
    const ctx = c.getContext('2d', { alpha: true });
    ctx.imageSmoothingEnabled = false;

    ctx.fillStyle = '#111';
    ctx.fillRect(0, 0, 24, 24);
    ctx.fillStyle = '#222';
    ctx.fillRect(1, 1, 22, 22);
    ctx.fillStyle = '#f2d7b0';
    ctx.fillRect(6, 5, 12, 10);
    ctx.fillStyle = palette[i % palette.length];
    ctx.fillRect(4, 3, 16, 5);
    ctx.fillRect(6, 15, 12, 6);
    ctx.fillStyle = '#000';
    ctx.fillRect(9, 9, 2, 2);
    ctx.fillRect(13, 9, 2, 2);

    byId.set(characters[i].id, c.toDataURL());
  }

  const tint = (base, mode) => {
    const c = document.createElement('canvas');
    c.width = 24;
    c.height = 24;
    const ctx = c.getContext('2d', { alpha: true });
    ctx.imageSmoothingEnabled = false;
    const img = new Image();
    img.src = base;
    ctx.drawImage(img, 0, 0);
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = mode === 'yes' ? 'rgba(50,230,120,0.25)' : 'rgba(240,100,100,0.25)';
    ctx.fillRect(0, 0, 24, 24);
    ctx.globalCompositeOperation = 'source-over';
    return c.toDataURL();
  };

  return (characterId, mode) => {
    const base = byId.get(characterId) || [...byId.values()][0];
    return tint(base, mode);
  };
}

const [content, dungeons] = await Promise.all([
  fetch('/api/content').then((r) => r.json()),
  fetch('/api/dungeons').then((r) => r.json())
]);
state.content = content;
state.dungeons = dungeons;

const getPortrait = buildPortraitFactory(content.characters);
const confirmOverlay = new ConfirmChoiceOverlay(confirmOverlayEl, getPortrait);

const dungeonSelect = document.getElementById('dungeonSelect');
content.dungeons.forEach((d) => {
  const op = document.createElement('option');
  op.value = d.id;
  op.textContent = `${d.name} (${d.id})`;
  dungeonSelect.append(op);
});

const avatarSelect = document.getElementById('avatarSelect');
content.characters.forEach((c) => {
  const op = document.createElement('option');
  op.value = c.id;
  op.textContent = `${c.element}/${c.weapon} - ${c.name}`;
  avatarSelect.append(op);
});

const djinnSelect = document.getElementById('djinnSelect');
Object.values(content.djinn).flat().forEach((d) => {
  const op = document.createElement('option');
  op.value = d.id;
  op.textContent = `${d.name}: ${d.active}`;
  djinnSelect.append(op);
});

for (const btn of document.querySelectorAll('[data-mode]')) {
  btn.onclick = () => {
    state.mode = btn.dataset.mode;
    if (btn.dataset.mode === 'join') state.roomCode = document.getElementById('joinCode').value || 'ROOM-100';
    show('setup');
  };
}
document.getElementById('optionsBtn').onclick = () => show('options');
document.getElementById('closeOptions').onclick = () => show('setup');

// --- Three.js renderer and Golden-Sun-style oblique perspective camera ---
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#2a3550');

const CAMERA_FOV = 33;
const CAMERA_PITCH_DEG = 40;
const CAMERA_YAW_DEG = 50; // 45 + 5 axis bias (intentionally non-symmetric)
const CAMERA_DISTANCE = 23;
const camera = new THREE.PerspectiveCamera(CAMERA_FOV, window.innerWidth / window.innerHeight, 0.1, 150);

function updateCameraForRoom(roomCenterX, roomCenterZ) {
  const pitch = THREE.MathUtils.degToRad(CAMERA_PITCH_DEG);
  const yaw = THREE.MathUtils.degToRad(CAMERA_YAW_DEG);
  const horizontal = CAMERA_DISTANCE * Math.cos(pitch);
  const y = CAMERA_DISTANCE * Math.sin(pitch);
  const x = roomCenterX + horizontal * Math.sin(yaw);
  const z = roomCenterZ + horizontal * Math.cos(yaw);
  camera.position.set(x, y, z);
  camera.lookAt(roomCenterX, 1.2, roomCenterZ);
  camera.rotation.z = 0; // no roll
}
updateCameraForRoom(0, 0);

// Flat lighting only
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
    const tileMat = (Math.abs(x - z) <= 1) ? matPath : matGround;
    const tile = new THREE.Mesh(new THREE.BoxGeometry(1, 0.1, 1), tileMat);
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

  const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.7, roofH, d + 0.9), matRoof.clone());
  roof.position.set(0, h + roofH / 2, 0);

  // chunkier, non-uniform prop scaling and compressed interior feel
  body.scale.set(1.15, 0.82, 1.35);
  roof.scale.set(1.22, 1.45, 1.38);

  const door = new THREE.Mesh(new THREE.BoxGeometry(0.65, 1.1, 0.12), matDoor);
  // diagonal arrangement with readable entrance from fixed oblique camera
  door.position.set(-w * 0.18, 0.55, d * 0.52);

  building.add(body, roof, door);
  world.add(building);

  roofs.push({
    mesh: roof,
    footprint: {
      minX: x - (w * 0.75),
      maxX: x + (w * 0.75),
      minZ: z - (d * 0.75),
      maxZ: z + (d * 0.75)
    }
  });
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
    hits.forEach((h) => {
      if (h.distance < camera.position.distanceTo(mesh.position)) h.object.material.opacity = 0.22;
    });
  }
}

function connect() {
  state.ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`);
  state.ws.onopen = () => {
    state.ws.send(JSON.stringify({
      type: state.mode,
      code: state.roomCode,
      playerId: state.playerId,
      name: state.name,
      characterId: state.characterId,
      djinn: state.selectedDjinn.map((id) => ({ id, state: 'set' })),
      dungeonId: state.dungeonId,
      difficulty: state.difficulty
    }));
  };
  state.ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === 'joined') state.roomCode = msg.code;
    if (msg.type === 'snapshot') {
      state.server = msg.state;
      renderHUD();
      syncMeshes();
    }
  };
}

function syncMeshes() {
  if (!state.server) return;

  for (const p of state.server.players) {
    if (!playerMeshes.has(p.id)) {
      // Slightly oversized characters for readability against props/doors.
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.6, 1.0), matPlayer.clone());
      mesh.material.color = new THREE.Color(p.id === state.playerId ? '#ffe066' : '#ff9f66');
      scene.add(mesh);
      playerMeshes.set(p.id, mesh);
    }
    playerMeshes.get(p.id).position.set(p.x, 0.8, p.y);
  }
  for (const [id, mesh] of playerMeshes.entries()) {
    if (!state.server.players.some((p) => p.id === id)) {
      scene.remove(mesh);
      playerMeshes.delete(id);
    }
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
    if (!state.server.ghosts.some((g) => g.id === id)) {
      scene.remove(mesh);
      ghostMeshes.delete(id);
    }
  }

  const roomShift = state.server.roomIndex * 4;
  updateCameraForRoom(roomShift, roomShift);
  applyOcclusionDiscipline();
}

function renderHUD() {
  if (!state.server) return;
  partyEl.innerHTML = `<b>Party (${state.server.players.length}/8)</b><br>${state.server.players.map((p) => `${p.name} HP:${Math.round(p.hp)} Djinn:${p.djinn.filter((d) => d.state === 'set').length}/${p.djinn.length}`).join('<br>')}`;
  hotbarEl.innerHTML = verbs.map((v, i) => `<span ${i === state.verbIndex ? 'style="color:#00ffcc"' : ''}>[${i + 1}] ${v}</span>`).join(' | ');

  const objectiveLine = state.server.roomIndex < 2
    ? `Contribute to room seals (${state.server.objectiveProgress}/${state.server.objectiveRequired}).`
    : `Charge boss seals asynchronously (${state.server.bossCharge}/${state.server.bossChargeRequired}) then fire spotlight verbs.`;

  hintEl.innerHTML = `<b>Objective hints</b><br>${objectiveLine}<br>Ping: middle-click mark target/danger/go here.`;
  bossEl.innerHTML = `<b>Boss phase</b><br>Phase ${state.server.bossPhase + 1} HP ${state.server.bossHP}<br>Spotlight: ${(state.server.bossSpotlightVerbs || []).join(', ')}`;
  minimapEl.innerHTML = `Dungeon ${state.server.dungeonId}<br>Room ${state.server.roomIndex + 1}/3`;
  debugEl.innerHTML = `<b>Debug overlay</b><br>Tick:${state.server.tick}<br>Traces:${state.server.traces.map((t) => t.verb || t.summon || 'boss-charge').join(', ')}<br>UI:${state.uiLog.slice(-4).join(' | ')}<br>Replay:${state.replayLog.slice(-3).join(' | ')}`;
}

function sendInput(payload) {
  if (!state.ws || state.ws.readyState !== 1) return;
  state.replayLog.push(JSON.stringify(payload));
  state.ws.send(JSON.stringify({ type: 'input', payload }));
}

async function askYesNo(message) {
  const result = await confirmOverlay.open(message, state.characterId);
  logUI(`confirm ${message} => ${result === null ? 'cancel' : result ? 'yes' : 'no'}`);
  return result;
}

window.addEventListener('keydown', async (e) => {
  if (confirmOverlay.isOpen()) {
    const key = e.key.toLowerCase();
    if (key === 'arrowleft' || key === 'arrowup') {
      e.preventDefault();
      confirmOverlay.setSelection(0);
    } else if (key === 'arrowright' || key === 'arrowdown') {
      e.preventDefault();
      confirmOverlay.setSelection(1);
    } else if (key === 'enter' || key === ' ') {
      e.preventDefault();
      confirmOverlay.confirm(confirmOverlay.selection);
    } else if (key === 'escape') {
      e.preventDefault();
      confirmOverlay.cancel();
    }
    return;
  }

  if (e.key === 'Escape') {
    state.paused = !state.paused;
    pauseMenu.classList.toggle('hidden', !state.paused);
    return;
  }
  if (state.paused) return;

  const key = e.key.toLowerCase();
  const dirs = { w: 'up', a: 'left', s: 'down', d: 'right' };
  if (dirs[key]) sendInput({ type: 'move', dir: dirs[key], buffer: [dirs[key]] });
  const idx = Number(e.key) - 1;
  if (idx >= 0 && idx < 8) {
    state.verbIndex = idx;
    sendInput({ type: 'verb', verb: verbs[idx], cell: [Math.round(preview.position.x), Math.round(preview.position.z)] });
  }
  if (key === 'q') sendInput({ type: 'djinn', id: state.selectedDjinn[0] });
  if (key === 'e') sendInput({ type: 'summon', id: state.content.summons[0].id });
  if (key === 'f') sendInput({ type: 'contribute' });
  if (key === 'y') {
    const result = await askYesNo('abandon run?');
    if (result === true && state.ws?.readyState === 1) {
      state.ws.send(JSON.stringify({ type: 'pause', action: 'abandon-run' }));
    }
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
    if (action === 'resume') {
      state.paused = false;
      pauseMenu.classList.add('hidden');
      return;
    }

    const prompt = action === 'restart-room' ? 'restart room?' : 'abandon run?';
    const result = await askYesNo(prompt);
    if (result === true && state.ws?.readyState === 1) {
      state.ws.send(JSON.stringify({ type: 'pause', action }));
      if (action === 'abandon-run') {
        state.paused = false;
        pauseMenu.classList.add('hidden');
      }
    }
  };
}

document.getElementById('startBtn').onclick = () => {
  state.characterId = avatarSelect.value;
  state.selectedDjinn = [...djinnSelect.selectedOptions].slice(0, 8).map((o) => o.value);
  if (state.selectedDjinn.length === 0) state.selectedDjinn = Object.values(content.djinn).flat().slice(0, 8).map((d) => d.id);
  state.dungeonId = dungeonSelect.value;
  state.difficulty = document.getElementById('difficultySelect').value;
  connect();
  hud.classList.remove('hidden');
  show('play');
  screens.play.classList.remove('active');
  logUI('run started');
};

function animate() {
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});
