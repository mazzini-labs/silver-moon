# Silver Moon (Prototype)

Silver Moon is a browser game with a Node.js authoritative simulation server.

This guide is for both non-dev players and dev hosts.

---

## Quick reality check: does this project have a real lobby?

**Yes (now).**

Current flow in code:
1. Host creates a lobby over WebSocket (`create_lobby`) and receives a short 5-char code.
2. Guests join by entering that code (`join_lobby`).
3. Lobby screen shows roster + ready state.
4. **Only host** can start run (`start_run`), and all clients transition together.
5. Late join policy: **spectator after run has started** (no mid-room spawn).

Server authority remains on WebSocket state; REST endpoints are informational.

---

## Requirements

- Node.js 20+
- npm
- Chrome or Firefox

```bash
node -v
npm -v
```

Install dependencies:

```bash
npm install
```

---

## Scripts

Both scripts run the same server process:

```bash
npm run dev
npm start
```

---

## Runtime networking config (env vars)

The server supports:

- `PORT` (default `3000`)
- `HOST` (default `0.0.0.0`)
- `WS_PATH` (default `/ws`)
- `PUBLIC_BASE_URL` (default empty)

### What these affect

- HTTP served on `http://HOST:PORT`
- WebSocket endpoint served on `ws(s)://host<WS_PATH>`
- Client reads runtime config from `/api/runtime` and builds its WebSocket URL from `wsPath` + optional `publicBaseUrl`

### Example starts

Linux/macOS:

```bash
HOST=0.0.0.0 PORT=3000 WS_PATH=/ws npm run dev
```

Windows PowerShell:

```powershell
$env:HOST="0.0.0.0"; $env:PORT="3000"; $env:WS_PATH="/ws"; npm run dev
```

---

## 1) Local single-player

1. Install and start:

```bash
npm install
npm run dev
```

2. Open:

```text
http://localhost:3000
```

3. Click `Play Solo`.
4. Choose dungeon/loadout/difficulty.
5. Click `Start Dungeon Run`.

What actually happens:
- client creates a lobby with mode `solo`
- server auto-starts run immediately for solo host

---

## 2) Hosting multiplayer on LAN

### Host

1. Run server:

```bash
HOST=0.0.0.0 PORT=3000 WS_PATH=/ws npm start
```

2. Find your LAN IP (example: `192.168.1.50`).
3. Open `http://192.168.1.50:3000` in browser.
4. Click `Host`, configure setup, then `Start Dungeon Run`.
5. In lobby screen, share the displayed 5-char code.
6. Wait for guests to be ready.
7. Click `Host Start Dungeon Run`.

### Guest (LAN)

1. Open host URL (same LAN IP + port).
2. Enter lobby code in the first screen's room-code box.
3. Click `Join`.
4. Configure setup, click `Start Dungeon Run` (this joins lobby, does not force start).
5. Toggle `Set Ready`; wait for host to start.

---

## 3) Hosting multiplayer on the public internet (basic)

> Basic direct setup only (no auth/hardening).

1. Start server:

```bash
HOST=0.0.0.0 PORT=3000 WS_PATH=/ws npm start
```

2. Forward router TCP port `3000` to host machine.
3. Open firewall for TCP `3000`.
4. Share URL: `http://<public-ip>:3000`.

Optional proxy/domain setup:

```bash
HOST=0.0.0.0 PORT=3000 WS_PATH=/ws PUBLIC_BASE_URL=https://play.example.com npm start
```

This helps client websocket URL generation when externally addressed by domain.

---

## 4) Joining as a guest (LAN + public)

Guest needs:
- host URL (`http://host:port`)
- lobby code (5 chars)

Steps:
1. Open host URL.
2. Enter code.
3. Click `Join`.
4. Complete setup and join lobby.
5. Set ready.

If joining after run start:
- guest is marked **spectator** (roster shows spectator status).

---

## Lobby + run flow (actual code behavior)

WebSocket message flow:
- host: `create_lobby`
- guest: `join_lobby` with code
- server sends `joined_lobby`
- server broadcasts `lobby_update` with roster/ready/host/spectator state
- host sends `start_run`
- server validates host + readiness, then emits `run_started`
- server emits continuous `snapshot` updates while in run

REST endpoints used:
- `/api/content`
- `/api/dungeons`
- `/api/runtime`
- `/api/lobbies` (informational list of active lobbies)

---

## Quick verification checklist (host + guest)

### Host verify API

```bash
curl http://localhost:3000/api/runtime
curl http://localhost:3000/api/content
curl http://localhost:3000/api/lobbies
```

Expected:
- `/api/runtime` returns configured host/port/wsPath.
- `/api/lobbies` shows lobby after host creates one.

### Two-client verification

1. Open two browser tabs/windows to host URL.
2. Host creates lobby and notes code.
3. Guest joins same code.
4. Confirm roster shows 2 players.
5. Both set ready (host auto-ready by default).
6. Host starts run.
7. Confirm both transition into run and appear in party list.

---

## Troubleshooting

### 1) `EADDRINUSE` / address already in use

Port already occupied.

Use different port:

```bash
PORT=3010 npm run dev
```

Or stop existing process (Linux/macOS):

```bash
lsof -i :3000
kill <pid>
```

### 2) Guests cannot join lobby

- Ensure guest used same URL/port as host.
- Ensure lobby code is exact 5-char code displayed by host.
- Confirm host actually reached lobby screen (code exists only after lobby create).

### 3) WebSocket connection failure

- Verify `/api/runtime` `wsPath` and server `WS_PATH` match.
- Verify browser can reach `ws://host:port/ws` (or configured path).
- On HTTPS/public domain, ensure `wss://` is reachable.

### 4) Firewall/router problems

- LAN: host firewall must allow inbound chosen port.
- Public: router port forward + firewall both required.

### 5) Mixed-version mismatch

- Restart host server after updating code.
- Guests hard-refresh browser (Ctrl+F5).
- Ensure everyone loads same host URL.

### 6) Reading server logs

Server prints startup bind info:
- host/port
- ws path
- optional public base url

Keep terminal open while hosting to catch runtime errors.

---

## Controls

- Move: `W A S D`
- Verbs: `1..8`
- Djinn: `Q`
- Summon: `E`
- Contribute: `F`
- Confirm demo prompt: `Y`
- Pause: `Esc`
- Theme preview toggle (dev): `T`


## DOM UI Theme (GBA style)

UI is rendered in a fixed internal resolution DOM container (`480x270`) and scaled by an integer factor to fit screen (`2x/3x/4x...`) with nearest-neighbor settings.

- Theme file: `public/ui-theme.css`
- Pixel-font style currently uses a monospace fallback (no bundled binary font files).
- Screens/panels use shared classes: `.ui-panel`, `.ui-subpanel`, `.ui-btn`, `.ui-select`, `.ui-input`, `.ui-kv`, `.ui-row`, `.ui-col`, `.ui-focus`.

This keeps menu/HUD/dialog visuals consistent with the Golden Sun/GBA frame style.
