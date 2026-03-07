# 🃏 Multiplayer Uno (2-20 Players)

A high-fidelity, real-time multiplayer Uno game built with **React (TypeScript)** and **Node.js (Socket.IO)**.

## 🚀 Features
- **Capacity:** Supports 2 to 20 players in a single room.
- **Power Stacking:** Stack +2 on +2, +4 on +4, or escalate with a Wild Draw Four.
- **"UNO!" Rule:** Integrated declaration button with a +2 card penalty for forgetting.
- **Last Player Standing:** Ranked finishing system where players finish one by one until a loser is determined.
- **Animations:** High-fidelity card "slam" effects, random rotations, and pulsing turn indicators.
- **Room Management:** Random room code generator and real-time lobby.

## 🛠️ Local Setup

### Prerequisites
- Node.js (v18+)
- npm

### Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/Guhan-VS/Uno.git
   cd Uno
   ```

2. Setup Server:
   ```bash
   cd server
   npm install
   npm run dev
   ```

3. Setup Client:
   ```bash
   cd ../client
   npm install
   npm run dev
   ```

## 🌐 Deployment (Render.com)

### 1. Backend (Web Service)
- **Root Directory:** `server`
- **Build Command:** `npm install`
- **Start Command:** `node index.js`

### 2. Frontend (Static Site)
- **Root Directory:** `client`
- **Build Command:** `npm run build`
- **Publish Directory:** `dist`
- **Environment Variable:** Add `VITE_SERVER_URL` with your Render backend URL.

## 🎮 How to Play
1. Open the app and enter your name.
2. Click **Generate** to create a unique Room Code and share it with up to 19 friends.
3. Once everyone is in the lobby (2+ players), the host can click **START MATCH**.
4. Remember to click the **UNO!** button when you have exactly 2 cards left!

Enjoy your match! 🃏🔥
