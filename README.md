# Silver Moon (Prototype)

Web-based three.js + websocket prototype implementing a fixed-isometric co-op-first puzzle-dungeon run loop.

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:3000` in Chrome/Firefox.

## Included

- Menu flow: Play (solo/host/join) → dungeon select (8 unlocked) → loadout (8 avatars, djinn selection, keybind hint) → difficulty → start.
- In-run pause menu: resume / restart room / abandon run.
- Fixed isometric camera with authored zoom levels and room-to-room shifts only.
- Grid-snapped movement, grid target preview, deterministic server tick.
- 8 verbs, 32 djinn (4x8), 8 summons (2 per element), 8 characters with required element/weapon pairings.
- 8 dungeons and 8 bosses defined in data-driven JSON.
- Authoritative websocket server state, client prediction-friendly movement commands, disconnect ghost fallback.
- Debug overlay: room state, verb traces, replayable input log excerpt.

## Controls

- Move: `WASD`
- Verbs: `1..8`
- Use djinn technique: `Q`
- Summon: `E`
- Contribute objective: `F`
- Cycle camera zoom preset: `Z`
- Pause menu: `Esc`

