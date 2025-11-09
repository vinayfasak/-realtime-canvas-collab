import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;

app.use(express.static('public'));

// In-memory state
const users = new Map(); // socketId -> { id, name, color }
const cursors = new Map(); // socketId -> { x, y }
const liveStrokes = new Map(); // socketId -> { id, color, width, mode, points: [] }
const history = []; // committed strokes
const redoStack = [];

function randomColor() {
  const colors = [
    '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#22d3ee', '#a3e635'
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

function broadcastUsers() {
  const list = Array.from(users.values()).map(u => ({ id: u.id, name: u.name, color: u.color }));
  io.emit('users:update', list);
}

function emitHistoryState() {
  io.emit('history:state', { history, redo: redoStack });
}

io.on('connection', socket => {
  const user = {
    id: socket.id,
    name: `User-${socket.id.slice(0, 4)}`,
    color: randomColor()
  };
  users.set(socket.id, user);

  socket.emit('init', {
    self: user,
    users: Array.from(users.values()),
    history,
    redo: redoStack,
    cursors: Object.fromEntries(cursors)
  });

  broadcastUsers();

  socket.on('user:rename', name => {
    const u = users.get(socket.id);
    if (!u) return;
    u.name = String(name || '').slice(0, 32) || u.name;
    broadcastUsers();
  });

  socket.on('cursor:move', pos => {
    const { x, y } = pos || {};
    if (typeof x !== 'number' || typeof y !== 'number') return;
    cursors.set(socket.id, { x, y });
    socket.broadcast.emit('cursor:move', { id: socket.id, x, y });
  });

  socket.on('stroke:start', payload => {
    const { id, color, width, mode } = payload || {};
    if (!id || typeof width !== 'number') return;
    const u = users.get(socket.id);
    liveStrokes.set(socket.id, { id, color: color || u?.color || '#000', width, mode: mode === 'erase' ? 'erase' : 'draw', points: [] });
    socket.broadcast.emit('stroke:start', { userId: socket.id, id, color: color || u?.color || '#000', width, mode: mode === 'erase' ? 'erase' : 'draw' });
  });

  socket.on('stroke:point', pt => {
    const s = liveStrokes.get(socket.id);
    if (!s) return;
    const { x, y, t } = pt || {};
    if (typeof x !== 'number' || typeof y !== 'number') return;
    const point = { x, y, t: typeof t === 'number' ? t : Date.now() };
    s.points.push(point);
    socket.broadcast.emit('stroke:point', { userId: socket.id, id: s.id, point });
  });

  socket.on('stroke:end', () => {
    const s = liveStrokes.get(socket.id);
    if (!s) return;
    liveStrokes.delete(socket.id);
    history.push({ ...s });
    redoStack.length = 0;
    io.emit('stroke:commit', { userId: socket.id, stroke: s });
    emitHistoryState();
  });

  socket.on('history:undo', () => {
    if (history.length === 0) return;
    const stroke = history.pop();
    redoStack.push(stroke);
    io.emit('history:undo');
    emitHistoryState();
  });

  socket.on('history:redo', () => {
    if (redoStack.length === 0) return;
    const stroke = redoStack.pop();
    history.push(stroke);
    io.emit('history:redo');
    emitHistoryState();
  });

  socket.on('disconnect', () => {
    users.delete(socket.id);
    cursors.delete(socket.id);
    liveStrokes.delete(socket.id);
    io.emit('cursor:remove', { id: socket.id });
    broadcastUsers();
  });
});

httpServer.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
