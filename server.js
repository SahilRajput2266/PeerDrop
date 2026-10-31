const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');
const os = require('os');

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Favicon fallback endpoint
app.get('/favicon.ico', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'favicon.svg'), {
    headers: { 'Content-Type': 'image/svg+xml' }
  });
});

// Lightweight Keep-Alive ping endpoints for Render / uptime monitors
app.get('/ping', (req, res) => {
  res.status(200).send('pong');
});

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    uptime: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

// Helper to determine the machine's local IPv4 network address
function getNetworkIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      const familyV4Value = typeof net.family === 'string' ? 'IPv4' : 4;
      if (net.family === familyV4Value && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

// Endpoint to provide network IP & port info to clients
app.get('/api/info', (req, res) => {
  const networkIp = getNetworkIp();
  const port = process.env.PORT || 3003;
  res.json({
    networkIp,
    port: Number(port),
    localUrl: `http://localhost:${port}`,
    networkUrl: `http://${networkIp}:${port}`
  });
});

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Room state storage: roomId -> Map(socketId -> { id, name, device })
const rooms = new Map();

io.on('connection', (socket) => {
  let userRoom = null;
  let peerInfo = null;

  function leaveRoom() {
    if (userRoom && rooms.has(userRoom)) {
      const roomPeers = rooms.get(userRoom);
      roomPeers.delete(socket.id);
      socket.to(userRoom).emit('peer:left', socket.id);
      socket.leave(userRoom);

      if (roomPeers.size === 0) {
        rooms.delete(userRoom);
      }
      userRoom = null;
    }
  }

  socket.on('room:join', ({ roomId, clientName, device }) => {
    // If client was already in a room, leave it first
    leaveRoom();

    userRoom = (roomId || 'PD-ZONE').trim().toUpperCase();
    socket.join(userRoom);

    if (!rooms.has(userRoom)) {
      rooms.set(userRoom, new Map());
    }

    const roomPeers = rooms.get(userRoom);
    peerInfo = {
      id: socket.id,
      name: clientName || 'Node-' + socket.id.substring(0, 4),
      device: device || 'Web Client'
    };

    // Notify other peers already in the room
    socket.to(userRoom).emit('peer:joined', peerInfo);

    // Send existing peers list to the newly joined peer
    const existingPeers = Array.from(roomPeers.values());
    socket.emit('room:peers', existingPeers);

    roomPeers.set(socket.id, peerInfo);
  });

  socket.on('peer:update-name', ({ name }) => {
    if (peerInfo && name) {
      peerInfo.name = name.trim();
      if (userRoom && rooms.has(userRoom)) {
        const roomPeers = rooms.get(userRoom);
        roomPeers.set(socket.id, peerInfo);
        socket.to(userRoom).emit('peer:updated', peerInfo);
      }
    }
  });

  socket.on('room:leave', () => {
    leaveRoom();
  });

  // WebRTC Signaling: Offer
  socket.on('signal:offer', ({ targetId, offer }) => {
    socket.to(targetId).emit('signal:offer', {
      senderId: socket.id,
      senderInfo: peerInfo,
      offer
    });
  });

  // WebRTC Signaling: Answer
  socket.on('signal:answer', ({ targetId, answer }) => {
    socket.to(targetId).emit('signal:answer', {
      senderId: socket.id,
      answer
    });
  });

  // WebRTC Signaling: ICE Candidate
  socket.on('signal:candidate', ({ targetId, candidate }) => {
    socket.to(targetId).emit('signal:candidate', {
      senderId: socket.id,
      candidate
    });
  });

  // Disconnect & cleanup
  socket.on('disconnect', () => {
    leaveRoom();
  });
});

// ==========================================================
// Render Free-Tier Keep-Alive Self-Ping Engine (Every 5 Mins)
// ==========================================================
function setupSelfPing() {
  // Render automatically provides RENDER_EXTERNAL_URL (e.g. https://peerdrop.onrender.com)
  // or you can set SELF_PING_URL or PING_URL in your environment variables.
  const rawUrl = process.env.SELF_PING_URL || process.env.PING_URL || process.env.RENDER_EXTERNAL_URL;
  const intervalMinutes = Number(process.env.PING_INTERVAL_MINUTES) || 5;
  const intervalMs = intervalMinutes * 60 * 1000;

  if (!rawUrl) {
    console.log(`  💤 Self-ping: Idle (Set RENDER_EXTERNAL_URL or SELF_PING_URL to activate)`);
    return;
  }

  // Format clean target ping endpoint
  let targetUrl = rawUrl.trim().replace(/\/+$/, '');
  if (!targetUrl.endsWith('/ping')) {
    targetUrl += '/ping';
  }

  console.log(`  ⏱️  Self-ping: Active! Pinging ${targetUrl} every ${intervalMinutes} minutes.`);

  async function pingServer() {
    try {
      const response = await fetch(targetUrl);
      console.log(`  [Self-Ping] ${new Date().toLocaleTimeString()} -> ${targetUrl} (Status: ${response.status})`);
    } catch (err) {
      console.warn(`  [Self-Ping Warning] ${new Date().toLocaleTimeString()} -> ${targetUrl} (${err.message})`);
    }
  }

  // Initial ping 45 seconds after server startup
  setTimeout(pingServer, 45 * 1000);

  // Recurring ping every 5 minutes
  setInterval(pingServer, intervalMs);
}

const PORT = process.env.PORT || 3003;
server.listen(PORT, '0.0.0.0', () => {
  const localIp = getNetworkIp();
  console.log(`===================================================`);
  console.log(`  ⚡ PeerDrop WebRTC Signaling Server active`);
  console.log(`  💻 Local URL:   http://localhost:${PORT}`);
  console.log(`  📶 Network URL: http://${localIp}:${PORT}`);
  setupSelfPing();
  console.log(`===================================================`);
});
