// server.js - IP Chat Name (Only Exit Button Deletes Room)
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Create uploads folder
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads'),
  filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// File Upload (Image / Audio / Video)
app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.json({ success: false });
  const type = req.file.mimetype.startsWith('image') ? 'image' :
               req.file.mimetype.startsWith('audio') ? 'audio' : 'video';
  res.json({ success: true, url: `/uploads/${req.file.filename}`, type });
});

let rooms = {};
let deletedRooms = new Set();

function generateRoomId() {
  let id;
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  do {
    id = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms[id] || deletedRooms.has(id));
  return id;
}

function deleteRoom(roomId) {
  if (rooms[roomId]) {
    io.to(roomId).emit('room-closed', { reason: 'Room has been permanently deleted.' });
    deletedRooms.add(roomId);
    delete rooms[roomId];
  }
}

io.on('connection', (socket) => {
  let currentRoomId = null;
  let myNickname = null;

  socket.on('create-room', ({ nickname, expiresInMinutes }) => {
    const roomId = generateRoomId();
    const ip = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;

    rooms[roomId] = {
      users: [{ nickname, ip, socketId: socket.id }],
      messages: [],
      expiresAt: expiresInMinutes ? Date.now() + expiresInMinutes * 60000 : null
    };

    currentRoomId = roomId;
    myNickname = nickname;
    socket.join(roomId);

    socket.emit('room-joined', {
      roomId,
      myNickname: nickname,
      users: rooms[roomId].users,
      messages: [],
      isGroup: false
    });

    if (rooms[roomId].expiresAt) {
      setTimeout(() => deleteRoom(roomId), rooms[roomId].expiresAt - Date.now());
    }
  });

  socket.on('join-room', ({ roomId, nickname }) => {
    roomId = roomId.toUpperCase();
    const ip = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;

    if (deletedRooms.has(roomId)) {
      socket.emit('room-closed', { reason: 'Room has been permanently deleted.' });
      return;
    }
    if (!rooms[roomId]) {
      socket.emit('room-error', { msg: 'Room not found' });
      return;
    }
    if (rooms[roomId].users.length >= 2) {
      socket.emit('room-error', { msg: 'Room is full (max 2 users)' });
      return;
    }

    rooms[roomId].users.push({ nickname, ip, socketId: socket.id });
    currentRoomId = roomId;
    myNickname = nickname;
    socket.join(roomId);

    io.to(roomId).emit('room-joined', {
      roomId,
      myNickname: nickname,
      users: rooms[roomId].users,
      messages: rooms[roomId].messages,
      isGroup: false
    });
  });

  socket.on('send-message', (data) => {
    if (!currentRoomId || !rooms[currentRoomId]) return;
    const msg = {
      sender: myNickname,
      text: data.text || '',
      fileUrl: data.fileUrl || null,
      fileType: data.fileType || null,
      ip: socket.handshake.headers['x-forwarded-for'] || socket.handshake.address,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
    rooms[currentRoomId].messages.push(msg);
    io.to(currentRoomId).emit('receive-message', msg);
  });

  // Typing Indicator
  socket.on('typing', () => {
    if (currentRoomId) socket.to(currentRoomId).emit('user-typing', { nickname: myNickname });
  });
  socket.on('stop-typing', () => {
    if (currentRoomId) socket.to(currentRoomId).emit('stop-typing');
  });

  // 🔥 ONLY Exit Button will delete the room
  socket.on('exit-room', () => {
    if (currentRoomId && rooms[currentRoomId]) {
      deleteRoom(currentRoomId);
    }
  });

  // Disconnect / Refresh / Tab Close → Room WILL NOT be deleted
  socket.on('disconnect', () => {
    if (currentRoomId && rooms[currentRoomId]) {
      rooms[currentRoomId].users = rooms[currentRoomId].users.filter(u => u.socketId !== socket.id);
      io.to(currentRoomId).emit('user-left', {
        users: rooms[currentRoomId].users,
        message: `${myNickname || 'Someone'} left temporarily`
      });
    }
  });
});

server.listen(3000, () => {
  console.log('🚀 IP Chat Name Server running on http://localhost:3000');
});
