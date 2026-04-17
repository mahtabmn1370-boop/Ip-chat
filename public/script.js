// public/script.js - Final with Exit Button
let socket;
let currentRoomId = null;
let myNickname = '';
let participants = [];
let messages = [];
let isGroup = false;
let mediaRecorder = null;
let audioChunks = [];

document.addEventListener('DOMContentLoaded', () => {
    socket = io();
    setupSocketListeners();

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
        isGroup = data.isGroup;

        history.pushState({}, '', `?room=${currentRoomId}`);
        switchToChatView();
        renderParticipants();
        renderMessages();
    });

    socket.on('user-joined', (data) => {
        participants = data.users;
        renderParticipants();
    });

    socket.on('user-left', (data) => {
        participants = data.users;
        renderParticipants();
        showToast(data.message || 'Someone left the room');
    });

    socket.on('receive-message', (msg) => {
        messages.push(msg);
        renderMessages();
        document.getElementById('chat-messages').scrollTop = document.getElementById('chat-messages').scrollHeight;
    });

    socket.on('room-closed', (data) => {
        showClosedModal(data.reason);
    });

    socket.on('room-error', (data) => {
        showToast(`❌ ${data.msg}`);
    });
}

function createRoom(group) {
    const nickname = document.getElementById('nickname-input').value.trim();
    if (!nickname) return showToast('Please enter a nickname');

    const expirySelect = document.getElementById('expiry-time');
    const expiresInMinutes = parseInt(expirySelect.value);

    socket.emit('create-room', { 
        nickname, 
        isGroup: group, 
        expiresInMinutes 
    });
}

function joinRoomFromHome() {
    const roomId = document.getElementById('room-code-input').value.trim().toUpperCase();
    const nickname = document.getElementById('nickname-input').value.trim();
    if (!roomId) return showToast('Enter Room ID');
    if (!nickname) return showToast('Enter nickname');
    currentRoomId = roomId;
    socket.emit('join-room', { roomId, nickname });
}

function showJoinModal() {
    document.getElementById('modal-room-id').textContent = currentRoomId;
    document.getElementById('join-modal').classList.remove('hidden');
}

function confirmJoinFromModal() {
    const nickname = document.getElementById('modal-nickname').value.trim() || 'Anonymous';
    document.getElementById('join-modal').classList.add('hidden');
    socket.emit('join-room', { roomId: currentRoomId, nickname });
}

function cancelJoinModal() {
    document.getElementById('join-modal').classList.add('hidden');
}

function switchToChatView() {
    document.getElementById('home-view').classList.add('hidden');
    document.getElementById('chat-view').classList.remove('hidden');
    document.getElementById('header-room-info').classList.remove('hidden');
    document.getElementById('room-id-display').textContent = currentRoomId;
}

function renderParticipants() {
    const container = document.getElementById('participants-list');
    container.innerHTML = '';

    // ✅ FIXED COUNT DISPLAY
    document.getElementById('participant-count').textContent =
        `${participants.length}${isGroup ? '+' : '/2'}`;

    participants.forEach(user => {
        const isMe = user.nickname === myNickname;

        const div = document.createElement('div');
        div.className = `participant ${isMe ? 'me' : ''}`;

        div.innerHTML = `
            <div class="participant-info">
                <div class="participant-name">
                    ${isMe ? '👤 You' : user.nickname}
                </div>
                <div class="participant-ip">
                    IP: ${user.ip}
                </div>
            </div>
        `;

        container.appendChild(div);
    });
    }

function renderMessages() {
    const container = document.getElementById('chat-messages');
    const empty = document.getElementById('empty-chat');
    if (messages.length > 0) empty.style.display = 'none';

    container.querySelectorAll('.message').forEach(el => el.remove());

    messages.forEach(msg => {
        const isMine = msg.sender === myNickname;
        const div = document.createElement('div');
        div.className = `message ${isMine ? 'you' : 'other'}`;

        let content = `<div class="message-header">
            <span class="message-sender">${isMine ? 'You' : msg.sender}</span>
            <span class="message-ip">• ${msg.ip}</span>
            <span class="message-time">${msg.time}</span>
        </div>`;

        if (msg.text) content += `<div>${msg.text}</div>`;
        if (msg.fileUrl) {
            if (msg.fileType === 'image') {
                content += `<img src="${msg.fileUrl}" class="chat-image">`;
            } else {
                content += `<audio controls src="${msg.fileUrl}" class="chat-audio"></audio>`;
            }
        }
        div.innerHTML = content;
        container.appendChild(div);
    });

    container.scrollTop = container.scrollHeight;
}

function sendMessage(e) {
    e.preventDefault();
    const input = document.getElementById('message-input');
    const text = input.value.trim();
    if (text) {
        socket.emit('send-message', { text });
        input.value = '';
    }
}

function triggerImageUpload() {
    document.getElementById('file-upload').click();
}

function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    fetch('/upload', { method: 'POST', body: formData })
        .then(res => res.json())
        .then(data => {
            if (data.success) {
                socket.emit('send-message', { text: '', fileUrl: data.url, fileType: data.type });
            }
        });
}

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
                    if (data.success) socket.emit('send-message', { text: '', fileUrl: data.url, fileType: 'audio' });
                });
            stream.getTracks().forEach(track => track.stop());
        };

        mediaRecorder.start();
        showToast('🎤 Recording... Click again to stop', 15000);
    } catch (err) {
        showToast('Microphone access denied');
    }
}

function exitRoom() {
    if (confirm("Are you sure you want to exit? The room will be permanently deleted if you're the last user.")) {
        socket.emit('exit-room');
        goBackToHome();
    }
}

function copyRoomLink() {
    // check room exists
    if (!currentRoomId) {
        return showToast('❌ No room to share');
    }

    // correct template string
    const link = `${window.location.origin}?room=${currentRoomId}`;

    // copy to clipboard
    navigator.clipboard.writeText(link)
        .then(() => {
            showToast('✅ Link copied!');
        })
        .catch(() => {
            showToast('❌ Failed to copy link');
        });
}


function showClosedModal(reason) {
    document.getElementById('closed-reason').innerHTML = reason || 'Room has been permanently deleted.';
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
