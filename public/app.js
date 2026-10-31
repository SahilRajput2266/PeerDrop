/**
 * PeerDrop - Client-side WebRTC DataChannel Engine
 * Direct browser-to-browser encrypted chunked file transmission.
 */

(function () {
  'use strict';

  // Network & Room Info with Persistence
  const urlParams = new URLSearchParams(window.location.search);
  let rawRoom = urlParams.get('room');
  if (!rawRoom) {
    // Check localStorage first so refresh never kicks user into a random new room
    rawRoom = localStorage.getItem('peerdrop_room');
    if (!rawRoom) {
      rawRoom = 'PD-' + Math.floor(1000 + Math.random() * 9000);
    }
    const newUrl = new URL(window.location.href);
    newUrl.searchParams.set('room', rawRoom);
    window.history.replaceState({}, '', newUrl.toString());
  }
  const roomId = rawRoom.trim().toUpperCase();
  localStorage.setItem('peerdrop_room', roomId);

  let serverNetworkIp = null;
  let serverPort = window.location.port || '3003';

  // UI Elements
  const relayChip = document.getElementById('relayChip');
  const relayDot = document.getElementById('relayDot');
  const relayText = document.getElementById('relayText');
  const roomCodeDisplay = document.getElementById('roomCodeDisplay');
  const roomPill = document.getElementById('roomPill');
  const btnCopyInvite = document.getElementById('btnCopyInvite');
  const localDeviceLabel = document.getElementById('localDeviceLabel');
  const devicePill = document.getElementById('devicePill');
  const formJoinRoom = document.getElementById('formJoinRoom');
  const inputCustomRoom = document.getElementById('inputCustomRoom');
  const btnJoinRoom = document.getElementById('btnJoinRoom');
  const btnNewRoom = document.getElementById('btnNewRoom');
  const lanInfoPill = document.getElementById('lanInfoPill');
  const lanUrlDisplay = document.getElementById('lanUrlDisplay');
  const btnCopyLanUrl = document.getElementById('btnCopyLanUrl');
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
  const historyEmpty = document.getElementById('historyEmpty');
  const historyCount = document.getElementById('historyCount');
  const btnHistoryClear = document.getElementById('btnHistoryClear');
  const toastContainer = document.getElementById('toastContainer');
  const btnHudDownload = document.getElementById('btnHudDownload');
  const btnHudDownloadText = document.getElementById('btnHudDownloadText');

  // Modal elements
  const modalBackdrop = document.getElementById('modalBackdrop');
  const inputDeviceName = document.getElementById('inputDeviceName');
  const btnCancelRename = document.getElementById('btnCancelRename');
  const btnSaveRename = document.getElementById('btnSaveRename');

  roomCodeDisplay.textContent = roomId;

  // Device Detection & Custom Name Persistence
  const ua = navigator.userAgent;
  let defaultDevice = 'Desktop Browser';
  if (/android/i.test(ua)) defaultDevice = 'Android Mobile';
  else if (/iPhone|iPad|iPod/i.test(ua)) defaultDevice = 'Apple iOS';
  else if (/Mac/i.test(ua)) defaultDevice = 'macOS Workstation';
  else if (/Windows/i.test(ua)) defaultDevice = 'Windows PC';

  let deviceName = localStorage.getItem('peerdrop_device_name') || defaultDevice;
  localDeviceLabel.textContent = deviceName;

  const centerRadarNode = document.getElementById('centerRadarNode');
  const centerNodeLabel = document.getElementById('centerNodeLabel');
  if (centerNodeLabel) centerNodeLabel.textContent = deviceName;

  // Device Rename Modal System
  function openRenameModal() {
    inputDeviceName.value = deviceName;
    modalBackdrop.style.display = 'flex';
    inputDeviceName.focus();
    inputDeviceName.select();
  }

  function saveNewDeviceName() {
    const val = (inputDeviceName.value || '').trim();
    if (val && val !== deviceName) {
      deviceName = val;
      localStorage.setItem('peerdrop_device_name', deviceName);
      localDeviceLabel.textContent = deviceName;
      if (centerNodeLabel) centerNodeLabel.textContent = deviceName;
      socket.emit('peer:update-name', { name: deviceName });
      showToast(`Device renamed to: ${deviceName} ✎`);
    }
    modalBackdrop.style.display = 'none';
  }

  if (devicePill) devicePill.addEventListener('click', openRenameModal);
  if (centerRadarNode) centerRadarNode.addEventListener('click', openRenameModal);
  if (btnCancelRename) btnCancelRename.addEventListener('click', () => { modalBackdrop.style.display = 'none'; });
  if (modalBackdrop) {
    modalBackdrop.addEventListener('click', (e) => {
      if (e.target === modalBackdrop) modalBackdrop.style.display = 'none';
    });
  }
  if (btnSaveRename) btnSaveRename.addEventListener('click', saveNewDeviceName);
  if (inputDeviceName) {
    inputDeviceName.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveNewDeviceName();
      }
    });
  }

  // Fetch Server Network Info (for LAN Wi-Fi sharing)
  fetch('/api/info')
    .then(r => r.json())
    .then(data => {
      serverNetworkIp = data.networkIp;
      serverPort = data.port;
      if (serverNetworkIp && serverNetworkIp !== 'localhost' && serverNetworkIp !== '127.0.0.1') {
        const lanUrl = `http://${serverNetworkIp}:${serverPort}`;
        lanUrlDisplay.textContent = lanUrl;
        lanInfoPill.style.display = 'flex';
      }
    })
    .catch(() => {});

  // Socket Connection URL:
  // Central WebRTC Socket.io Signaling Server (Thakur Boot House on Render)
  const THAKUR_BACKEND_URL = 'https://thakurboothouse.onrender.com';

  // Always connect to Thakur Boot House backend so every device (PC, Mobile, Vercel)
  // joins the exact same signaling room regardless of where frontend is loaded from.
  const backendParam = urlParams.get('backend');
  let socketUrl = (backendParam === 'local') ? '' : THAKUR_BACKEND_URL;

  // Polling-first handshake with auto WebSocket promotion (guaranteed mobile carrier & Wi-Fi compatibility)
  let socket = io(socketUrl, {
    transports: ['polling', 'websocket'],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    timeout: 12000,
  });

  // Client-side keep-alive heartbeat to Thakur Boot House backend (every 4 mins)
  function sendBackendHeartbeat() {
    fetch(`${THAKUR_BACKEND_URL}/api/v1/health`, { mode: 'no-cors' }).catch(() => {});
  }
  setInterval(sendBackendHeartbeat, 4 * 60 * 1000);

  // WebRTC Configuration (Multi-STUN with ICE pre-gathering pool)
  const rtcConfig = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
      { urls: 'stun:global.stun.twilio.com:3478' }
    ],
    iceCandidatePoolSize: 10
  };

  const peers = new Map(); // targetId -> { pc, dc, name, device, pendingCandidates: [] }
  const earlyCandidates = new Map(); // senderId -> candidate[] (catches candidates arriving before offer)

  // Join Signaling Room
  socket.on('connect', () => {
    socket.emit('room:join', {
      roomId,
      clientName: deviceName + ' #' + socket.id.substring(0, 4),
      device: deviceName
    });
    if (relayDot) relayDot.className = 'relay-dot connected';
    if (relayText) relayText.textContent = 'LIVE';
    showToast(`Connected to room: ${roomId} (LIVE) ✨`);
    updateScannerState();
  });

  let failoverAttempts = 0;
  socket.on('connect_error', (err) => {
    console.warn('Socket connection attempt notice:', err.message);
    if (relayDot) relayDot.className = 'relay-dot connecting';
    if (relayText) relayText.textContent = 'CONNECTING';
    if (scannerStatus) {
      scannerStatus.textContent = `Connecting to mesh signaling... (${err.message || 'Retrying'})`;
      scannerStatus.style.color = '#F59E0B';
    }

    // Auto-failover: If cloud signaling is blocked or timing out on mobile Wi-Fi,
    // seamlessly switch to local Node relay on the host machine
    failoverAttempts++;
    if (failoverAttempts >= 2 && socketUrl && (window.location.port === '3003' || window.location.port === '5050')) {
      console.warn('Switching to local network relay server...');
      socketUrl = '';
      failoverAttempts = 0;
      try {
        socket.disconnect();
        socket.io.uri = window.location.origin;
        socket.connect();
      } catch (_) {}
    }
  });

  socket.on('disconnect', (reason) => {
    console.warn('Socket disconnected:', reason);
    if (relayDot) relayDot.className = 'relay-dot disconnected';
    if (relayText) relayText.textContent = 'OFFLINE';
    if (scannerStatus) {
      scannerStatus.textContent = 'Disconnected from signaling relay. Reconnecting...';
      scannerStatus.style.color = '#F59E0B';
    }
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

  // Real-time peer name update broadcast
  socket.on('peer:updated', (updatedPeer) => {
    if (peers.has(updatedPeer.id)) {
      const p = peers.get(updatedPeer.id);
      p.name = updatedPeer.name;
    }
    const pin = document.getElementById('pin-' + updatedPeer.id);
    if (pin) {
      const nameEl = pin.querySelector('.peer-pin-name');
      if (nameEl) nameEl.textContent = updatedPeer.name;
      const avatarEl = pin.querySelector('.peer-pin-avatar');
      if (avatarEl) avatarEl.setAttribute('title', `${updatedPeer.name} (${updatedPeer.device || 'Peer'})`);
    }
    showToast(`Peer updated name: ${updatedPeer.name} ✎`);
  });

  // Peer disconnected
  socket.on('peer:left', (peerId) => {
    const pin = document.getElementById('pin-' + peerId);
    if (pin) pin.remove();
    if (peers.has(peerId)) {
      const p = peers.get(peerId);
      if (p.dc) {
        try { p.dc.close(); } catch(e) {}
      }
      if (p.pc) {
        try { p.pc.close(); } catch(e) {}
      }
      peers.delete(peerId);
    }
    earlyCandidates.delete(peerId);
    showToast('A peer disconnected');
    updateScannerState();
  });

  // WebRTC Signaling Handlers
  socket.on('signal:offer', async ({ senderId, senderInfo, offer }) => {
    let peer = peers.get(senderId);
    if (!peer) {
      peer = initiatePeerConnection(senderId, false, senderInfo?.name);
    }
    await peer.pc.setRemoteDescription(new RTCSessionDescription(offer));

    // Process queued early candidates and pending candidates
    const allPending = [
      ...(earlyCandidates.get(senderId) || []),
      ...(peer.pendingCandidates || [])
    ];
    peer.pendingCandidates = [];
    earlyCandidates.delete(senderId);

    for (const cand of allPending) {
      try {
        await peer.pc.addIceCandidate(new RTCIceCandidate(cand));
      } catch (err) {
        console.warn('ICE add error:', err);
      }
    }

    const answer = await peer.pc.createAnswer();
    await peer.pc.setLocalDescription(answer);
    socket.emit('signal:answer', { targetId: senderId, answer });
  });

  socket.on('signal:answer', async ({ senderId, answer }) => {
    const peer = peers.get(senderId);
    if (peer) {
      await peer.pc.setRemoteDescription(new RTCSessionDescription(answer));

      // Process queued candidates
      const allPending = [
        ...(earlyCandidates.get(senderId) || []),
        ...(peer.pendingCandidates || [])
      ];
      peer.pendingCandidates = [];
      earlyCandidates.delete(senderId);

      for (const cand of allPending) {
        try {
          await peer.pc.addIceCandidate(new RTCIceCandidate(cand));
        } catch (err) {
          console.warn('ICE add error:', err);
        }
      }
    }
  });

  socket.on('signal:candidate', async ({ senderId, candidate }) => {
    if (!candidate) return;
    const peer = peers.get(senderId);
    if (peer) {
      if (peer.pc.remoteDescription && peer.pc.remoteDescription.type) {
        try {
          await peer.pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (err) {
          console.warn('ICE Candidate error', err);
        }
      } else {
        peer.pendingCandidates.push(candidate);
      }
    } else {
      // Store in earlyCandidates queue until offer is received
      if (!earlyCandidates.has(senderId)) {
        earlyCandidates.set(senderId, []);
      }
      earlyCandidates.get(senderId).push(candidate);
    }
  });

  // Peer Connection Lifecycle
  function initiatePeerConnection(targetId, isInitiator, peerName) {
    const pc = new RTCPeerConnection(rtcConfig);
    const peerData = { 
      pc, 
      dc: null, 
      name: peerName || 'Peer',
      pendingCandidates: []
    };
    peers.set(targetId, peerData);

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        socket.emit('signal:candidate', { targetId, candidate: e.candidate });
      }
    };

    // Auto-recover on ICE glitches
    pc.oniceconnectionstatechange = () => {
      console.log(`ICE Connection state [${targetId}]:`, pc.iceConnectionState);
      if (pc.iceConnectionState === 'failed') {
        console.warn('ICE connection failed. Triggering ICE restart...');
        if (isInitiator && pc.restartIce) {
          try {
            pc.restartIce();
            pc.createOffer({ iceRestart: true }).then(offer => {
              pc.setLocalDescription(offer);
              socket.emit('signal:offer', { targetId, offer });
            }).catch(() => {});
          } catch (_) {}
        }
      }
      updateScannerState();
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

  // In-Memory Session Cache for Received Files (enables later downloading without re-transfer)
  const sessionReceivedBlobs = new Map(); // fileId -> { fileId, blob, name, size, mimeType, objectUrl }

  function triggerFileDownload(url, filename) {
    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || 'download';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (e) {
      console.warn('Auto-download notice (manual button available):', e);
    }
  }

  // Incoming File Receiving Buffer
  let incomingFileMeta = null;
  let receivedBuffers = [];
  let receivedBytes = 0;
  let transferStartTime = 0;
  let lastReceiverUiUpdate = 0;

  function setupDataChannel(dc, peerId) {
    dc.binaryType = 'arraybuffer';
    dc.bufferedAmountLowThreshold = 256 * 1024;

    dc.onopen = () => {
      showToast(`P2P DataChannel open with ${peers.get(peerId)?.name || 'peer'} ⚡`);
      updateScannerState();
    };

    dc.onclose = () => {
      updateScannerState();
    };

    dc.onerror = (err) => {
      console.error('DataChannel error:', err);
    };

    dc.onmessage = (e) => {
      try {
        if (typeof e.data === 'string') {
          const msg = JSON.parse(e.data);
          if (msg.type === 'file-start') {
            incomingFileMeta = msg;
            receivedBuffers = [];
            receivedBytes = 0;
            transferStartTime = Date.now();
            lastReceiverUiUpdate = 0;
            transferHud.style.display = 'block';
            if (btnHudDownload) btnHudDownload.style.display = 'none';
            hudFileName.textContent = msg.name;
            hudFileSize.textContent = `0 B / ${formatBytes(msg.size)}`;
            hudPercent.textContent = '0%';
            hudProgressFill.style.width = '0%';
            hudSpeed.textContent = '0 MB/s';
            hudStatus.textContent = 'Receiving encrypted stream...';
          } else if (msg.type === 'file-end') {
            if (!incomingFileMeta) return;

            const fileId = 'rec_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
            const fileName = incomingFileMeta.name;
            const fileSize = incomingFileMeta.size;
            const mimeType = incomingFileMeta.mimeType || 'application/octet-stream';

            // Assemble blob from received chunks
            const blob = new Blob(receivedBuffers, { type: mimeType });
            receivedBuffers = []; // Clear RAM chunk arrays

            const downloadUrl = URL.createObjectURL(blob);

            // Save in session map so user can re-download anytime
            sessionReceivedBlobs.set(fileId, {
              fileId,
              blob,
              name: fileName,
              size: fileSize,
              mimeType,
              objectUrl: downloadUrl
            });

            // Try auto-download once (if allowed by browser popup settings)
            triggerFileDownload(downloadUrl, fileName);

            // Present persistent manual download button in HUD
            if (btnHudDownload) {
              btnHudDownload.style.display = 'inline-flex';
              if (btnHudDownloadText) btnHudDownloadText.textContent = `Download (${formatBytes(fileSize)})`;
              btnHudDownload.onclick = () => {
                triggerFileDownload(downloadUrl, fileName);
                showToast(`Saving ${fileName} 💾`);
              };
            }

            hudStatus.textContent = 'Transfer complete! Ready to save.';
            hudPercent.textContent = '100%';
            hudProgressFill.style.width = '100%';
            addHistoryItem(fileName, formatBytes(fileSize), 'Received', fileId);
            showToast(`Received ${fileName} 🎉 (Tap Download button anytime)`);
            incomingFileMeta = null;
          }
        } else {
          // Binary chunk received
          if (!incomingFileMeta) return;

          receivedBuffers.push(e.data);
          receivedBytes += e.data.byteLength;

          // Throttled UI updates for receiver
          const now = Date.now();
          if (now - lastReceiverUiUpdate > 80 || receivedBytes >= incomingFileMeta.size) {
            lastReceiverUiUpdate = now;
            const pct = Math.min(100, Math.floor((receivedBytes / incomingFileMeta.size) * 100));
            hudPercent.textContent = pct + '%';
            hudProgressFill.style.width = pct + '%';
            hudFileSize.textContent = `${formatBytes(receivedBytes)} / ${formatBytes(incomingFileMeta.size)}`;

            const elapsedSec = (now - transferStartTime) / 1000;
            const speedMB = (receivedBytes / (1024 * 1024)) / (elapsedSec || 1);
            hudSpeed.textContent = speedMB.toFixed(1) + ' MB/s';
          }
        }
      } catch (err) {
        console.error('Error handling DataChannel message:', err);
      }
    };
  }

  // Robust File Sending Engine with Slice Chunking & Backpressure Control
  const CHUNK_SIZE = 64 * 1024; // 64 KB binary chunk size (WebRTC standard limit)
  const BUFFER_THRESHOLD = 512 * 1024; // 512 KB backpressure threshold
  let isTransferring = false;

  function waitDrain(dc) {
    if (dc.bufferedAmount <= BUFFER_THRESHOLD) return Promise.resolve();
    return new Promise(resolve => {
      let resolved = false;
      function done() {
        if (resolved) return;
        resolved = true;
        dc.removeEventListener('bufferedamountlow', done);
        clearTimeout(timer);
        resolve();
      }
      const timer = setTimeout(done, 50);
      dc.addEventListener('bufferedamountlow', done);
    });
  }

  async function sendFileToPeers(file) {
    if (isTransferring) {
      showToast('⚠️ Transfer already in progress. Please wait.');
      return;
    }

    if (peers.size === 0) {
      showToast('⚠️ No other devices in this room yet. Share the invite link to connect!');
      return;
    }

    // Filter peers that have an open or connecting DataChannel
    const activePeers = [];
    for (const [, p] of peers.entries()) {
      if (p.dc) {
        if (p.dc.readyState === 'open') {
          activePeers.push(p);
        } else if (p.dc.readyState === 'connecting') {
          // Wait up to 3.5s for DataChannel handshake to finalize
          hudStatus.textContent = 'Connecting direct P2P tunnel...';
          await new Promise(resolve => {
            const timer = setTimeout(resolve, 3500);
            const onOpen = () => {
              clearTimeout(timer);
              p.dc.removeEventListener('open', onOpen);
              resolve();
            };
            p.dc.addEventListener('open', onOpen);
          });
          if (p.dc.readyState === 'open') {
            activePeers.push(p);
          }
        }
      }
    }

    if (activePeers.length === 0) {
      showToast('⚠️ P2P tunnel establishing with device. Please tap Choose Files again in 2 seconds.');
      return;
    }

    isTransferring = true;
    transferHud.style.display = 'block';
    if (btnHudDownload) btnHudDownload.style.display = 'none';
    hudFileName.textContent = file.name;
    hudFileSize.textContent = `0 B / ${formatBytes(file.size)}`;
    hudPercent.textContent = '0%';
    hudProgressFill.style.width = '0%';
    hudSpeed.textContent = '0 MB/s';
    hudStatus.textContent = 'Broadcasting metadata...';
    transferStartTime = Date.now();
    let lastUiUpdate = 0;

    try {
      // 1. Notify metadata
      const metaPayload = JSON.stringify({
        type: 'file-start',
        name: file.name,
        size: file.size,
        mimeType: file.type || 'application/octet-stream'
      });

      for (const p of activePeers) {
        if (p.dc.readyState === 'open') {
          p.dc.send(metaPayload);
        }
      }

      hudStatus.textContent = 'Streaming file chunks directly to peer(s)...';

      // 2. Stream Binary Chunks with Backpressure & Chunk Slicing
      let sentBytes = 0;
      for (let offset = 0; offset < file.size; offset += CHUNK_SIZE) {
        for (const p of activePeers) {
          if (p.dc.readyState === 'open' && p.dc.bufferedAmount > BUFFER_THRESHOLD) {
            await waitDrain(p.dc);
          }
        }

        const slice = file.slice(offset, Math.min(offset + CHUNK_SIZE, file.size));
        const chunk = await slice.arrayBuffer();

        let anySent = false;
        for (const p of activePeers) {
          if (p.dc.readyState === 'open') {
            p.dc.send(chunk);
            anySent = true;
          }
        }

        if (!anySent) {
          throw new Error('Peer connection was closed during transfer');
        }

        sentBytes += chunk.byteLength;

        // Throttled UI update
        const now = Date.now();
        if (now - lastUiUpdate > 80 || sentBytes >= file.size) {
          lastUiUpdate = now;
          const pct = Math.min(100, Math.floor((sentBytes / file.size) * 100));
          hudPercent.textContent = pct + '%';
          hudProgressFill.style.width = pct + '%';
          hudFileSize.textContent = `${formatBytes(sentBytes)} / ${formatBytes(file.size)}`;

          const elapsedSec = (now - transferStartTime) / 1000;
          const speedMB = (sentBytes / (1024 * 1024)) / (elapsedSec || 1);
          hudSpeed.textContent = speedMB.toFixed(1) + ' MB/s';
        }
      }

      // Ensure buffer is fully drained
      for (const p of activePeers) {
        if (p.dc.readyState === 'open' && p.dc.bufferedAmount > 0) {
          while (p.dc.readyState === 'open' && p.dc.bufferedAmount > 0) {
            await new Promise(r => setTimeout(r, 20));
          }
        }
      }

      // 3. Send file-end signal
      const endPayload = JSON.stringify({ type: 'file-end' });
      for (const p of activePeers) {
        if (p.dc.readyState === 'open') {
          p.dc.send(endPayload);
        }
      }

      hudStatus.textContent = 'Transfer Completed Successfully! 🚀';
      hudPercent.textContent = '100%';
      hudProgressFill.style.width = '100%';
      addHistoryItem(file.name, formatBytes(file.size), 'Sent');
      showToast(`Successfully sent ${file.name} 🚀`);
      setTimeout(() => { 
        if (!isTransferring) transferHud.style.display = 'none'; 
      }, 4000);

    } catch (err) {
      console.error('File transfer error:', err);
      hudStatus.textContent = 'Transfer Interrupted: ' + (err.message || 'Unknown error');
      showToast('❌ Transfer failed: ' + (err.message || 'Error occurred'));
    } finally {
      isTransferring = false;
    }
  }

  // Radar UI Nodes
  function addPeerPin(peer) {
    if (document.getElementById('pin-' + peer.id)) return;
    const pin = document.createElement('div');
    pin.id = 'pin-' + peer.id;
    pin.className = 'peer-pin';

    // Position using percentages so it stays centered across mobile and desktop
    const angle = Math.random() * 2 * Math.PI;
    const radiusPercent = 33;
    const leftPercent = 50 + radiusPercent * Math.cos(angle);
    const topPercent = 50 + radiusPercent * Math.sin(angle);
    pin.style.left = leftPercent + '%';
    pin.style.top = topPercent + '%';

    const isMobile = /mobile|iphone|android|ipad/i.test(peer.device || '');
    const deviceIconSvg = isMobile
      ? `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><rect x="5" y="2" width="14" height="20" rx="3" ry="3"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>`
      : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>`;

    pin.innerHTML = `
      <div class="peer-pin-avatar" title="${escapeHTML(peer.name)} (${peer.device || 'Peer'})">
        ${deviceIconSvg}
      </div>
      <span class="peer-pin-name">${escapeHTML(peer.name)}</span>
    `;

    pin.addEventListener('click', (e) => {
      e.stopPropagation();
      showToast(`Selected: ${peer.name} 🎯 Pick file to send`);
      fileInput.click();
    });

    peerPinsContainer.appendChild(pin);
  }

  // Active navigation tab synchronization
  const allTabs = document.querySelectorAll('.nav-tab, .m-tab');
  allTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const href = tab.getAttribute('href');
      allTabs.forEach(t => {
        if (t.getAttribute('href') === href) {
          t.classList.add('active');
        } else {
          t.classList.remove('active');
        }
      });
    });
  });

  function updateScannerState() {
    if (peers.size > 0) {
      scannerStatus.textContent = `${peers.size} peer(s) connected and ready to transfer`;
      scannerStatus.style.color = '#10B981';
    } else {
      scannerStatus.textContent = 'Scanning for peers in room...';
      scannerStatus.style.color = '#94A3B8';
    }
  }

  // Drag & Drop / File Selection Setup (sequential handling of multiple files)
  fileInput.addEventListener('change', async (e) => {
    const files = Array.from(e.target.files);
    e.target.value = '';
    for (const file of files) {
      await sendFileToPeers(file);
    }
  });

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dragover');
  });

  dropzone.addEventListener('dragleave', () => dropzone.classList.remove('dragover'));

  dropzone.addEventListener('drop', async (e) => {
    e.preventDefault();
    dropzone.classList.remove('dragover');
    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
      await sendFileToPeers(file);
    }
  });

  // Robust Copy Helper (works on HTTP and HTTPS)
  function copyText(text, successMsg) {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(() => {
        showToast(successMsg);
      }).catch(() => {
        fallbackCopy(text, successMsg);
      });
    } else {
      fallbackCopy(text, successMsg);
    }
  }

  function fallbackCopy(text, successMsg) {
    try {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.left = '-9999px';
      textArea.style.top = '0';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);
      if (successful) {
        showToast(successMsg);
      } else {
        prompt('Copy room details:', text);
      }
    } catch (err) {
      prompt('Copy room details:', text);
    }
  }

  // Copy Room Code when clicking on Room badge
  roomPill.addEventListener('click', () => {
    copyText(roomId, `Room Code "${roomId}" copied 📋`);
  });

  // Join Room by typing custom ID (supports room code, 4-digit pin, or pasted invite URL)
  function joinCustomRoom() {
    let entered = (inputCustomRoom.value || '').trim();
    if (!entered) {
      showToast('⚠️ Please enter a room ID');
      inputCustomRoom.focus();
      return;
    }

    // Handle pasted full URLs (e.g. https://peerdrop.vercel.app/?room=PD-1234 or LAN links)
    try {
      if (entered.includes('?room=') || entered.startsWith('http://') || entered.startsWith('https://')) {
        const parsed = new URL(entered, window.location.origin);
        const r = parsed.searchParams.get('room');
        if (r) entered = r;
      }
    } catch (_) {}

    entered = entered.trim().toUpperCase();

    // Auto-prefix 4 numeric digits like "1234" to "PD-1234"
    if (/^\d{4}$/.test(entered)) {
      entered = 'PD-' + entered;
    }

    if (entered === roomId) {
      showToast(`ℹ️ Already in room: ${roomId}`);
      return;
    }
    localStorage.setItem('peerdrop_room', entered);
    const targetUrl = new URL(window.location.href);
    targetUrl.searchParams.set('room', entered);
    window.location.href = targetUrl.toString();
  }

  formJoinRoom.addEventListener('submit', (e) => {
    e.preventDefault();
    joinCustomRoom();
  });

  btnJoinRoom.addEventListener('click', (e) => {
    e.preventDefault();
    joinCustomRoom();
  });

  // Create New Random Room
  btnNewRoom.addEventListener('click', () => {
    const newRoom = 'PD-' + Math.floor(1000 + Math.random() * 9000);
    localStorage.setItem('peerdrop_room', newRoom);
    const targetUrl = new URL(window.location.href);
    targetUrl.searchParams.set('room', newRoom);
    window.location.href = targetUrl.toString();
  });

  // Invite Link Copy:
  btnCopyInvite.addEventListener('click', () => {
    let host = window.location.host;
    const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (isLocalhost && serverNetworkIp && serverNetworkIp !== 'localhost') {
      host = `${serverNetworkIp}:${serverPort}`;
    }
    const inviteUrl = `${window.location.protocol}//${host}${window.location.pathname}?room=${encodeURIComponent(roomId)}`;
    copyText(inviteUrl, 'Invite link copied! Share with another device 📋');
  });

  // Copy LAN URL
  if (btnCopyLanUrl) {
    btnCopyLanUrl.addEventListener('click', () => {
      const lanUrl = lanUrlDisplay.textContent;
      copyText(lanUrl, 'Wi-Fi URL copied: ' + lanUrl + ' 📋');
    });
  }
  if (lanUrlDisplay) {
    lanUrlDisplay.addEventListener('click', () => {
      const lanUrl = lanUrlDisplay.textContent;
      copyText(lanUrl, 'Wi-Fi URL copied: ' + lanUrl + ' 📋');
    });
  }

  // ==========================================================
  // Persistent History Engine (Survives Refresh!)
  // ==========================================================
  const STORAGE_KEY = 'peerdrop_transfers_history';

  function getSavedHistory() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch (e) {
      return [];
    }
  }

  function saveHistoryToStorage(item) {
    const history = getSavedHistory();
    history.unshift(item);
    // Keep last 40 items
    if (history.length > 40) history.pop();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(history));
  }

  function renderHistoryDOM(item) {
    if (historyEmpty) historyEmpty.style.display = 'none';

    const div = document.createElement('div');
    div.className = 'history-item';
    const timeStr = item.time ? new Date(item.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Just now';
    const canDownload = item.fileId && sessionReceivedBlobs.has(item.fileId);

    div.innerHTML = `
      <div class="history-item-left">
        <span class="history-item-name">${escapeHTML(item.name)}</span>
        <span class="history-item-meta">${item.size} &bull; ${timeStr}</span>
      </div>
      <div class="history-item-actions">
        ${canDownload ? `<button type="button" class="btn-history-download" data-file-id="${item.fileId}" title="Download this file again"><span>⬇ Download</span></button>` : ''}
        <span class="history-badge-type ${item.type === 'Sent' ? 'type-sent' : 'type-received'}">${item.type}</span>
      </div>
    `;

    if (canDownload) {
      const btn = div.querySelector('.btn-history-download');
      if (btn) {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const cached = sessionReceivedBlobs.get(item.fileId);
          if (cached && cached.objectUrl) {
            triggerFileDownload(cached.objectUrl, cached.name);
            showToast(`Downloading ${cached.name} 💾`);
          } else {
            showToast('⚠️ File expired from memory. Please request a new transfer.');
          }
        });
      }
    }

    historyList.prepend(div);
  }

  function loadAllHistory() {
    const list = getSavedHistory();
    historyList.innerHTML = '';
    if (list.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'history-empty';
      emptyDiv.id = 'historyEmpty';
      emptyDiv.textContent = 'No transfers yet. Connect a second device using the room code or Wi-Fi URL above.';
      historyList.appendChild(emptyDiv);
      if (historyCount) historyCount.textContent = '0 transfers';
      return;
    }

    // Render in reverse so prepend preserves order
    for (let i = list.length - 1; i >= 0; i--) {
      renderHistoryDOM(list[i]);
    }
    if (historyCount) historyCount.textContent = `${list.length} transfer${list.length > 1 ? 's' : ''}`;
  }

  function addHistoryItem(name, size, type, fileId = null) {
    const record = {
      name,
      size,
      type,
      fileId,
      time: Date.now()
    };
    saveHistoryToStorage(record);
    renderHistoryDOM(record);
    const list = getSavedHistory();
    if (historyCount) historyCount.textContent = `${list.length} transfer${list.length > 1 ? 's' : ''}`;
  }

  // Clear History Button
  if (btnHistoryClear) {
    btnHistoryClear.addEventListener('click', () => {
      localStorage.removeItem(STORAGE_KEY);
      loadAllHistory();
      showToast('Transfer history cleared 🗑️');
    });
  }

  // Initial load of saved history
  loadAllHistory();

  function escapeHTML(str) {
    return str.replace(/[&<>'"]/g, 
      tag => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
      }[tag] || tag)
    );
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
    }, 3000);
  }

})();
