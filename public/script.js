// public/script.js - Updated for Premium UI + Android Optimization

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

    // Handle direct room link (/?room=XXXX)
    const params = new URLSearchParams(window.location.search);
    if (params.has('room')) {
        currentRoomId = params.get('room').toUpperCase();
        showJoinModal();
    }

    // Optional: Dynamic viewport height for better Android fit
    function setDynamicHeight() {
        document.documentElement.style.setProperty('--vh', `${window.innerHeight * 0.01}px`);
    }
    window.addEventListener('resize', setDynamicHeight);
    setDynamicHeight();
});

function setupSocketListeners() {
    socket.on('room-joined', (data) => {
        currentRoomId = data.roomId;
        myNickname = data.myNickname;
        participants = data.users || [];
        messages = data.messages || [];
        isGroup = data.isGroup || false;

        // Update URL
        history.pushState({}, '', `?room=${currentRoomId}`);

        switchToChatView();
        renderParticipants();
        renderMessages();
    });

    socket.on('user-joined', (data) => {
        participants = data.users || [];
        renderParticipants();
    });

    socket.on('user-left', (data) => {
        participants = data.users || [];
        renderParticipants();
        showToast(data.message || 'Someone left the room');
    });

    socket.on('receive-message', (msg) => {
        messages.push(msg);
        renderMessages();
    });

    socket.on('room-closed', (data) => {
        showClosedModal(data.reason || 'Room has been permanently deleted.');
    });

    socket.on('room-error', (data) => {
        showToast(`❌ ${data.msg || 'Something went wrong'}`);
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

    // Ensure chat scrolls to bottom
    setTimeout(() => {
        const messagesContainer = document.getElementById('chat-messages');
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }, 100);
}

function renderParticipants() {
    const container = document.getElementById('participants-list');
    container.innerHTML = '';

    const countEl = document.getElementById('participant-count');
    countEl.textContent = isGroup 
        ? `${participants.length}+` 
        : `${participants.length}/2`;

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
                    IP: ${user.ip || 'Hidden'}
                </div>
            </div>
        `;

        container.appendChild(div);
    });
}

function renderMessages() {
    const container = document.getElementById('chat-messages');
    const empty = document.getElementById('empty-chat');

    if (messages.length > 0) {
        empty.style.display = 'none';
    } else {
        empty.style.display = 'flex';
    }

    // Clear old messages except empty state
    container.querySelectorAll('.message').forEach(el => el.remove());

    messages.forEach(msg => {
        const isMine = msg.sender === myNickname;

        const div = document.createElement('div');
        div.className = `message ${isMine ? 'you' : 'other'}`;

        let content = `
            <div class="message-header">
                <span class="message-sender">${isMine ? 'You' : msg.sender}</span>
                <span class="message-ip">• ${msg.ip || ''}</span>
                <span class="message-time">${msg.time || ''}</span>
            </div>
        `;

        if (msg.text) {
            content += `<div>${msg.text}</div>`;
        }

        if (msg.fileUrl) {
            if (msg.fileType === 'image') {
                content += `<img src="${msg.fileUrl}" class="chat-image" alt="Shared image">`;
            } else if (msg.fileType === 'audio') {
                content += `<audio controls src="${msg.fileUrl}" class="chat-audio"></audio>`;
            }
        }

        div.innerHTML = content;
        container.appendChild(div);
    });

    // Auto scroll to bottom
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
        } else {
            showToast('Failed to upload file');
        }
    })
    .catch(() => showToast('Upload error'));
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
        showToast('🎤 Recording... Tap again to stop', 8000);
        
        // Auto stop after 60 seconds max
        setTimeout(() => {
            if (mediaRecorder && mediaRecorder.state === "recording") {
                mediaRecorder.stop();
            }
        }, 60000);

    } catch (err) {
        showToast('Microphone access denied or not available');
    }
}

function exitRoom() {
    if (confirm("Are you sure you want to exit? Room will be deleted if you're the last user.")) {
        socket.emit('exit-room');
        goBackToHome();
    }
}

function copyRoomLink() {
    if (!currentRoomId) {
        return showToast('❌ No active room');
    }

    const link = `\( {window.location.origin}?room= \){currentRoomId}`;

    navigator.clipboard.writeText(link)
        .then(() => showToast('✅ Link copied to clipboard!'))
        .catch(() => showToast('❌ Failed to copy link'));
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

    // Reset variables
    currentRoomId = null;
    participants = [];
    messages = [];
    myNickname = '';
}

function showToast(msg, timeout = 3000) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.remove('hidden');

    setTimeout(() => {
        toast.classList.add('hidden');
    }, timeout);
}
