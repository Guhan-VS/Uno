require('dotenv').config();
const express = require('express');
const compression = require('compression');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(compression());
app.use(cors());

// Health check for Render/Fly.io to keep instance alive and monitor status
app.get('/health', (req, res) => res.status(200).send('OK'));
app.get('/', (req, res) => res.status(200).send('Uno Server Running'));

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 30000,
  pingInterval: 10000,
  transports: ['websocket', 'polling'], // Prioritize WebSocket
});

const rooms = {};

const createDeck = () => {
  const colors = ['red', 'blue', 'green', 'yellow'];
  const values = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'Skip', 'Reverse', 'Draw Two'];
  let deck = [];
  for (const color of colors) {
    for (const value of values) {
      deck.push({ color, value });
      if (value !== '0') deck.push({ color, value });
    }
  }
  for (let i = 0; i < 4; i++) {
    deck.push({ color: 'wild', value: 'Wild' });
    deck.push({ color: 'wild', value: 'Wild Draw Four' });
  }
  return deck.sort(() => Math.random() - 0.5);
};

const startGame = (roomId) => {
  const room = rooms[roomId];
  room.gameStarted = true;
  room.winners = [];
  room.deck = createDeck();
  room.drawStack = 0;
  
  let firstCard = room.deck.pop();
  while (firstCard.color === 'wild' || ['Skip', 'Reverse', 'Draw Two'].includes(firstCard.value)) {
    room.deck.unshift(firstCard);
    firstCard = room.deck.pop();
  }
  room.discardPile = [firstCard];
  room.currentPlayerIndex = 0;
  room.direction = 1;

  room.players.forEach((player) => {
    player.hand = room.deck.splice(0, 7);
    player.hasFinished = false;
    player.unoDeclared = false;
  });

  return room;
};

const moveToNextPlayer = (room) => {
  let nextIndex = (room.currentPlayerIndex + room.direction + room.players.length) % room.players.length;
  let attempts = 0;
  while (room.players[nextIndex].hasFinished && attempts < room.players.length) {
    nextIndex = (nextIndex + room.direction + room.players.length) % room.players.length;
    attempts++;
  }
  room.currentPlayerIndex = nextIndex;
};

const broadcastGameState = (roomId) => {
  const room = rooms[roomId];
  if (!room) return;

  room.players.forEach((player) => {
    // Sanitize state for each player: hide other players' hands
    const sanitizedPlayers = room.players.map((p) => ({
      id: p.id,
      userId: p.userId,
      username: p.username,
      hand: p.userId === player.userId ? p.hand : new Array(p.hand.length).fill({}),
      handLength: p.hand.length,
      hasFinished: p.hasFinished,
      unoDeclared: p.unoDeclared,
      connected: p.connected,
    }));

    const sanitizedState = {
      ...room,
      players: sanitizedPlayers,
      deck: undefined, // Don't send the deck
    };

    io.to(player.id).emit('game_state', sanitizedState);
  });
};

const broadcastRoomData = (roomId) => {
  const room = rooms[roomId];
  if (!room) return;
  
  const sanitizedPlayers = room.players.map(p => ({
    id: p.id,
    userId: p.userId,
    username: p.username,
    connected: p.connected
  }));

  io.to(roomId).emit('room_data', {
    ...room,
    players: sanitizedPlayers,
    deck: undefined,
    discardPile: undefined
  });
};

