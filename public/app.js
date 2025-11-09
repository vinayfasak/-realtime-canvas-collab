const socket = io();

const canvas = document.getElementById('canvas');
const stage = document.querySelector('.stage');
const ctx = canvas.getContext('2d');

const toolBrush = document.getElementById('tool-brush');
const toolEraser = document.getElementById('tool-eraser');
const colorInput = document.getElementById('color');
const widthInput = document.getElementById('width');
const undoBtn = document.getElementById('undo');
const redoBtn = document.getElementById('redo');
const usersList = document.getElementById('users');
const usernameInput = document.getElementById('username');

let tool = 'brush';
let isDrawing = false;
let currentStroke = null; 
let history = []; 
let redoStack = [];
let self = null;
const cursors = new Map(); 

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const rect = stage.getBoundingClientRect();
  canvas.width = Math.floor(rect.width * dpr);
  canvas.height = Math.floor(rect.height * dpr);
  canvas.style.width = rect.width + 'px';
  canvas.style.height = rect.height + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  renderAll();
}
window.addEventListener('resize', resizeCanvas);

function getPos(evt) {
  const rect = canvas.getBoundingClientRect();
  const x = (evt.clientX - rect.left);
  const y = (evt.clientY - rect.top);
  return { x, y, t: Date.now() };
}

function setActiveTool(next) {
  tool = next;
  toolBrush.classList.toggle('active', tool === 'brush');
  toolEraser.classList.toggle('active', tool === 'eraser');
}

toolBrush.addEventListener('click', () => setActiveTool('brush'));
toolEraser.addEventListener('click', () => setActiveTool('eraser'));

usernameInput.addEventListener('change', () => {
  const v = usernameInput.value.trim();
  socket.emit('user:rename', v);
});

function beginStroke(pt) {
  const id = `${self?.id || 'local'}-${Date.now()}`;
  const stroke = {
    id,
    color: colorInput.value,
    width: Number(widthInput.value),
    mode: tool === 'eraser' ? 'erase' : 'draw',
    points: [pt]
  };
  currentStroke = stroke;
  socket.emit('stroke:start', { id: stroke.id, color: stroke.color, width: stroke.width, mode: stroke.mode });
}

function addPoint(pt) {
  if (!currentStroke) return;
  currentStroke.points.push(pt);
  socket.emit('stroke:point', pt);
  drawSegment(currentStroke, currentStroke.points.length - 2);
}

function endStroke() {
  if (!currentStroke) return;
  
  history.push({ ...currentStroke });
  redoStack.length = 0;
  renderAll();
  socket.emit('stroke:end');
  currentStroke = null;
}

function drawSegment(stroke, idxStart) {
  const pts = stroke.points;
  if (pts.length < 2) return;
  const a = pts[Math.max(0, idxStart)];
  const b = pts[pts.length - 1];
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = stroke.width;
  if (stroke.mode === 'erase') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = 'rgba(0,0,0,1)';
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = stroke.color;
  }
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.restore();
}

function drawStroke(stroke) {
  if (!stroke || stroke.points.length === 0) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = stroke.width;
  if (stroke.mode === 'erase') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = 'rgba(0,0,0,1)';
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.strokeStyle = stroke.color;
  }
  ctx.beginPath();
  const pts = stroke.points;
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    ctx.lineTo(pts[i].x, pts[i].y);
  }
  ctx.stroke();
  ctx.restore();
}

function renderAll() {
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
 
  for (const s of history) drawStroke(s);

  if (currentStroke) drawStroke(currentStroke);
}


canvas.addEventListener('mousedown', (e) => {
  isDrawing = true;
  const pt = getPos(e);
  beginStroke(pt);
});
canvas.addEventListener('mousemove', (e) => {
  const pt = getPos(e);
  socket.emit('cursor:move', { x: pt.x, y: pt.y });
  if (!isDrawing) return;
  addPoint(pt);
});
window.addEventListener('mouseup', () => {
  if (!isDrawing) return;
  isDrawing = false;
  endStroke();
});

