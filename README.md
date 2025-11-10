# Realtime Collaborative Canvas

A multi-user drawing application where multiple people draw simultaneously on the same canvas with real-time synchronization.

## Features

- Brush and eraser tools
- Color picker and stroke width adjustment
- Live multi-user cursors
- Real-time drawing (points streamed while drawing)
- Global Undo/Redo across all users
- Online users list with assigned colors
- Persistence and recovery via SQLite op-log
- Performance mode toggle for low-end devices

## Tech Stack

- Frontend: Vanilla JavaScript + HTML5 Canvas + Socket.IO client
- Backend: Node.js (Express + Socket.IO)
- Storage: SQLite (append-only op log)

## Quick Start

1. Install dependencies
   - Ensure Node.js >= 18
   - From project root:
     ```bash
     npm install
     ```
2. Run the server (single process, recommended for dev)
   ```bash
   node index.js
   ```
3. Open two tabs at:
   - http://localhost:3000
4. Draw in one tab and observe the other tab update in near real-time.

### Notes
- The server runs in single-process mode by default. To enable clustering (advanced usage), set `CLUSTER=1` in the environment, but prefer single-process during development.
- If port 3000 is busy, free it or set `PORT=<another>` before running.

## Scripts

There are no npm scripts added; run directly with Node:
```bash
node index.js
```

## Architecture Overview

- Browser tabs connect to the Socket.IO server over WebSocket.
- Clients emit drawing events while drawing:
  - `beginStroke` with stroke metadata (`strokeId`, `color`, `width`, `eraser`)
  - `points` with batched `{x,y}` samples per animation frame
  - `endStroke` with the full stroke payload
- Server broadcasts these events to all other clients immediately. `endStroke` is persisted asynchronously to SQLite in the `ops` table.
- Global Undo/Redo is implemented by appending `remove`/`restore` ops in SQLite and broadcasting `strokeRemoved`/`strokeRestored`.
- On reconnect/first connect, the server replays state by sending all strokes and a visibility map reconstructed from the op log.

## Event Protocol

Client → Server
- `beginStroke` (meta)
  - `{ strokeId, color, width, eraser }`
- `points` (batched live points)
  - `{ strokeId, pts: [{ x, y }, ...] }`
- `endStroke` (final stroke)
  - `{ strokeId, color, width, eraser, points: [{ x, y }, ...] }`
- `cursor` (throttled, volatile; hidden when off)
  - `{ x, y }` or `{ off: true }`
- `undo`
- `redo`

Server → Clients
- `init`
  - `{ strokes, visibility, users }`
- `presence:join`
  - `{ id, name, color }`
- `presence:leave`
  - `{ userId }`
- `beginStroke` (meta + `userId`)
- `points` (batched live points + `userId`)
- `endStroke` (final stroke + `userId`)
- `cursor` (with `userId`)
- `strokeRemoved` / `strokeRestored`
  - `{ strokeId, userId }`

## Persistence Model (SQLite)

Database file: `chat.db`

Table: `ops`
- `id INTEGER PRIMARY KEY AUTOINCREMENT`
- `type TEXT NOT NULL` — one of `stroke`, `remove`, `restore`
- `payload TEXT NOT NULL` — JSON payload (for `stroke`, full stroke object; for `remove`/`restore`, `{ strokeId }`)
- `ts INTEGER` — created-at (seconds)

Reconstruction:
- On startup/connection, the server queries all `ops` by `id ASC` and builds:
  - The list of strokes from `type='stroke'`
  - A visibility map with `remove`/`restore` applied in order

## Performance

- WebSocket transport forced on client.
- Compression disabled on server for drawing events: `perMessageDeflate=false`, `httpCompression=false`.
- High-frequency events (`cursor`, single `point`) are volatile: OK to drop frames under load.
- Batched `points` events are non-volatile (reliable) for stroke integrity.
- Client-side optimizations:
  - Outgoing point batching per rAF; immediate first point on `pointerdown`
  - Distance-based point deduplication (fewer segments)
  - Remote points are queued and rendered once per rAF
  - Performance toggle lowers DPR and increases spacing/batch thresholds

## Troubleshooting

- Only cursors show, but no drawing appears on the other tab
  - Ensure you run a single server process (do not export `CLUSTER=1` during dev)
  - Restart the server and hard-reload both tabs
  - Both tabs must be at `http://localhost:3000`
- Port already in use (`EADDRINUSE: 3000`)
  - Stop other servers using 3000, or run with `PORT=4100 node index.js` and open `http://localhost:4100`
- High latency or stutter
  - Enable the **Performance** checkbox in the toolbar
  - Reduce stroke width
  - Close other heavy tabs/apps

## Security & Privacy

- No authentication included; all connected clients share the same board.
- Do not expose this instance publicly without adding authentication/authorization/rate limiting.

## Extensibility Ideas

- Rooms/boards with IDs and history
- Select/move/resize shapes (vector layer)
- Export/import drawings
- Auth and user profiles
- CRDT-based model for conflict-free editing
