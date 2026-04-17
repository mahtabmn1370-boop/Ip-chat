// public/script.js - Full logic for IP Chat Name
let socket;
let currentRoomId = null;
let myNickname = '';
let participants = [];
let messages = [];
let isGroup = false;
let mediaRecorder = null;
let audioChunks = [];
let typingTimeout = null;

// Initialize Socket.IO
document.addEventListener('DOMContentLoaded', () => {
    socket = io();

    setupSocketListeners();

    // Check for direct room link
    const params = new URLSearchParams(window.location.search);
    if (params.has('room')) {
        currentRoomId = params.get('room').toUpperCase();
        showJoinModal();
    }
});

function setupSocketListeners() {
    socket.on('room-joined', (data) => {
        currentRoomId = data.roomId;
        myNickname = data.myNickname;
        participants = data.users;
        messages = data.messages || [];
        isGroup = data.isGroup || false;

        history.pushState({}, '', `?room=${currentRoomId}`);
        switchToChatView();
        renderParticipants();
        renderMessages();
        showToast('✅ Joined the room!', 2000);
    });

    socket.on('user-joined', (data) => {
        participants = data.users;
        renderParticipants();
        showToast(`${data.nickname} joined the room`);
    });

    socket.on('user-left', (data) => {
        participants = data.users;
        renderParticipants();
        showToast('A user left the room');
    });

    socket.on('receive-message', (msg) => {
        messages.push(msg);
        renderMessages();
        const container = document.getElementById('chat-messages');
        container.scrollTop = container.scrollHeight;

        // Mark as seen if not my message
        if (msg.sender !== myNickname) {
            socket.emit('message-seen', msg.id);
        }
    });

    socket.on('message-status-update', (data) => {
        renderMessages(); // Refresh to show seen status
    });

    socket.on('typing-update', (data) => {
        const indicator = document.getElementById('typing-indicator');
        if (data.typingNames && data.typingNames.length > 0) {
            indicator.textContent = data.typingNames.length === 1 
                ? `${data.typingNames[0]} is typing...` 
                : 'Multiple people are typing...';
            indicator.style.display = 'block';
        } else {
            indicator.style.display = 'none';
        }
    });

    socket.on('room-closed', (data) => {
        showClosedModal(data.reason || 'Room has been permanently closed.');
    });

    socket.on('room-error', (data) => {
        showToast(`❌ ${data.msg}`, 4000);
    });
}

// Create Room
function createRoom(group) {
    const nickname = document.getElementById('nickname-input').value.trim();
    if (!nickname) return showToast('Please enter your nickname');

    const expirySelect = document.getElementById('expiry-time');
    const expiresInMinutes = parseInt(expirySelect.value);

    socket.emit('create-room', {
        nickname,
        isGroup: group,
        expiresInMinutes
    });
}

// Join from home
function joinRoomFromHome() {
    const roomId = document.getElementById('room-code-input').value.trim().toUpperCase();
    const nickname = document.getElementById('nickname-input').value.trim();
    if (!roomId) return showToast('Enter Room ID');
    if (!nickname) return showToast('Enter your nickname');

    currentRoomId = roomId;
    socket.emit('join-room', { roomId, nickname });
}

// Join Modal
function showJoinModal() {
    document.getElementById('modal-room-id').textContent = currentRoomId;
    document.getElementById('join-modal').classList.remove('hidden');
    document.getElementById('modal-nickname').focus();
}

function confirmJoinFromModal() {
    const nickname = document.getElementById('modal-nickname').value.trim() || 'Anonymous';
    document.getElementById('join-modal').classList.add('hidden');
    socket.emit('join-room', { roomId: currentRoomId, nickname });
}

function cancelJoinModal() {
    document.getElementById('join-modal').classList.add('hidden');
}

// Switch to Chat View
function switchToChatView() {
    document.getElementById('home-view').classList.add('hidden');
    document.getElementById('chat-view').classList.remove('hidden');
    document.getElementById('header-room-info').classList.remove('hidden');
    document.getElementById('room-id-display').textContent = currentRoomId;
}

// Render Participants
function renderParticipants() {
    const container = document.getElementById('participants-list');
    container.innerHTML = '';
    document.getElementById('participant-count').textContent = `\( {participants.length} \){isGroup ? '+' : '/2'}`;

    participants.forEach(user => {
        const isMe = user.nickname === myNickname;
        const div = document.createElement('div');
        div.className = `participant ${isMe ? 'me' : ''}`;
        div.innerHTML = `
            <div class="participant-info">
                <div class="participant-name">${isMe ? '👤 You' : user.nickname}</div>
                <div class="participant-ip">IP: ${user.ip}</div>
            </div>
        `;
        container.appendChild(div);
    });
}

