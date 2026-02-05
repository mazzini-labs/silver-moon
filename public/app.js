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
  replayLog: []
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

function show(name) { Object.values(screens).forEach((s) => s.classList.remove('active')); screens[name].classList.add('active'); }

const [content, dungeons] = await Promise.all([fetch('/api/content').then((r) => r.json()), fetch('/api/dungeons').then((r) => r.json())]);
state.content = content;
state.dungeons = dungeons;

const dungeonSelect = document.getElementById('dungeonSelect');
content.dungeons.forEach((d) => {
  const op = document.createElement('option'); op.value = d.id; op.textContent = `${d.name} (${d.id})`; dungeonSelect.append(op);
});
const avatarSelect = document.getElementById('avatarSelect');
content.characters.forEach((c) => {
  const op = document.createElement('option'); op.value = c.id; op.textContent = `${c.element}/${c.weapon} - ${c.name}`; avatarSelect.append(op);
});
const djinnSelect = document.getElementById('djinnSelect');
Object.values(content.djinn).flat().forEach((d) => {
  const op = document.createElement('option'); op.value = d.id; op.textContent = `${d.name}: ${d.active}`; djinnSelect.append(op);
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

// Three.js fixed-isometric rendering
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#283049');

const cameraZoomLevels = [11, 14, 18];
let currentZoom = 1;
const camera = new THREE.OrthographicCamera(-cameraZoomLevels[currentZoom], cameraZoomLevels[currentZoom], cameraZoomLevels[currentZoom], -cameraZoomLevels[currentZoom], 0.1, 100);
camera.position.set(10, 13, 10);
camera.lookAt(0, 0, 0);

scene.add(new THREE.AmbientLight(0xffffff, 0.9));
const dir = new THREE.DirectionalLight(0xffffff, 0.6);
dir.position.set(6, 10, 4);
scene.add(dir);

const matGround = new THREE.MeshLambertMaterial({ color: '#5d6b7f' });
const matWall = new THREE.MeshLambertMaterial({ color: '#3a4254', transparent: true, opacity: 1 });
const matPlayer = new THREE.MeshLambertMaterial({ color: '#ffcc66' });
const matGhost = new THREE.MeshLambertMaterial({ color: '#96a7ff' });
const matPreview = new THREE.MeshBasicMaterial({ color: '#00ffcc', wireframe: true });

const grid = new THREE.Group();
scene.add(grid);
const walls = [];
for (let x = -6; x <= 6; x++) {
  for (let y = -6; y <= 6; y++) {
    const tile = new THREE.Mesh(new THREE.BoxGeometry(1, 0.1, 1), matGround);
    tile.position.set(x, -0.05, y);
    grid.add(tile);
    if ((Math.abs(x) === 6 || Math.abs(y) === 6) && (x + y) % 2 === 0) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(1, 2, 1), matWall.clone());
      wall.position.set(x, 1, y);
      walls.push(wall);
      grid.add(wall);
    }
  }
}

const playerMeshes = new Map();
const ghostMeshes = new Map();
const preview = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), matPreview);
preview.position.set(0, 0.5, 0);
scene.add(preview);

function applyOcclusionFade() {
  const ray = new THREE.Raycaster(camera.position, new THREE.Vector3(-1, -1, -1).normalize());
  for (const wall of walls) wall.material.opacity = 1;
  for (const mesh of playerMeshes.values()) {
    const dirVec = mesh.position.clone().sub(camera.position).normalize();
    ray.set(camera.position, dirVec);
    const hits = ray.intersectObjects(walls, false);
    hits.forEach((h) => { if (h.distance < camera.position.distanceTo(mesh.position)) h.object.material.opacity = 0.2; });
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
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.2, 0.8), matPlayer.clone());
      mesh.material.color = new THREE.Color(p.id === state.playerId ? '#ffe066' : '#ff9f66');
      scene.add(mesh); playerMeshes.set(p.id, mesh);
    }
    playerMeshes.get(p.id).position.set(p.x, 0.6, p.y);
  }
  for (const [id, mesh] of playerMeshes.entries()) if (!state.server.players.some((p) => p.id === id)) { scene.remove(mesh); playerMeshes.delete(id); }

  for (const g of state.server.ghosts) {
    if (!ghostMeshes.has(g.id)) {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.2, 0.8), matGhost);
      scene.add(mesh); ghostMeshes.set(g.id, mesh);
    }
    ghostMeshes.get(g.id).position.set(g.x, 0.6, g.y);
  }
  for (const [id, mesh] of ghostMeshes.entries()) if (!state.server.ghosts.some((g) => g.id === id)) { scene.remove(mesh); ghostMeshes.delete(id); }

  // room-to-room shift only
  const roomShift = state.server.roomIndex * 4;
  camera.position.set(10 + roomShift, 13, 10 + roomShift);
  camera.lookAt(roomShift, 0, roomShift);
  applyOcclusionFade();
}