io.on('connection', (socket) => {
  console.log(`New connection: ${socket.id}`);

  socket.on('join_room', ({ roomId, username, userId }) => {
    if (!rooms[roomId]) {
      console.log(`Creating new room: ${roomId}`);
      rooms[roomId] = { players: [], gameStarted: false, hostId: socket.id, hostUserId: userId };
    }
    
    socket.join(roomId);
    
    // Check if player is reconnecting
    let player = rooms[roomId].players.find(p => p.userId === userId);
    
    if (player) {
      console.log(`User ${username} reconnected to room ${roomId}`);
      // Reconnection: update socket ID
      player.id = socket.id;
      player.connected = true;
      if (rooms[roomId].hostUserId === userId) rooms[roomId].hostId = socket.id;
    } else {
      if (rooms[roomId].gameStarted) { socket.emit('error', 'Game already started'); return; }
      if (rooms[roomId].players.length >= 20) { socket.emit('error', 'Room full'); return; }
      
      console.log(`User ${username} joined room ${roomId}`);
      player = { 
        id: socket.id, 
        userId, 
        username, 
        hand: [], 
        hasFinished: false, 
        unoDeclared: false,
        connected: true 
      };
      rooms[roomId].players.push(player);
    }
    
    broadcastRoomData(roomId);
    if (rooms[roomId].gameStarted) {
      broadcastGameState(roomId);
    }
  });

  socket.on('disconnecting', () => {
    for (const roomId of socket.rooms) {
      if (rooms[roomId]) {
        const player = rooms[roomId].players.find(p => p.id === socket.id);
        if (player) {
          player.connected = false;
          console.log(`User ${player.username} disconnected from room ${roomId}`);
          broadcastRoomData(roomId);
          if (rooms[roomId].gameStarted) broadcastGameState(roomId);
          // Notify others
          io.to(roomId).emit('notification', `${player.username} disconnected`);
        }
      }
    }
  });

  socket.on('start_game', (roomId) => {
    if (rooms[roomId]) {
      console.log(`Starting game in room ${roomId}`);
      startGame(roomId);
      broadcastGameState(roomId);
    }
  });

  socket.on('declare_uno', (roomId) => {
    const room = rooms[roomId];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (player) {
      player.unoDeclared = true;
      console.log(`[Room ${roomId}] ${player.username} declared UNO!`);
      broadcastGameState(roomId);
      io.to(roomId).emit('notification', `${player.username} declared UNO!`);
    }
  });

  socket.on('play_card', ({ roomId, cardIndex, colorSelection }) => {
    const room = rooms[roomId];
    if (!room) return;
    const player = room.players[room.currentPlayerIndex];
    if (!player || player.id !== socket.id) return; 

    const card = player.hand[cardIndex];
    if (!card) return;
    
    const topCard = room.discardPile[room.discardPile.length - 1];

    let isPlayable = false;

    if (room.drawStack > 0) {
      if (topCard.value === 'Draw Two') {
        if (card.value === 'Draw Two') isPlayable = true;
        if (card.value === 'Wild Draw Four' && room.drawStack % 4 === 0) isPlayable = true;
      } else if (topCard.value === 'Wild Draw Four') {
        if (card.value === 'Wild Draw Four') isPlayable = true;
      }
    } else {
      isPlayable = card.color === 'wild' || card.color === topCard.color || card.value === topCard.value || (topCard.color === 'wild' && card.color === room.currentWildColor);
    }

    if (isPlayable) {
      console.log(`[Room ${roomId}] ${player.username} played ${card.value} of ${card.color}`);
      
      // Check for UNO penalty
      if (player.hand.length === 2 && !player.unoDeclared) {
        console.log(`[Room ${roomId}] ${player.username} forgot to say UNO! Penalty applied.`);
        for (let i = 0; i < 2; i++) {
          if (room.deck.length < 2) {
            const top = room.discardPile.pop();
            room.deck.push(...room.discardPile.sort(() => Math.random() - 0.5));
            room.discardPile = [top];
          }
          player.hand.push(room.deck.pop());
        }
        io.to(roomId).emit('notification', `${player.username} forgot to say UNO! +2 Penalty`);
      }

      player.hand.splice(cardIndex, 1);
      room.discardPile.push(card);
      room.canPlayDrawnCard = false;
      room.currentWildColor = card.color === 'wild' ? colorSelection : null;

      if (card.value === 'Draw Two') room.drawStack += 2;
      else if (card.value === 'Wild Draw Four') room.drawStack += 4;

      if (player.hand.length === 0) {
        player.hasFinished = true;
        console.log(`[Room ${roomId}] ${player.username} finished the game!`);
        room.winners.push(player.username);
        const remaining = room.players.filter(p => !p.hasFinished);
        if (remaining.length <= 1) {
          console.log(`[Room ${roomId}] Game Over! Winners: ${room.winners.join(', ')}`);
          io.to(roomId).emit('game_over', { winners: room.winners, loser: remaining[0]?.username });
          delete rooms[roomId];
          return;
        }
      }

      // Reset uno declaration if hand size > 1
      if (player.hand.length > 1) player.unoDeclared = false;

      if (card.value === 'Skip' && room.drawStack === 0) {
        moveToNextPlayer(room);
        moveToNextPlayer(room);
      } else if (card.value === 'Reverse' && room.drawStack === 0) {
        if (room.players.filter(p => !p.hasFinished).length === 2) moveToNextPlayer(room);
        else { room.direction *= -1; moveToNextPlayer(room); }
      } else {
        moveToNextPlayer(room);
      }

      broadcastGameState(roomId);
    }
  });

  socket.on('draw_card', (roomId) => {
    const room = rooms[roomId];
    if (!room) return;
    const player = room.players[room.currentPlayerIndex];
    if (!player || player.id !== socket.id) return;

    player.unoDeclared = false; // Reset if drawing
    console.log(`[Room ${roomId}] ${player.username} is drawing cards`);

    if (room.drawStack > 0) {
      for (let i = 0; i < room.drawStack; i++) {
        if (room.deck.length < 2) {
          const top = room.discardPile.pop();
          room.deck.push(...room.discardPile.sort(() => Math.random() - 0.5));
          room.discardPile = [top];
        }
        player.hand.push(room.deck.pop());
      }
      room.drawStack = 0;
      moveToNextPlayer(room);
    } else {
      if (room.deck.length < 2) {
        const top = room.discardPile.pop();
        room.deck.push(...room.discardPile.sort(() => Math.random() - 0.5));
        room.discardPile = [top];
      }
      const drawn = room.deck.pop();
      player.hand.push(drawn);
      const top = room.discardPile[room.discardPile.length - 1];
      const isPlayable = drawn.color === 'wild' || drawn.color === top.color || drawn.value === top.value || (top.color === 'wild' && drawn.color === room.currentWildColor);
      if (isPlayable) {
        room.canPlayDrawnCard = true;
        console.log(`[Room ${roomId}] Drawn card is playable for ${player.username}`);
      }
      else { moveToNextPlayer(room); room.canPlayDrawnCard = false; }
    }
    broadcastGameState(roomId);
  });

  socket.on('pass_turn', (roomId) => {
    const room = rooms[roomId];
    if (!room) return;
    const player = room.players[room.currentPlayerIndex];
    if (!player || player.id !== socket.id) return;

    console.log(`[Room ${roomId}] ${player.username} passed turn`);
    moveToNextPlayer(room);
    room.canPlayDrawnCard = false;
    broadcastGameState(roomId);
  });

  socket.on('end_game_manual', (roomId) => {
    if (rooms[roomId]) {
      console.log(`[Room ${roomId}] Manual end game requested`);
      io.to(roomId).emit('game_over', { winners: rooms[roomId].winners, forced: true });
      delete rooms[roomId];
    }
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`\n🚀 Uno Multiplayer Server running on port ${PORT}`);
  console.log(`📅 Started at: ${new Date().toLocaleString()}`);
  console.log(`📦 Node Version: ${process.version}`);
  console.log('-------------------------------------------\n');
});
