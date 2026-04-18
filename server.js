// server.js - Secure version with image & voice support + reconnect safe

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);

app.use(helmet({ contentSecurityPolicy: false }));

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { msg: 'Too many requests, please slow down' }
});
app.use(limiter);

app.use(express.static('public'));
app.use('/uploads', express.static('public/uploads'));

const uploadDir = path.join(__dirname, 'public/uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    const uniqueName =
      Date.now() + '-' + Math.random().toString(36).substring(2) + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});

const fileFilter = (req, file, cb) => {
  const allowed = /jpeg|jpg|png|gif|webp|mp3|wav|ogg/;
  if (
    allowed.test(file.mimetype) &&
    allowed.test(path.extname(file.originalname).toLowerCase())
  ) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type'));
  }
};

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter
});

const io = new Server(server, {
  cors: { origin: "*" },
  maxHttpBufferSize: 1e7
});

const activeRooms = {};
const deletedRoomIds = new Set();

function generateRoomId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  return Array.from({ length: 8 }, () =>
    chars[Math.floor(Math.random() * chars.length)]
  ).join('');
}

// Upload route
app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ msg: 'No file uploaded' });

  const fileUrl = `/uploads/${req.file.filename}`;
  res.json({
    success: true,
    url: fileUrl,
    type: req.file.mimetype.startsWith('image') ? 'image' : 'audio'
  });
});

// SOCKET.IO
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on('create-room', ({ nickname }) => {
    if (!nickname || nickname.length > 20)
      return socket.emit('room-error', { msg: 'Invalid nickname' });

    let roomId;
    do {
      roomId = generateRoomId();
    } while (activeRooms[roomId] || deletedRoomIds.has(roomId));

    activeRooms[roomId] = {
      users: [],
      messages: [],
      disconnectTimer: null
    };

    handleJoin(socket, roomId, nickname);
  });

  socket.on('join-room', ({ roomId, nickname }) => {
    roomId = roomId.toUpperCase();

    if (!nickname || nickname.length > 20)
      return socket.emit('room-error', { msg: 'Invalid nickname' });

    if (deletedRoomIds.has(roomId))
      return socket.emit('room-error', { msg: 'Room Closed' });

    if (!activeRooms[roomId])
      return socket.emit('room-error', { msg: 'Room does not exist' });

    // 🔥 reconnect → cancel delete timer
    if (activeRooms[roomId].disconnectTimer) {
      clearTimeout(activeRooms[roomId].disconnectTimer);
      activeRooms[roomId].disconnectTimer = null;
    }

    handleJoin(socket, roomId, nickname);
  });

  socket.on('send-message', ({ text, fileUrl, fileType }) => {
    const roomId = socket.roomId;
    if (!roomId || !activeRooms[roomId]) return;

    const room = activeRooms[roomId];
    const sender = room.users.find(u => u.socketId === socket.id);
    if (!sender) return;

    const safeText = text ? text.replace(/<[^>]+>/g, '').trim() : '';

    const message = {
      sender: sender.nickname,
      ip: sender.ip,
      text: safeText || null,
      fileUrl: fileUrl || null,
      fileType: fileType || null,
      time: new Date().toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit'
      })
    };

    room.messages.push(message);
    io.to(roomId).emit('receive-message', message);
  });

  // 🔥 MAIN LOGIC (10 sec reconnect safe)
  socket.on('disconnect', () => {
    const roomId = socket.roomId;
    if (!roomId || !activeRooms[roomId]) return;

    const room = activeRooms[roomId];

    // remove user
    room.users = room.users.filter(u => u.socketId !== socket.id);

    // clear old timer
    if (room.disconnectTimer) clearTimeout(room.disconnectTimer);

    // wait 10 sec before deleting
    room.disconnectTimer = setTimeout(() => {
      if (!activeRooms[roomId]) return;

      io.to(roomId).emit('room-closed', {
        reason: 'User disconnected. Room closed after 10 seconds.'
      });

      delete activeRooms[roomId];
      deletedRoomIds.add(roomId);

      console.log(`Room ${roomId} deleted after 10s`);
    }, 10000);

    console.log(`User disconnected, waiting 10s for reconnect (${roomId})`);
  });
});

// JOIN HANDLER
function handleJoin(socket, roomId, nickname) {
  const ip = socket.handshake.address || 'Unknown';
  const room = activeRooms[roomId];

  if (room.users.length >= 2)
    return socket.emit('room-error', { msg: 'Room is full (max 2 users)' });

  const user = { socketId: socket.id, ip, nickname };
  room.users.push(user);

  socket.roomId = roomId;
  socket.join(roomId);

  socket.emit('room-joined', {
    roomId,
    myNickname: nickname,
    myIP: ip,
    users: room.users,
    messages: room.messages
  });

  if (room.users.length > 1) {
    socket.to(roomId).emit('user-joined', {
      nickname,
      ip,
      users: room.users
    });
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server running on port ${PORT}`);
});
