/**
 * PeerDrop - Client-side WebRTC DataChannel Engine
 * Direct browser-to-browser encrypted chunked file transmission.
 */

(function () {
  'use strict';

  const socket = io();
  const urlParams = new URLSearchParams(window.location.search);
  const roomId = urlParams.get('room') || 'PD-' + Math.floor(1000 + Math.random() * 9000);
  
  // UI Elements
  const roomCodeDisplay = document.getElementById('roomCodeDisplay');
  const btnCopyInvite = document.getElementById('btnCopyInvite');
  const localDeviceLabel = document.getElementById('localDeviceLabel');
  const scannerStatus = document.getElementById('scannerStatus');
  const peerPinsContainer = document.getElementById('peerPinsContainer');
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');
  const transferHud = document.getElementById('transferHud');
  const hudFileName = document.getElementById('hudFileName');
  const hudFileSize = document.getElementById('hudFileSize');
  const hudSpeed = document.getElementById('hudSpeed');
  const hudPercent = document.getElementById('hudPercent');
  const hudProgressFill = document.getElementById('hudProgressFill');
  const hudStatus = document.getElementById('hudStatus');
  const historyList = document.getElementById('historyList');
  const toastContainer = document.getElementById('toastContainer');

  roomCodeDisplay.textContent = roomId;

  // Device Detection
  const ua = navigator.userAgent;
  let deviceName = 'Desktop Browser';
  if (/android/i.test(ua)) deviceName = 'Android Mobile';
  else if (/iPhone|iPad|iPod/i.test(ua)) deviceName = 'Apple iOS';
  else if (/Mac/i.test(ua)) deviceName = 'macOS Workstation';
  else if (/Windows/i.test(ua)) deviceName = 'Windows PC';
  localDeviceLabel.textContent = deviceName;

  // WebRTC Configuration
  const rtcConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:global.stun.twilio.com:3478' }
    ]
  };

  const peers = new Map(); // targetId -> { pc, dc, name, device }
  const CHUNK_SIZE = 64 * 1024; // 64 KB binary chunks

  // Join Signaling Room
  socket.on('connect', () => {
    socket.emit('room:join', {
      roomId,
      clientName: deviceName + ' #' + socket.id.substring(0, 4),
      device: deviceName
    });
    showToast('Joined P2P mesh network ✨');
  });

  // Received list of existing peers in room
  socket.on('room:peers', (existingPeers) => {
    existingPeers.forEach(peer => {
      addPeerPin(peer);
      initiatePeerConnection(peer.id, true, peer.name);
    });
    updateScannerState();
  });

  // A new peer entered the room
  socket.on('peer:joined', (peer) => {
    addPeerPin(peer);
    initiatePeerConnection(peer.id, false, peer.name);
    showToast(`Peer connected: ${peer.name}`);
    updateScannerState();
  });

  // Peer disconnected
  socket.on('peer:left', (peerId) => {
    const pin = document.getElementById('pin-' + peerId);
    if (pin) pin.remove();
    if (peers.has(peerId)) {
      const p = peers.get(peerId);
      if (p.dc) p.dc.close();
      if (p.pc) p.pc.close();
      peers.delete(peerId);
    }
    showToast('A peer disconnected');
    updateScannerState();
  });

  // WebRTC Signaling Handlers
  socket.on('signal:offer', async ({ senderId, senderInfo, offer }) => {
    let peer = peers.get(senderId);
    if (!peer) {
      peer = initiatePeerConnection(senderId, false, senderInfo.name);
    }
    await peer.pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await peer.pc.createAnswer();
    await peer.pc.setLocalDescription(answer);
    socket.emit('signal:answer', { targetId: senderId, answer });
  });

  socket.on('signal:answer', async ({ senderId, answer }) => {
    const peer = peers.get(senderId);
    if (peer) {
      await peer.pc.setRemoteDescription(new RTCSessionDescription(answer));
    }
  });

  socket.on('signal:candidate', async ({ senderId, candidate }) => {
    const peer = peers.get(senderId);
    if (peer && candidate) {
      try {
        await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error('ICE Candidate error', err);
      }
    }
  });

  // Peer Connection Lifecycle
  function initiatePeerConnection(targetId, isInitiator, peerName) {
    const pc = new RTCPeerConnection(rtcConfig);
    const peerData = { pc, dc: null, name: peerName || 'Peer' };
    peers.set(targetId, peerData);

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        socket.emit('signal:candidate', { targetId, candidate: e.candidate });
      }
    };

    if (isInitiator) {
      const dc = pc.createDataChannel('fileTransfer');
      setupDataChannel(dc, targetId);
      peerData.dc = dc;

      pc.createOffer().then(offer => {
        pc.setLocalDescription(offer);
        socket.emit('signal:offer', { targetId, offer });
      });
    } else {
      pc.ondatachannel = (e) => {
        const dc = e.channel;
        setupDataChannel(dc, targetId);
        peerData.dc = dc;
      };
    }

    return peerData;
  }

  // Incoming File Receiving Buffer
  let incomingFileMeta = null;
  let receivedBuffers = [];
  let receivedBytes = 0;
  let transferStartTime = 0;

  function setupDataChannel(dc, peerId) {
    dc.binaryType = 'arraybuffer';

    dc.onopen = () => {
      showToast(`Direct P2P DataChannel open with ${peers.get(peerId)?.name || 'peer'}`);
      updateScannerState();
    };

    dc.onmessage = (e) => {
      if (typeof e.data === 'string') {
        const msg = JSON.parse(e.data);
        if (msg.type === 'file-start') {
          incomingFileMeta = msg;
          receivedBuffers = [];
          receivedBytes = 0;
          transferStartTime = Date.now();
          transferHud.style.display = 'block';
          hudFileName.textContent = msg.name;
          hudStatus.textContent = 'Receiving encrypted stream...';
        } else if (msg.type === 'file-end') {
          // File complete: assemble blob and auto download
          const blob = new Blob(receivedBuffers, { type: incomingFileMeta.mimeType || 'application/octet-stream' });
          const downloadUrl = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = downloadUrl;
          a.download = incomingFileMeta.name;
          a.click();
          URL.revokeObjectURL(downloadUrl);

          hudStatus.textContent = 'Transfer Completed! Saved to Downloads.';
          addHistoryItem(incomingFileMeta.name, formatBytes(incomingFileMeta.size), 'Received');
          showToast(`Downloaded ${incomingFileMeta.name} 🎉`);
          setTimeout(() => { transferHud.style.display = 'none'; }, 4000);
        }
      } else {
        // Binary chunk received
        receivedBuffers.push(e.data);
        receivedBytes += e.data.byteLength;

        const pct = Math.floor((receivedBytes / incomingFileMeta.size) * 100);
        hudPercent.textContent = pct + '%';
        hudProgressFill.style.width = pct + '%';
        hudFileSize.textContent = `${formatBytes(receivedBytes)} / ${formatBytes(incomingFileMeta.size)}`;

        const elapsedSec = (Date.now() - transferStartTime) / 1000;
        const speedMB = (receivedBytes / (1024 * 1024)) / (elapsedSec || 1);
        hudSpeed.textContent = speedMB.toFixed(1) + ' MB/s';
      }
    };
  }

  // Sending File Chunks over DataChannel
  async function sendFileToPeers(file) {
    if (peers.size === 0) {
      alert('No peers connected! Please open this room on another device or send the invite link.');
      return;
    }

    transferHud.style.display = 'block';
    hudFileName.textContent = file.name;
    hudStatus.textContent = 'Broadcasting chunks to connected peers...';
    transferStartTime = Date.now();

    // 1. Notify metadata
    const metaPayload = JSON.stringify({
      type: 'file-start',
      name: file.name,
      size: file.size,
      mimeType: file.type
    });

    peers.forEach(p => {
      if (p.dc && p.dc.readyState === 'open') {
        p.dc.send(metaPayload);
      }
    });

    // 2. Stream Binary Chunks with Backpressure Control
    const reader = file.stream().getReader();
    let sentBytes = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      // Check buffer size across peers
      for (const p of peers.values()) {
        if (p.dc && p.dc.readyState === 'open') {
          // If buffered amount is high (>1MB), wait for drain
          if (p.dc.bufferedAmount > 1024 * 1024) {
            await new Promise(r => setTimeout(r, 20));
          }
          p.dc.send(value.buffer);
        }
      }

      sentBytes += value.byteLength;
      const pct = Math.floor((sentBytes / file.size) * 100);
      hudPercent.textContent = pct + '%';
      hudProgressFill.style.width = pct + '%';
      hudFileSize.textContent = `${formatBytes(sentBytes)} / ${formatBytes(file.size)}`;

      const elapsedSec = (Date.now() - transferStartTime) / 1000;
      const speedMB = (sentBytes / (1024 * 1024)) / (elapsedSec || 1);
      hudSpeed.textContent = speedMB.toFixed(1) + ' MB/s';
    }

    // 3. Send file-end signal
    const endPayload = JSON.stringify({ type: 'file-end' });
    peers.forEach(p => {
      if (p.dc && p.dc.readyState === 'open') {
        p.dc.send(endPayload);
      }
    });

    hudStatus.textContent = 'File Sent Successfully!';
    addHistoryItem(file.name, formatBytes(file.size), 'Sent');
    showToast(`Successfully sent ${file.name} 🚀`);
    setTimeout(() => { transferHud.style.display = 'none'; }, 4000);
  }

  // Radar UI Nodes
  function addPeerPin(peer) {
    if (document.getElementById('pin-' + peer.id)) return;
    const pin = document.createElement('div');
    pin.id = 'pin-' + peer.id;
    pin.className = 'peer-pin';

    // Position around radar circle randomly
    const angle = Math.random() * 2 * Math.PI;
    const radius = 80;
    const cx = 130 + radius * Math.cos(angle);
    const cy = 130 + radius * Math.sin(angle);
    pin.style.left = cx + 'px';
    pin.style.top = cy + 'px';

    pin.innerHTML = `
      <div class="peer-pin-avatar" title="${peer.name}">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect>
          <line x1="12" y1="18" x2="12.01" y2="18"></line>
        </svg>
      </div>
      <span class="peer-pin-name">${peer.name}</span>
    `;
    peerPinsContainer.appendChild(pin);
  }

  function updateScannerState() {
    if (peers.size > 0) {
      scannerStatus.textContent = `${peers.size} peer(s) connected and ready to transfer`;
      scannerStatus.style.color = '#10B981';
    } else {
      scannerStatus.textContent = 'Scanning for peers in room...';
      scannerStatus.style.color = '#94A3B8';
    }
  }

  // Drag & Drop Setup
  dropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => {
    Array.from(e.target.files).forEach(file => sendFileToPeers(file));
  });

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });

  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    Array.from(e.dataTransfer.files).forEach(file => sendFileToPeers(file));
  });

  // Invite Copy
  btnCopyInvite.addEventListener('click', () => {
    const url = window.location.origin + window.location.pathname + '?room=' + encodeURIComponent(roomId);
    navigator.clipboard.writeText(url).then(() => {
      showToast('Invite link copied! Send it to phone or friend 📋');
    });
  });

  // History Helper
  function addHistoryItem(name, size, type) {
    const emptyEl = historyList.querySelector('.history-empty');
    if (emptyEl) emptyEl.remove();

    const item = document.createElement('div');
    item.className = 'history-item';
    item.innerHTML = `
      <div>
        <strong>${name}</strong>
        <span style="color: var(--text-dim); margin-left: 6px;">(${size})</span>
      </div>
      <span style="color: ${type === 'Sent' ? '#38BDF8' : '#10B981'}; font-weight: 600;">${type}</span>
    `;
    historyList.prepend(item);
  }

  function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function showToast(msg) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = msg;
    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.animation = 'toastOut 0.3s forwards';
      setTimeout(() => toast.remove(), 300);
    }, 2500);
  }

})();
