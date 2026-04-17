// server.js - Final Version with Exit Button + Group + Expiry
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

const limiter = rateLimit({ windowMs: 60 * 1000, max: 40 });
app.use(limiter);

app.use(express.static('public'));
app.use('/uploads', express.static('public/uploads'));

const uploadDir = path.join(__dirname, 'public/uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname);
    cb(null, unique);
  }
});

const fileFilter = (req, file, cb) => {
  const allowed = /jpeg|jpg|png|gif|webp|mp3|wav|ogg/;
  if (allowed.test(path.extname(file.originalname).toLowerCase()) && allowed.test(file.mimetype)) {
    return cb(null, true);
  }
  cb(new Error('Only images and audio allowed'));
};

const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 }, fileFilter });

app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ msg: 'No file' });
  const fileUrl = `/uploads/${req.file.filename}`;
  const isImage = req.file.mimetype.startsWith('image');
  res.json({ success: true, url: fileUrl, type: isImage ? 'image' : 'audio' });
});

const io = new Server(server, { cors: { origin: "*" }, maxHttpBufferSize: 1e7 });

const activeRooms = {};
const deletedRoomIds = new Set();

function generateRoomId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = '';
  for (let i = 0; i < 8; i++) id += chars[Math.floor(Math.random() * chars.length)];
  return id;
}

function handleJoin(socket, roomId, nickname, isGroup) {
  const ip = socket.handshake.address || 'Unknown';
  if (!activeRooms[roomId]) {
    activeRooms[roomId] = { 
      users: [], 
      messages: [], 
      isGroup: isGroup,
      expiresAt: null 
    };
  }

  const room = activeRooms[roomId];
  if (!room.isGroup && room.users.length >= 2) {
    return socket.emit('room-error', { msg: 'Private room is full (max 2 users)' });
  }

  const user = { socketId: socket.id, ip, nickname };
  room.users.push(user);
  socket.roomId = roomId;
  socket.join(roomId);

  socket.emit('room-joined', {
    roomId,
    myNickname: nickname,
    myIP: ip,
    users: room.users,
    messages: room.messages,
    isGroup: room.isGroup,
    expiresAt: room.expiresAt
  });

  if (room.users.length > 1) {
    socket.to(roomId).emit('user-joined', { nickname, ip, users: room.users });
  }
}

function scheduleRoomDeletion(roomId, expiresInMinutes) {
  if (!expiresInMinutes) return;
  setTimeout(() => {
    if (activeRooms[roomId]) {
      io.to(roomId).emit('room-closed', { 
        reason: `Room expired after ${expiresInMinutes} minutes.` 
      });
      delete activeRooms[roomId];
      deletedRoomIds.add(roomId);
    }
  }, expiresInMinutes * 60 * 1000);
}

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on('create-room', ({ nickname, isGroup, expiresInMinutes }) => {
    if (!nickname || nickname.length > 20) return socket.emit('room-error', { msg: 'Invalid nickname' });

    let roomId;
    do { roomId = generateRoomId(); } while (activeRooms[roomId] || deletedRoomIds.has(roomId));

    activeRooms[roomId] = { users: [], messages: [], isGroup };

    if (expiresInMinutes && expiresInMinutes > 0) {
      activeRooms[roomId].expiresAt = Date.now() + expiresInMinutes * 60 * 1000;
      scheduleRoomDeletion(roomId, expiresInMinutes);
    }

    handleJoin(socket, roomId, nickname, isGroup);
  });

  socket.on('join-room', ({ roomId, nickname }) => {
    roomId = roomId.toUpperCase();
    if (deletedRoomIds.has(roomId)) return socket.emit('room-error', { msg: 'Room Closed' });
    if (!activeRooms[roomId]) return socket.emit('room-error', { msg: 'Room does not exist' });
    if (!activeRooms[roomId].isGroup && activeRooms[roomId].users.length >= 2) {
      return socket.emit('room-error', { msg: 'Private room full' });
    }
    handleJoin(socket, roomId, nickname, activeRooms[roomId].isGroup);
  });

  // NEW: User explicitly exits the room
  socket.on('exit-room', () => {
    const roomId = socket.roomId;
    if (!roomId || !activeRooms[roomId]) return;

    const room = activeRooms[roomId];
    room.users = room.users.filter(u => u.socketId !== socket.id);

    socket.leave(roomId);
    delete socket.roomId;

    // Notify others
    if (room.users.length > 0) {
      io.to(roomId).emit('user-left', { 
        users: room.users,
        message: 'A user has left the room.'
      });
    }

    // If no users left OR it's a private room, delete permanently
    if (room.users.length === 0 || !room.isGroup) {
      io.to(roomId).emit('room-closed', { 
        reason: 'Room has been closed permanently.' 
      });
      delete activeRooms[roomId];
      deletedRoomIds.add(roomId);
      console.log(`Room ${roomId} permanently deleted via Exit`);
    }
  });

  socket.on('send-message', ({ text, fileUrl, fileType }) => {
    const roomId = socket.roomId;
    if (!roomId || !activeRooms[roomId]) return;

    const room = activeRooms[roomId];
    const sender = room.users.find(u => u.socketId === socket.id);
    if (!sender) return;

    const safeText = text ? text.toString().replace(/<[^>]+>/g, '').trim().slice(0, 1000) : null;

    const message = {
      sender: sender.nickname,
      ip: sender.ip,
      text: safeText,
      fileUrl,
      fileType,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    room.messages.push(message);
    io.to(roomId).emit('receive-message', message);
  });

  // Disconnect no longer deletes room (only Exit button does)
  socket.on('disconnect', () => {
    // Do nothing - room stays open until Exit is clicked
    console.log(`User disconnected without exiting: ${socket.id}`);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ IP Chat Name running on port ${PORT}`);
  console.log(`   Exit button now controls room deletion`);
});