function renderHUD() {
  if (!state.server) return;
  partyEl.innerHTML = `<b>Party (${state.server.players.length}/8)</b><br>` + state.server.players.map((p) => `${p.name} HP:${Math.round(p.hp)} Djinn:${p.djinn.filter((d)=>d.state==='set').length}/${p.djinn.length}`).join('<br>');
  hotbarEl.innerHTML = verbs.map((v, i) => `<span ${i===state.verbIndex?'style="color:#00ffcc"':''}>[${i+1}] ${v}</span>`).join(' | ');
  hintEl.innerHTML = `<b>Objective hints</b><br>Contribute to room seals (${state.server.objectiveProgress}/${state.server.objectiveRequired}).<br>Ping: middle-click mark target/danger/go here.`;
  bossEl.innerHTML = `<b>Boss phase</b><br>Phase ${state.server.bossPhase + 1} HP ${state.server.bossHP}`;
  minimapEl.innerHTML = `Dungeon ${state.server.dungeonId}<br>Room ${state.server.roomIndex + 1}/3`;
  debugEl.innerHTML = `<b>Debug overlay</b><br>Tick:${state.server.tick}<br>Traces:${state.server.traces.map((t)=>t.verb||t.summon).join(', ')}<br>Replay log:${state.replayLog.slice(-5).join(' | ')}`;
}

function sendInput(payload) {
  if (!state.ws || state.ws.readyState !== 1) return;
  state.replayLog.push(JSON.stringify(payload));
  state.ws.send(JSON.stringify({ type: 'input', payload }));
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    state.paused = !state.paused;
    pauseMenu.classList.toggle('hidden', !state.paused);
    return;
  }
  if (state.paused) return;
  const dirs = { w: 'up', a: 'left', s: 'down', d: 'right' };
  if (dirs[e.key]) sendInput({ type: 'move', dir: dirs[e.key], buffer: [dirs[e.key]] });
  const idx = Number(e.key) - 1;
  if (idx >= 0 && idx < 8) { state.verbIndex = idx; sendInput({ type: 'verb', verb: verbs[idx], cell: [Math.round(preview.position.x), Math.round(preview.position.z)] }); }
  if (e.key.toLowerCase() === 'q') sendInput({ type: 'djinn', id: state.selectedDjinn[0] });
  if (e.key.toLowerCase() === 'e') sendInput({ type: 'summon', id: state.content.summons[0].id });
  if (e.key.toLowerCase() === 'f') sendInput({ type: 'contribute' });
  if (e.key.toLowerCase() === 'z') { currentZoom = (currentZoom + 1) % cameraZoomLevels.length; camera.left = -cameraZoomLevels[currentZoom]; camera.right = cameraZoomLevels[currentZoom]; camera.top = cameraZoomLevels[currentZoom]; camera.bottom = -cameraZoomLevels[currentZoom]; camera.updateProjectionMatrix(); }
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
  btn.onclick = () => {
    const action = btn.dataset.pause;
    if (action === 'resume') {
      state.paused = false;
      pauseMenu.classList.add('hidden');
    } else {
      state.ws.send(JSON.stringify({ type: 'pause', action }));
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
};

function animate() {
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();

window.addEventListener('resize', () => renderer.setSize(window.innerWidth, window.innerHeight));