// Render Messages with Seen Status
function renderMessages() {
    const container = document.getElementById('chat-messages');
    if (messages.length === 0) return;

    container.innerHTML = '';

    messages.forEach(msg => {
        const isMine = msg.sender === myNickname;
        const div = document.createElement('div');
        div.className = `message ${isMine ? 'you' : 'other'}`;

        let html = `
            <div class="message-header">
                <span class="message-sender">${isMine ? 'You' : msg.sender}</span>
                <span class="message-time">${msg.time}</span>
            </div>
        `;

        if (msg.text) html += `<div class="message-text">${msg.text}</div>`;
        if (msg.fileUrl) {
            if (msg.fileType === 'image') {
                html += `<img src="${msg.fileUrl}" class="chat-image" alt="Image">`;
            } else {
                html += `<audio controls src="${msg.fileUrl}" class="chat-audio"></audio>`;
            }
        }

        if (isMine) {
            html += `<div class="status">${msg.seen ? '✔✔ Seen' : '✔ Delivered'}</div>`;
        }

        div.innerHTML = html;
        container.appendChild(div);
    });

    container.scrollTop = container.scrollHeight;
}

// Send Text Message
function sendMessage(e) {
    e.preventDefault();
    const input = document.getElementById('message-input');
    const text = input.value.trim();
    if (!text) return;

    socket.emit('send-message', { text });
    input.value = '';
}

// Typing Indicator
function handleTyping() {
    if (!currentRoomId) return;
    socket.emit('typing', true);

    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        socket.emit('typing', false);
    }, 1500);
}

// File Upload
function triggerImageUpload() {
    document.getElementById('file-upload').click();
}

function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    fetch('/upload', {
        method: 'POST',
        body: formData
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            socket.emit('send-message', {
                text: '',
                fileUrl: data.url,
                fileType: data.type
            });
        }
    })
    .catch(() => showToast('Upload failed'));
}

// Voice Recording
async function startVoiceRecording() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream);
        audioChunks = [];

        mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
        mediaRecorder.onstop = () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/ogg' });
            const formData = new FormData();
            formData.append('file', audioBlob, 'voice.ogg');

            fetch('/upload', { method: 'POST', body: formData })
                .then(res => res.json())
                .then(data => {
                    if (data.success) {
                        socket.emit('send-message', {
                            text: '',
                            fileUrl: data.url,
                            fileType: 'audio'
                        });
                    }
                });
            stream.getTracks().forEach(track => track.stop());
        };

        mediaRecorder.start();
        showToast('🎤 Recording... Tap again to stop', 15000);
    } catch (err) {
        showToast('Microphone access denied');
    }
}

// Exit Room
function exitRoom() {
    if (confirm('Exit room? This will permanently close the room if you are the last user.')) {
        socket.emit('exit-room');
        goBackToHome();
    }
}

// Copy Room Link
function copyRoomLink() {
    const link = `\( {window.location.origin}?room= \){currentRoomId}`;
    navigator.clipboard.writeText(link).then(() => {
        showToast('✅ Link copied to clipboard!');
    });
}

// Theme Toggle
function toggleTheme() {
    const body = document.body;
    const currentTheme = body.getAttribute('data-theme');
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    body.setAttribute('data-theme', newTheme);
    
    const toggleBtn = document.getElementById('theme-toggle');
    toggleBtn.textContent = newTheme === 'dark' ? '🌙' : '☀️';
}

// Modals & Toast
function showClosedModal(reason) {
    document.getElementById('closed-reason').innerHTML = reason || 'Room has been permanently closed.';
    document.getElementById('closed-modal').classList.remove('hidden');
}

function goBackToHome() {
    document.getElementById('closed-modal').classList.add('hidden');
    document.getElementById('chat-view').classList.add('hidden');
    document.getElementById('home-view').classList.remove('hidden');
    document.getElementById('header-room-info').classList.add('hidden');
    
    currentRoomId = null;
    participants = [];
    messages = [];
}

function showToast(msg, timeout = 3000) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), timeout);
}

// Auto scroll on new messages
const chatContainer = document.getElementById('chat-messages');
if (chatContainer) {
    chatContainer.addEventListener('scroll', () => {
        // Optional: auto-mark as seen when scrolling to bottom
    });
    }
