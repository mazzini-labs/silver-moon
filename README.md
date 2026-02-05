# Silver Moon (Prototype)

Web-based three.js + WebSocket prototype implementing a co-op puzzle-dungeon run loop.

This guide is intentionally written for both:
- **non-dev players** (just run and play), and
- **devs/hosts** (LAN/public hosting, ports, env vars, troubleshooting).

---

## 1) What this repo actually runs

Silver Moon is a **single Node process** (`server.js`) that serves:
- the web client (`public/*`) over HTTP, and
- the multiplayer WebSocket endpoint from the same server.

The client loads game data from:
- `GET /api/content`
- `GET /api/dungeons`
- `GET /api/runtime` (runtime networking config)

Then it opens a WebSocket to `ws://<host><WS_PATH>` (or `wss://...` if HTTPS/public URL says so).

---

## 2) Prerequisites

- **Node.js 20+** (22 recommended)
- **npm**
- Chrome or Firefox

Check versions:

```bash
node -v
npm -v
```

---

## 3) Install

From repo root:

```bash
npm install
```

Scripts in this repo:

```bash
npm run dev
npm start
```

Both scripts currently run the same server (`node server.js`).

---

## 4) Environment variables (networking/runtime)

The server now supports these env vars:

- `PORT` (default: `3000`)
- `HOST` (default: `0.0.0.0`)
- `WS_PATH` (default: `/ws`)
- `PUBLIC_BASE_URL` (default: empty)

### What they do

- `PORT`: HTTP + WS listen port.
- `HOST`: bind interface (`0.0.0.0` for LAN/public reachability, `127.0.0.1` local-only).
- `WS_PATH`: WebSocket route path used by both server and client runtime config.
- `PUBLIC_BASE_URL`: optional external URL hint used by client to build WS URL (useful behind reverse proxy / domain).

### Examples

Linux/macOS:

```bash
PORT=3000 HOST=0.0.0.0 WS_PATH=/ws npm run dev
```

Windows PowerShell:

```powershell
$env:PORT="3000"; $env:HOST="0.0.0.0"; $env:WS_PATH="/ws"; npm run dev
```

Server startup log includes effective URL + WS path.

---

## 5) Local single-player (same machine)

1. Install deps:

```bash
npm install
```

2. Start server:

```bash
npm run dev
```

3. Open browser:

```text
http://localhost:3000
```

4. In menu:
   - click **Play Solo**
   - pick dungeon/loadout/difficulty
   - click **Start Dungeon Run**

Notes:
- Solo uses a generated room code (`SOLO-###`) on connect.
- You can see current lobby code in HUD minimap panel after joining.

---

## 6) Host multiplayer on LAN

### Host machine

1. Start server bound for LAN:

```bash
HOST=0.0.0.0 PORT=3000 WS_PATH=/ws npm start
```

2. Find host LAN IP (example `192.168.1.50`).

3. Open in browser:

```text
http://192.168.1.50:3000
```

4. Click **Host**.
   - Optional: enter a room code in the "Room code" box before pressing Host.
   - If left empty, server generates `ROOM-###`.

5. Go through setup and click **Start Dungeon Run**.

6. Share with guests:
   - host URL (e.g. `http://192.168.1.50:3000`)
   - room code (shown in host HUD after join)

### Guest on LAN

1. Open host URL in browser:

```text
http://192.168.1.50:3000
```

2. Enter the host room code in **Room code** input.
3. Click **Join**.
4. Complete setup and click **Start Dungeon Run**.

---

## 7) Host multiplayer on the public internet (basic)

> Basic direct-port-forward flow (no auth/proxy hardening).

### On host machine

1. Start server:

```bash
HOST=0.0.0.0 PORT=3000 WS_PATH=/ws npm start
```

2. Router/NAT: forward TCP `3000` to host machine.
3. Firewall: allow inbound TCP `3000`.
4. Share your public URL, e.g.:

```text
http://<your-public-ip>:3000
```

### Optional domain / reverse proxy

If served behind a domain/proxy, set public base URL so client constructs WS URL correctly:

```bash
HOST=0.0.0.0 PORT=3000 WS_PATH=/ws PUBLIC_BASE_URL=https://play.example.com npm start
```

### Public guest

1. Open host public URL (IP or domain).
2. Enter room code.
3. Click **Join**.
4. Setup + Start.

---

## 8) Lobby / room-code flow (actual behavior in code)

- Connection mode is sent on websocket open as one of: `solo`, `host`, `join`.
- Server behavior:
  - `solo` -> always generates `SOLO-<random>`
  - `host`/`join` -> uses provided `code` if present; otherwise generates `ROOM-<random>`
- Server responds with `{"type":"joined","code":"..."}` and client stores this as current room code.
- Room code appears in HUD minimap line as `Lobby <code>` after connected.

Important UI detail:
- The room-code input is on the first screen. For **Join**, enter code before pressing **Join**.

---

## 9) Quick host+guest verification checklist

### Host checks

1. API reachable:

```bash
curl http://localhost:3000/api/content
curl http://localhost:3000/api/runtime
```

2. Confirm `/api/runtime` shows expected `wsPath`, `host`, `port`.
3. Open game and start a hosted room.

### Guest checks

1. Open same host URL.
2. Enter room code and join.
3. After both are in-run, verify party list shows 2 players.
4. Move one player and verify remote movement updates.

---

## 10) Troubleshooting

### "EADDRINUSE" / "address already in use"

Another process is already using the port.

- Use different port:

```bash
PORT=3010 npm run dev
```

- Or stop old process (Linux/macOS):

```bash
lsof -i :3000
kill <pid>
```

### Guests cannot connect on LAN/public

- Ensure host started with `HOST=0.0.0.0`.
- Verify firewall/router allow TCP port (default 3000).
- Confirm guests use correct host URL + port.

### WebSocket connection fails

- Verify `WS_PATH` matches on both sides (client reads from `/api/runtime`).
- Check browser console/network for failed `ws://.../ws` handshake.
- If HTTPS domain is used, websocket must be `wss://` reachable.

### Mixed-version mismatch (host and guest behavior differs)

- Ask all players to hard refresh (`Ctrl+F5` / clear cache).
- Restart host server after pulling latest changes.

### Reading server logs

- Startup log prints bind host/port and WS path.
- Keep terminal open while hosting to observe runtime errors.

---

## 11) Controls (current)

- Move: `W A S D`
- Verbs: `1..8`
- Djinn technique: `Q`
- Summon: `E`
- Contribute objective: `F`
- Demo confirm prompt: `Y`
- Pause menu: `Esc`

---

## 12) Developer notes

- Dev command and start command are equivalent right now.
- Core runtime files:
  - `server.js` (Express + WS authoritative state)
  - `public/app.js` (UI flow, render loop, websocket client)
  - `data/content.json`, `data/dungeons.json` (content definitions)
