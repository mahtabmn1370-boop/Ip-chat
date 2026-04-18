// public/script.js - Complete with typing, theme toggle, Android fit
let socket, currentRoomId = null, myNickname = '', participants = [], messages = [], isTyping = false;

document.addEventListener('DOMContentLoaded', () => {
    socket = io();
    setupSocketListeners();

    const params = new URLSearchParams(location.search);
    if (params.has('room')) {
        currentRoomId = params.get('room').toUpperCase();
        showJoinModal();
    }
});

function setupSocketListeners() {
    socket.on('room-joined', data => {
        currentRoomId = data.roomId;
        myNickname = data.myNickname;
        participants = data.users;
        messages = data.messages || [];
        history.pushState({}, '', `?room=${currentRoomId}`);
        switchToChatView();
        renderParticipants();
        renderMessages();
    });

    socket.on('user-joined', data => { participants = data.users; renderParticipants(); });
    socket.on('user-left', data => { participants = data.users; renderParticipants(); showToast(data.message); });

    socket.on('receive-message', msg => {
        messages.push(msg);
        renderMessages();
    });

    // Typing
    socket.on('user-typing', data => {
        if (data.nickname !== myNickname) {
            document.getElementById('typing-name').textContent = data.nickname;
            document.getElementById('typing-indicator').classList.remove('hidden');
        }
    });
    socket.on('stop-typing', () => {
        document.getElementById('typing-indicator').classList.add('hidden');
    });

    socket.on('room-closed', data => showClosedModal(data.reason));
    socket.on('room-error', data => showToast(`❌ ${data.msg}`));
}

function createRoom() {
    const nickname = document.getElementById('nickname-input').value.trim();
    if (!nickname) return showToast('Enter nickname');
    const expires = parseInt(document.getElementById('expiry-time').value);
    socket.emit('create-room', { nickname, expiresInMinutes: expires });
}

function joinRoomFromHome() {
    const roomId = document.getElementById('room-code-input').value.trim().toUpperCase();
    const nickname = document.getElementById('nickname-input').value.trim();
    if (!roomId || !nickname) return showToast('Enter Room ID and nickname');
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

function cancelJoinModal() { document.getElementById('join-modal').classList.add('hidden'); }

function switchToChatView() {
    document.getElementById('home-view').classList.add('hidden');
    document.getElementById('chat-view').classList.add('active');
    document.getElementById('header-room-info').classList.remove('hidden');
    document.getElementById('room-id-display').textContent = currentRoomId;
}

function renderParticipants() {
    const container = document.getElementById('participants-list');
    container.innerHTML = '';
    document.getElementById('participant-count').textContent = `${participants.length}/2`;

    participants.forEach(user => {
        const div = document.createElement('div');
        div.className = `participant ${user.nickname === myNickname ? 'me' : ''}`;
        div.innerHTML = `
            <div class="participant-name">${user.nickname === myNickname ? '👤 You' : user.nickname}</div>
            <div class="participant-ip">IP: ${user.ip}</div>
        `;
        container.appendChild(div);
    });
}

function renderMessages() {
    const container = document.getElementById('chat-messages');
    const empty = document.getElementById('empty-chat');
    empty.style.display = messages.length ? 'none' : 'flex';

    container.querySelectorAll('.message').forEach(el => el.remove());

    messages.forEach(msg => {
        const isMine = msg.sender === myNickname;
        const div = document.createElement('div');
        div.className = `message ${isMine ? 'you' : 'other'}`;
        let html = `
            <div class="message-header">
                <span class="message-sender">${isMine ? 'You' : msg.sender}</span>
                <span class="message-ip">• ${msg.ip}</span>
                <span class="message-time">${msg.time}</span>
            </div>
        `;
        if (msg.text) html += `<div>${msg.text}</div>`;
        if (msg.fileUrl) {
            if (msg.fileType === 'image') html += `<img src="${msg.fileUrl}" class="chat-image">`;
            else if (msg.fileType === 'audio' || msg.fileType === 'video') 
                html += `<\( {msg.fileType} controls src=" \){msg.fileUrl}" class="chat-media"></${msg.fileType}>`;
        }
        div.innerHTML = html;
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
        socket.emit('stop-typing');
        isTyping = false;
    }
}

function handleTyping(e) {
    if (!currentRoomId) return;
    if (e.key === 'Enter') return;
    if (!isTyping) {
        isTyping = true;
        socket.emit('typing');
    }
    clearTimeout(window.typingTimeout);
    window.typingTimeout = setTimeout(() => {
        socket.emit('stop-typing');
        isTyping = false;
    }, 1500);
}

function triggerFileUpload() { document.getElementById('file-upload').click(); }

function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    fetch('/upload', { method: 'POST', body: formData })
        .then(res => res.json())
        .then(data => {
            if (data.success) socket.emit('send-message', { fileUrl: data.url, fileType: data.type });
        });
}

function exitRoom() {
    if (confirm("Exit room? This will permanently delete the room for everyone.")) {
        socket.emit('exit-room');
        goBackToHome();
    }
}

function copyRoomLink() {
    const link = `\( {window.location.origin}?room= \){currentRoomId}`;
    navigator.clipboard.writeText(link).then(() => showToast('✅ Link copied!'));
}

function showClosedModal(reason) {
    document.getElementById('closed-reason').innerHTML = reason;
    document.getElementById('closed-modal').classList.remove('hidden');
}

function goBackToHome() {
    document.getElementById('closed-modal').classList.add('hidden');
    document.getElementById('chat-view').classList.remove('active');
    document.getElementById('home-view').classList.remove('hidden');
    document.getElementById('header-room-info').classList.add('hidden');
    currentRoomId = null;
}

function toggleTheme() {
    const body = document.body;
    body.dataset.theme = body.dataset.theme === 'dark' ? 'light' : 'dark';
}

function showToast(msg, timeout = 3000) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), timeout);
}
