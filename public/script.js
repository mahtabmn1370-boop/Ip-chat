// public/script.js - Secure version with media support (FIXED)
let socket;
let currentRoomId = null;
let myNickname = '';
let participants = [];
let messages = [];
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

        history.pushState({}, '', `?room=${currentRoomId}`);
        switchToChatView();
        renderParticipants();
        renderMessages();
        if (participants.length === 2) document.getElementById('waiting-banner').classList.add('hidden');
    });

    socket.on('user-joined', (data) => {
        participants = data.users;
        renderParticipants();
        document.getElementById('waiting-banner').classList.add('hidden');
    });

    socket.on('receive-message', (msg) => {
        messages.push(msg);
        renderMessages();
        const container = document.getElementById('chat-messages');
        container.scrollTop = container.scrollHeight;
    });

    socket.on('room-closed', (data) => {
        showClosedModal(data.reason);
    });

    socket.on('room-error', (data) => {
        showToast(`❌ ${data.msg}`);
    });
}

function createRoom() {
    const nickname = document.getElementById('nickname-input').value.trim();
    if (!nickname) return showToast('Please enter a nickname');
    socket.emit('create-room', { nickname });
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
    document.getElementById('participant-count').textContent = `${participants.length}/2`;

    participants.forEach(user => {
        const isMe = user.nickname === myNickname;
        const div = document.createElement('div');
        div.className = `participant ${isMe ? 'me' : ''}`;

        // SAFE rendering (XSS fix)
        const nameDiv = document.createElement('div');
        nameDiv.className = 'participant-name';
        nameDiv.textContent = isMe ? '👤 You' : user.nickname;

        const ipDiv = document.createElement('div');
        ipDiv.className = 'participant-ip';
        ipDiv.textContent = `IP: ${user.ip}`;

        const infoDiv = document.createElement('div');
        infoDiv.className = 'participant-info';
        infoDiv.appendChild(nameDiv);
        infoDiv.appendChild(ipDiv);

        div.appendChild(infoDiv);
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

        const header = document.createElement('div');
        header.className = 'message-header';

        const sender = document.createElement('span');
        sender.className = 'message-sender';
        sender.textContent = isMine ? 'You' : msg.sender;

        const ip = document.createElement('span');
        ip.className = 'message-ip';
        ip.textContent = `• ${msg.ip}`;

        const time = document.createElement('span');
        time.className = 'message-time';
        time.textContent = msg.time;

        header.appendChild(sender);
        header.appendChild(ip);
        header.appendChild(time);

        div.appendChild(header);

        if (msg.text) {
            const textDiv = document.createElement('div');
            textDiv.textContent = msg.text; // SAFE
            div.appendChild(textDiv);
        }

        if (msg.fileUrl) {
            if (msg.fileType === 'image') {
                const img = document.createElement('img');
                img.src = msg.fileUrl;
                img.className = 'chat-image';
                div.appendChild(img);
            } else {
                const audio = document.createElement('audio');
                audio.controls = true;
                audio.src = msg.fileUrl;
                audio.className = 'chat-audio';
                div.appendChild(audio);
            }
        }

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
        showToast('🎤 Recording... Click again to stop', 15000);

        setTimeout(() => {
            if (mediaRecorder && mediaRecorder.state === "recording") mediaRecorder.stop();
        }, 30000);

    } catch (err) {
        showToast('Microphone access denied or not available');
    }
}

// FIXED: safer click detection (still same behavior)
document.addEventListener('click', (e) => {
    if (
        e.target &&
        e.target.textContent &&
        e.target.textContent.includes('🎤') &&
        mediaRecorder &&
        mediaRecorder.state === "recording"
    ) {
        mediaRecorder.stop();
    }
});

function copyRoomLink() {
    const link = `${window.location.origin}?room=${currentRoomId}`;
    navigator.clipboard.writeText(link).then(() => showToast('✅ Link copied!'));
}

function showClosedModal(reason) {
    document.getElementById('closed-reason').textContent =
        reason || 'Room has been permanently deleted.';
    document.getElementById('closed-modal').classList.remove('hidden');
}

function goBackToHome() {
    document.getElementById('closed-modal').classList.add('hidden');
    document.getElementById('chat-view').classList.add('hidden');
    document.getElementById('home-view').classList.remove('hidden');
    document.getElementById('header-room-info').classList.add('hidden');
    currentRoomId = null;
}

function showToast(msg, timeout = 3000) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), timeout);
        }
