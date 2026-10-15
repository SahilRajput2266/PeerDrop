const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

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

  socket.on('room:join', ({ roomId, clientName, device }) => {
    userRoom = roomId || 'peer-zone';
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
    if (userRoom && rooms.has(userRoom)) {
      const roomPeers = rooms.get(userRoom);
      roomPeers.delete(socket.id);
      socket.to(userRoom).emit('peer:left', socket.id);

      if (roomPeers.size === 0) {
        rooms.delete(userRoom);
      }
    }
  });
});

const PORT = process.env.PORT || 5050;
server.listen(PORT, () => {
  console.log(`===================================================`);
  console.log(`  ⚡ PeerDrop WebRTC Signaling Server on port ${PORT}`);
  console.log(`  🌐 Local URL: http://localhost:${PORT}`);
  console.log(`===================================================`);
});
