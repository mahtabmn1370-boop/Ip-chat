// server.js - Secure version with image & voice support
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

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false // Adjust if needed for your UI
}));

// Rate limiting (prevents spam)
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30, // max 30 requests per minute per IP
  message: { msg: 'Too many requests, please slow down' }
});
app.use(limiter);

// Serve static files
app.use(express.static('public'));
app.use('/uploads', express.static('public/uploads')); // Serve uploaded files

// Create uploads folder if not exists
const uploadDir = path.join(__dirname, 'public/uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer config - Secure file upload
const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
    cb(null, uniqueName);
  }
});

const fileFilter = (req, file, cb) => {
  const allowedTypes = /jpeg|jpg|png|gif|webp|mp3|wav|ogg/;
  const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = allowedTypes.test(file.mimetype);
  if (extname && mimetype) {
    return cb(null, true);
  }
  cb(new Error('Only images (jpg,png,gif,webp) and audio (mp3,wav,ogg) allowed'));
};

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
  fileFilter: fileFilter
});

// Socket.IO with higher buffer for safety (but we avoid sending large files via socket)
const io = new Server(server, {
  cors: { origin: "*" },
  maxHttpBufferSize: 1e7 // 10MB
});

// In-memory storage
const activeRooms = {};
const deletedRoomIds = new Set();

function generateRoomId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < 8; i++) result += chars[Math.floor(Math.random() * chars.length)];
  return result;
}

// File upload route (HTTP, not Socket)
app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ msg: 'No file uploaded' });
  
  const fileUrl = `/uploads/${req.file.filename}`;
  res.json({ success: true, url: fileUrl, type: req.file.mimetype.startsWith('image') ? 'image' : 'audio' });
});

// Socket events (same as before + security)
io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on('create-room', ({ nickname }) => {
    if (!nickname || nickname.length > 20) return socket.emit('room-error', { msg: 'Invalid nickname' });
    let roomId;
    do { roomId = generateRoomId(); } while (activeRooms[roomId] || deletedRoomIds.has(roomId));
    activeRooms[roomId] = { users: [], messages: [] };
    handleJoin(socket, roomId, nickname);
  });

  socket.on('join-room', ({ roomId, nickname }) => {
    roomId = roomId.toUpperCase();
    if (!nickname || nickname.length > 20) return socket.emit('room-error', { msg: 'Invalid nickname' });
    if (deletedRoomIds.has(roomId)) return socket.emit('room-error', { msg: 'Room Closed - Cannot be reused' });
    if (!activeRooms[roomId]) return socket.emit('room-error', { msg: 'Room does not exist' });
    handleJoin(socket, roomId, nickname);
  });

  socket.on('send-message', ({ text, fileUrl, fileType }) => {
    const roomId = socket.roomId;
    if (!roomId || !activeRooms[roomId]) return;

    const room = activeRooms[roomId];
    const sender = room.users.find(u => u.socketId === socket.id);
    if (!sender) return;

    // Sanitize text
    const safeText = text ? text.replace(/<[^>]+>/g, '').trim() : '';

    const message = {
      sender: sender.nickname,
      ip: sender.ip,
      text: safeText || null,
      fileUrl: fileUrl || null,
      fileType: fileType || null,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    room.messages.push(message);
    io.to(roomId).emit('receive-message', message);
  });

  socket.on('disconnect', () => {
    const roomId = socket.roomId;
    if (!roomId || !activeRooms[roomId]) return;

    const room = activeRooms[roomId];
    room.users = room.users.filter(u => u.socketId !== socket.id);

    if (room.users.length > 0) {
      io.to(roomId).emit('room-closed', { reason: 'The other participant left.<br>Room permanently deleted.' });
    }

    delete activeRooms[roomId];
    deletedRoomIds.add(roomId);
    console.log(`Room ${roomId} permanently deleted`);
  });
});

function handleJoin(socket, roomId, nickname) {
  const ip = socket.handshake.address || 'Unknown';
  const room = activeRooms[roomId];

  if (room.users.length >= 2) return socket.emit('room-error', { msg: 'Room is full (max 2 users)' });

  const user = { socketId: socket.id, ip, nickname };
  room.users.push(user);
  socket.roomId = roomId;
  socket.join(roomId);

  socket.emit('room-joined', {
    roomId, myNickname: nickname, myIP: ip, users: room.users, messages: room.messages
  });

  if (room.users.length > 1) {
    socket.to(roomId).emit('user-joined', { nickname, ip, users: room.users });
  }
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Secure IP Chat Name running on port ${PORT}`);
});
