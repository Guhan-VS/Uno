require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
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
  while (room.players[nextIndex].hasFinished) {
    nextIndex = (nextIndex + room.direction + room.players.length) % room.players.length;
  }
  room.currentPlayerIndex = nextIndex;
};

io.on('connection', (socket) => {
  socket.on('join_room', ({ roomId, username }) => {
    if (!rooms[roomId]) rooms[roomId] = { players: [], gameStarted: false, hostId: socket.id };
    if (rooms[roomId].gameStarted) { socket.emit('error', 'Game already started'); return; }
    if (rooms[roomId].players.length >= 20) { socket.emit('error', 'Room full'); return; }
    
    socket.join(roomId);
    const existing = rooms[roomId].players.find(p => p.id === socket.id);
    if (!existing) rooms[roomId].players.push({ id: socket.id, username, hand: [], hasFinished: false, unoDeclared: false });
    
    io.to(roomId).emit('room_data', rooms[roomId]);
    socket.emit('room_data', rooms[roomId]);
  });

  socket.on('start_game', (roomId) => {
    const room = startGame(roomId);
    io.to(roomId).emit('game_state', room);
  });

  socket.on('declare_uno', (roomId) => {
    const room = rooms[roomId];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (player) {
      player.unoDeclared = true;
      io.to(roomId).emit('game_state', room);
      io.to(roomId).emit('notification', `${player.username} declared UNO!`);
    }
  });

  socket.on('play_card', ({ roomId, cardIndex, colorSelection }) => {
    const room = rooms[roomId];
    const player = room.players[room.currentPlayerIndex];
    const card = player.hand[cardIndex];
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
      // Check for UNO penalty
      if (player.hand.length === 2 && !player.unoDeclared) {
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
        room.winners.push(player.username);
        const remaining = room.players.filter(p => !p.hasFinished);
        if (remaining.length <= 1) {
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

      io.to(roomId).emit('game_state', room);
    }
  });

  socket.on('draw_card', (roomId) => {
    const room = rooms[roomId];
    const player = room.players[room.currentPlayerIndex];
    player.unoDeclared = false; // Reset if drawing

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
      if (isPlayable) room.canPlayDrawnCard = true;
      else { moveToNextPlayer(room); room.canPlayDrawnCard = false; }
    }
    io.to(roomId).emit('game_state', room);
  });

  socket.on('pass_turn', (roomId) => {
    const room = rooms[roomId];
    moveToNextPlayer(room);
    room.canPlayDrawnCard = false;
    io.to(roomId).emit('game_state', room);
  });

  socket.on('end_game_manual', (roomId) => {
    if (rooms[roomId]) {
      io.to(roomId).emit('game_over', { winners: rooms[roomId].winners, forced: true });
      delete rooms[roomId];
    }
  });
});

server.listen(3001, () => console.log('Server running on 3001'));