// Touch support
canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  isDrawing = true;
  const t = e.touches[0];
  beginStroke(getPos(t));
}, { passive: false });
canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  const t = e.touches[0];
  const pt = getPos(t);
  socket.emit('cursor:move', { x: pt.x, y: pt.y });
  if (!isDrawing) return;
  addPoint(pt);
}, { passive: false });
window.addEventListener('touchend', () => {
  if (!isDrawing) return;
  isDrawing = false;
  endStroke();
}, { passive: false });

// Undo/Redo
function doUndo() { socket.emit('history:undo'); }
function doRedo() { socket.emit('history:redo'); }
undoBtn.addEventListener('click', doUndo);
redoBtn.addEventListener('click', doRedo);
window.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    if (e.shiftKey) doRedo(); else doUndo();
    e.preventDefault();
  } else if (e.key.toLowerCase() === 'b') setActiveTool('brush');
  else if (e.key.toLowerCase() === 'e') setActiveTool('eraser');
});


function ensureCursorEl(user) {
  let entry = cursors.get(user.id);
  if (!entry) {
    const el = document.createElement('div');
    el.className = 'remote-cursor';
    el.innerHTML = `<div class="cursor-dot"></div><div class="label"></div>`;
    el.style.display = 'none';
    stage.appendChild(el);
    cursors.set(user.id, { el, user });
    entry = cursors.get(user.id);
  }
  const dot = entry.el.querySelector('.cursor-dot');
  const label = entry.el.querySelector('.label');
  dot.style.background = user.color;
  label.style.background = user.color;
  label.textContent = user.name || user.id.slice(0,4);
  return entry.el;
}

function updateCursor(userId, x, y) {
  const user = onlineUsers.find(u => u.id === userId);
  if (!user) return;
  const el = ensureCursorEl(user);
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  el.style.display = 'flex';
}

function removeCursor(userId) {
  const entry = cursors.get(userId);
  if (entry) {
    entry.el.remove();
    cursors.delete(userId);
  }
}


let onlineUsers = [];
function renderUsers() {
  usersList.innerHTML = '';
  for (const u of onlineUsers) {
    const li = document.createElement('li');
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = u.color;
    const name = document.createElement('span');
    name.textContent = u.name;
    li.appendChild(dot);
    li.appendChild(name);
    usersList.appendChild(li);
  }
}


socket.on('init', (payload) => {
  self = payload.self;
  usernameInput.value = self.name;
  onlineUsers = payload.users;
  history = payload.history || [];
  redoStack = payload.redo || [];
  renderUsers();
  resizeCanvas();
  // Seed remote cursors
  if (payload.cursors) {
    for (const [id, pos] of Object.entries(payload.cursors)) {
      if (id === self.id) continue;
      updateCursor(id, pos.x, pos.y);
    }
  }
});

socket.on('users:update', (list) => {
  onlineUsers = list;
  renderUsers();
});

socket.on('cursor:move', ({ id, x, y }) => {
  if (id === self.id) return;
  updateCursor(id, x, y);
});

socket.on('cursor:remove', ({ id }) => {
  removeCursor(id);
});

socket.on('stroke:start', ({ userId, id, color, width, mode }) => {
  
  let s = { id, color, width, mode, points: [] };
  s._userId = userId;

  liveRemote.set(userId, s);
});

socket.on('stroke:point', ({ userId, id, point }) => {
  const s = liveRemote.get(userId);
  if (!s || s.id !== id) return;
  const prevLen = s.points.length;
  s.points.push(point);
  if (prevLen >= 1) {

    drawSegment(s, prevLen - 1);
  } else {

  }
});

socket.on('stroke:commit', ({ userId, stroke }) => {
  liveRemote.delete(userId);
  history.push(stroke);
  redoStack.length = 0;
  renderAll();
});

socket.on('history:undo', () => {
  
  history.pop();
  renderAll();
});

socket.on('history:redo', () => {
  
});

socket.on('history:state', (state) => {
  history = state.history || [];
  redoStack = state.redo || [];
  renderAll();
});

const liveRemote = new Map(); 

requestAnimationFrame(resizeCanvas);
