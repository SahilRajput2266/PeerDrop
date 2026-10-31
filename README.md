# ⚡ PeerDrop

<div align="center">

<img src="https://capsule-render.vercel.app/api?type=waving&color=gradient&customColorList=1,12,24,30&height=180&section=header&text=PeerDrop&fontSize=50&fontColor=10B981&animation=fadeIn&fontAlignY=38&desc=Zero-Knowledge%20P2P%20Encrypted%20File%20Sharing%20via%20WebRTC&descAlignY=58&descSize=18" width="100%" alt="PeerDrop Banner" />

<p align="center">
  <strong>Zero-Knowledge Peer-to-Peer Encrypted File Sharing & Direct Streaming over WebRTC Data Channels.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Protocol-WebRTC_DataChannel-10B981?style=for-the-badge&logo=webrtc&logoColor=white" />
  <img src="https://img.shields.io/badge/Signaling-WebSocket_%2F_Socket.io-010101?style=for-the-badge&logo=socketdotio&logoColor=white" />
  <img src="https://img.shields.io/badge/Storage-Zero_Server_Footprint-38BDF8?style=for-the-badge" />
  <img src="https://img.shields.io/badge/License-MIT-F59E0B?style=for-the-badge" />
</p>

<p align="center">
  <a href="#-features">Key Features</a> &bull;
  <a href="#-architecture">Architecture</a> &bull;
  <a href="#-quick-start">Quick Start</a> &bull;
  <a href="#-deploying-on-render">Deploy on Render</a> &bull;
  <a href="#-author">Author</a>
</p>

</div>

---

## 🌟 Overview

**PeerDrop** is a privacy-first, ultra-fast file transfer utility that transfers files directly between devices (Browser to Browser) using **WebRTC DataChannels**. 

No files ever touch the server. The Node.js signaling server only acts as a lightweight meeting room to exchange SDP offers and ICE candidates. Once the WebRTC peer connection is established, data packets stream directly over encrypted peer-to-peer tunnels at maximum local network / internet bandwidth speeds.

---

## 🚀 Key Features

* **🔒 Zero-Knowledge Privacy:** Files are never uploaded, stored, or cached on any intermediary server or database.
* **⚡ High-Throughput Binary Streaming:** Files are sliced into 64KB chunks and streamed through `RTCDataChannel` with active buffer backpressure management.
* **📱 Cross-Platform Pairing:** Seamlessly transfer files between Windows, macOS, Linux, iOS (iPhone/iPad), and Android by sharing a room code or invite URL.
* **🎯 Live Radar Scanner HUD:** Cyberpunk / Obsidian dark UI featuring an animated radar scanner displaying connected peers as interactive nodes.
* **📊 Real-Time Transfer Metrics:** Live transfer percentage, current transfer speed (MB/s), elapsed time, and automatic file download upon chunk reassembly.
* **🔄 Persistent Sessions:** Room IDs and transfer history survive page refreshes through browser local storage.
* **⏱️ Automatic Self-Ping Keep-Alive:** Built-in 5-minute self-ping engine prevents free-tier platforms (like Render) from sleeping.

---

## 🏗️ Architecture

```
┌──────────────────┐                               ┌──────────────────┐
│   Local Device   │                               │   Remote Peer    │
│  (Laptop/Mobile) │                               │  (Phone/Desktop) │
└─────────┬────────┘                               └─────────┬────────┘
          │                                                  │
          │         1. SDP Offer/Answer & ICE Candidates     │
          ├─────────────────► [Signaling Server] ────────────┤
          │                                                  │
          │══════════════════════════════════════════════════│
          │    2. Direct Encrypted WebRTC DataChannel        │
          │       (64KB Binary Stream - Zero Server)         │
          │◄────────────────────────────────────────────────►│
```

---

## ⚡ Quick Start

### 1. Clone & Install
```bash
git clone https://github.com/SahilRajput2266/PeerDrop.git
cd PeerDrop
npm install
```

### 2. Run Locally
```bash
npm start
```

Open your browser at:
```
http://localhost:3003
```

To test P2P file transfer:
1. Open `http://localhost:3003` on Device 1.
2. Click **"Share Link"** or note the Room ID.
3. Open the link on Device 2 (or on your phone connected to the same Wi-Fi).
4. Drag and drop any file — watch it stream in real time and auto-download!

---

## ☁️ Deploying on Render (Free Tier Keep-Alive)

Render free-tier Web Services go to sleep after 15 minutes of inactivity. **PeerDrop includes an automatic 5-minute self-ping engine to keep the instance active:**

1. Create a **New Web Service** on [Render.com](https://render.com) and connect your GitHub repo.
2. **Build Command:** `npm install`
3. **Start Command:** `npm start`
4. **Zero-Configuration Keep-Alive:**
   - Render automatically provides `RENDER_EXTERNAL_URL` (e.g., `https://peerdrop.onrender.com`).
   - PeerDrop automatically detects this variable and starts pinging `/ping` every 5 minutes.
   - You can also manually set `SELF_PING_URL=https://your-app-name.onrender.com` in Render's Environment settings.
   - Custom ping interval can be configured with `PING_INTERVAL_MINUTES=5` (default: 5).

### Health & Keep-Alive Endpoints:
- `GET /ping` -> returns `pong` (lightweight 200 OK)
- `GET /health` -> returns `{ status: "ok", uptime: ..., timestamp: ... }`

---

## 👨‍💻 Author

**Sahil Chauhan (Sahil Rajput)**
* GitHub: [@SahilRajput2266](https://github.com/SahilRajput2266)
* Email: [sahilrajput6244@gmail.com](mailto:sahilrajput6244@gmail.com)
* LinkedIn: [Sahil Chauhan](https://www.linkedin.com/in/sahil-chauhan-6bb687237)
