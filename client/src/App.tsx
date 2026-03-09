import React, { useState, useEffect, useMemo } from 'react';
import io from 'socket.io-client';
import './App.css';

// Detect environment variable for production, fallback to current hostname for local network play
const SERVER_URL = import.meta.env.VITE_SERVER_URL || `http://${window.location.hostname}:3001`;
const socket = io(SERVER_URL, {
  transports: ['websocket'],
  reconnectionAttempts: Infinity,
});

interface Card { color: string; value: string; }
interface Player { id: string; username: string; hand: Card[]; hasFinished: boolean; unoDeclared: boolean; }
interface GameState { 
  players: Player[]; 
  discardPile: Card[]; 
  currentPlayerIndex: number; 
  gameStarted: boolean; 
  currentWildColor?: string; 
  canPlayDrawnCard?: boolean;
  winners: string[];
  hostId: string;
  drawStack: number;
}

function App() {
  const [userId] = useState(() => {
    const saved = localStorage.getItem('uno_user_id');
    if (saved) return saved;
    const newId = Math.random().toString(36).substr(2, 9);
    localStorage.setItem('uno_user_id', newId);
    return newId;
  });
  const [username, setUsername] = useState(() => localStorage.getItem('uno_username') || '');
  const [roomId, setRoomId] = useState(() => sessionStorage.getItem('uno_room_id') || '');
  const [joined, setJoined] = useState(false);
  const [roomData, setRoomData] = useState<any>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [gameOverData, setGameOverData] = useState<any>(null);
  const [showColorPicker, setShowColorPicker] = useState<number | null>(null);
  const [connected, setConnected] = useState(socket.connected);
  const [notification, setNotification] = useState<string | null>(null);

  useEffect(() => {
    // Keep-alive for Render's free tier (standard HTTP traffic keeps instance active)
    // 45s is safer than 5m to prevent Render's 100s idle timeout
    const keepAlive = setInterval(() => {
      fetch(`${SERVER_URL}/health`).catch(() => {});
    }, 45 * 1000);

    const onConnect = () => {
      setConnected(true);
      console.log(`Socket connected! ID: ${socket.id} | Transport: ${socket.io.engine.transport.name}`);
      // Rejoin if we have room info
      const savedRoom = sessionStorage.getItem('uno_room_id');
      const savedName = localStorage.getItem('uno_username');
      if (savedRoom && savedName) {
        console.log(`Re-joining room ${savedRoom} as ${savedName}`);
        socket.emit('join_room', { roomId: savedRoom, username: savedName, userId });
        setJoined(true);
      }
    };
    const onDisconnect = (reason: string) => {
      setConnected(false);
      console.warn('Socket disconnected:', reason);
    };

    // Auto-sync when user returns to the tab
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && socket.connected && roomId && joined) {
        console.log('Tab became visible, re-syncing game state...');
        socket.emit('join_room', { roomId, username, userId });
      }
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', (err) => console.error('Socket Connection Error:', err));
    socket.on('room_data', (data) => {
      setRoomData(data);
      if (!data.gameStarted && gameState) {
        console.log('Game reset by server (likely restart). Returning to lobby.');
        setGameState(null);
      }
    });
    socket.on('game_state', (state) => setGameState(state));
    socket.on('error', (msg) => { console.error('Server error:', msg); alert(msg); setJoined(false); sessionStorage.removeItem('uno_room_id'); });
    socket.on('game_over', (data) => { 
      setGameOverData(data); 
      setGameState(null); 
      sessionStorage.removeItem('uno_room_id');
    });
    socket.on('notification', (msg) => {
      setNotification(msg);
      setTimeout(() => setNotification(null), 3000);
    });

    document.addEventListener('visibilitychange', handleVisibilityChange);
    if (socket.connected) onConnect();

    return () => {
      clearInterval(keepAlive);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error');
      socket.off('room_data'); socket.off('game_state');
      socket.off('error'); socket.off('game_over');
      socket.off('notification');
    };
  }, [userId, gameState, roomId, username, joined]);

  const generateRoomCode = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
    setRoomId(code);
  };

  const joinRoom = () => { 
    if (username && roomId) { 
      localStorage.setItem('uno_username', username);
      sessionStorage.setItem('uno_room_id', roomId);
      socket.emit('join_room', { roomId, username, userId }); 
      setJoined(true); 
    } 
    else alert('Please enter both name and room code');
  };

  const startGame = () => socket.emit('start_game', roomId);
  const endGameManual = () => socket.emit('end_game_manual', roomId);
  const declareUno = () => socket.emit('declare_uno', roomId);

  const playCard = (cardIndex: number) => {
    const me = (gameState || roomData)?.players.find((p: any) => p.userId === userId);
    const card = me?.hand[cardIndex];
    if (card?.color === 'wild') setShowColorPicker(cardIndex);
    else socket.emit('play_card', { roomId, cardIndex, colorSelection: '' });
  };

  const selectColor = (color: string) => {
    if (showColorPicker !== null) {
      socket.emit('play_card', { roomId, cardIndex: showColorPicker, colorSelection: color });
      setShowColorPicker(null);
    }
  };

  const drawCard = () => socket.emit('draw_card', roomId);
  const passTurn = () => socket.emit('pass_turn', roomId);

  const renderCard = (card: Card, onClick?: () => void, extraStyles?: React.CSSProperties) => {
    const val = card.value === 'Wild Draw Four' ? '+4' : card.value === 'Draw Two' ? '+2' : card.value;
    return (
      <div className={`card ${card.color}`} onClick={onClick} data-value={val} style={extraStyles}>
        <span className="value">{val}</span>
      </div>
    );
  };

  const discardRotations = useMemo(() => {
    if (!gameState) return [];
    return gameState.discardPile.map(() => (Math.random() * 30 - 15).toFixed(2));
  }, [gameState?.discardPile.length]);

  const connectionIndicator = (
    <div style={{
      position: 'fixed', bottom: '10px', left: '10px', fontSize: '12px',
      color: connected ? '#2ecc71' : '#e74c3c', zIndex: 1000,
      background: 'rgba(0,0,0,0.5)', padding: '5px 10px', borderRadius: '10px'
    }}>
      ● {connected ? 'Connected' : 'Reconnecting...'}
    </div>
  );

  if (gameOverData) {
    return (
      <div className="app-container">
        {connectionIndicator}
        <h1>🏁 Game Over! 🏁</h1>
        <div style={{background: 'rgba(255,255,255,0.1)', padding: '30px', borderRadius: '20px', textAlign: 'left', minWidth: '300px'}}>
          <h2 style={{color: '#2ecc71'}}>Winners (Order of Finish):</h2>
          <ol style={{fontSize: '20px'}}>
            {gameOverData.winners.map((name: string, i: number) => <li key={i}>{name}</li>)}
          </ol>
          {gameOverData.loser && (
            <div style={{marginTop: '20px', borderTop: '1px solid white', paddingTop: '10px'}}>
              <h2 style={{color: '#e74c3c'}}>The Loser:</h2>
              <p style={{fontSize: '24px', fontWeight: 'bold'}}>💀 {gameOverData.loser} 💀</p>
            </div>
          )}
        </div>
        <button className="btn btn-start" style={{marginTop: '30px'}} onClick={() => { sessionStorage.removeItem('uno_room_id'); window.location.reload(); }}>Back to Menu</button>
      </div>
    );
  }

  if (!joined) {
    return (
      <div className="app-container">
        {connectionIndicator}
        <div className="join-screen">
          <h1 style={{fontSize: '60px', marginBottom: '30px', fontWeight: '900'}}>UNO</h1>
          <div style={{background: 'rgba(255,255,255,0.1)', padding: '40px', borderRadius: '30px', backdropFilter: 'blur(10px)'}}>
            <input placeholder="Your Name" value={username} onChange={(e) => setUsername(e.target.value)} />
            <div style={{display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', marginTop: '10px'}}>
              <input placeholder="Room Code" value={roomId} onChange={(e) => setRoomId(e.target.value.toUpperCase())} style={{margin: 0}} />
              <button className="btn btn-draw" style={{padding: '12px'}} onClick={generateRoomCode}>Generate</button>
            </div>
            <button className="btn btn-start" style={{marginTop: '20px', width: '100%'}} onClick={joinRoom}>Join Game</button>
          </div>
        </div>
      </div>
    );
  }

  if (joined && !roomData && !gameState) {
    return (
      <div className="app-container">
        {connectionIndicator}
        <h1 style={{marginTop: '100px'}}>Joining Room...</h1>
        <div className="loader" style={{marginTop: '20px'}}></div>
      </div>
    );
  }

  if (gameState && gameState.gameStarted) {
    const currentPlayer = gameState.players[gameState.currentPlayerIndex];
    const isMyTurn = currentPlayer.userId === userId;
    const me = gameState.players.find(p => p.userId === userId);
    const topCard = gameState.discardPile[gameState.discardPile.length - 1];

    if (me?.hasFinished) {
      return (
        <div className="app-container">
          {connectionIndicator}
          <h1 style={{color: '#2ecc71', fontSize: '40px'}}>✨ You Finished! ✨</h1>
          <div className="players-list" style={{marginTop: '40px'}}>
            {gameState.players.map(p => (
              <div key={p.userId} className={`player-info ${p.hasFinished ? 'finished' : ''} ${p.connected === false ? 'disconnected' : ''}`}>
                <div style={{fontWeight: 'bold'}}>{p.username} {p.connected === false ? '(DC)' : ''}</div>
                <div>{p.hasFinished ? '✅ Done' : `🃏 ${p.hand.length}`}</div>
              </div>
            ))}
          </div>
        </div>
      );
    }

    return (
      <div className="app-container">
        {connectionIndicator}
        {notification && <div className="notification-toast">{notification}</div>}
        
        {showColorPicker !== null && (
          <div className="modal-overlay">
            <div className="color-picker">
              <h2 style={{fontSize: '32px', marginBottom: '10px'}}>Pick a Color</h2>
              <div className="color-options">
                {['red', 'blue', 'green', 'yellow'].map(c => <button key={c} className={`color-btn ${c}`} onClick={() => selectColor(c)}></button>)}
              </div>
            </div>
          </div>
        )}

        <div className="game-board">
          {gameState.hostUserId === userId && (
            <button className="btn btn-pass" style={{position: 'absolute', top: '20px', right: '20px', opacity: 0.6}} onClick={endGameManual}>End Game</button>
          )}
          
          <div className="players-list">
            {gameState.players.map((p, i) => (
              <div key={p.userId} className={`player-info ${i === gameState.currentPlayerIndex ? 'active' : ''} ${p.hasFinished ? 'finished' : ''} ${p.unoDeclared ? 'uno-glow' : ''} ${p.connected === false ? 'disconnected' : ''}`}>
                <div style={{fontWeight: 'bold'}}>{p.username} {p.unoDeclared ? '📣 UNO!' : ''} {p.connected === false ? '⚠️' : ''}</div>
                <div>{p.hasFinished ? '✅' : `🃏 ${p.hand.length}`}</div>
              </div>
            ))}
          </div>

          <div className="discard-pile">
            {gameState.drawStack > 0 && (
              <div style={{
                background: '#e74c3c', padding: '10px 25px', borderRadius: '15px', 
                marginBottom: '15px', fontWeight: '900', fontSize: '24px',
                animation: 'pulse 1s infinite', border: '3px solid white'
              }}>
                🔥 STACK: +{gameState.drawStack} 🔥
              </div>
            )}
            
            <div style={{position: 'relative', width: '100px', height: '150px'}}>
              {gameState.discardPile.slice(-5).map((card, idx) => (
                 <div key={idx} style={{position: 'absolute', top: 0, left: 0}}>
                    {renderCard(card, undefined, {
                      '--rotation': `${discardRotations[gameState.discardPile.length - 5 + idx]}deg`
                    } as React.CSSProperties)}
                 </div>
              ))}
            </div>

            {gameState.currentWildColor && (
              <div className="current-wild" style={{backgroundColor: gameState.currentWildColor, marginTop: '20px', boxShadow: `0 0 20px ${gameState.currentWildColor}`}}>
                NEXT COLOR: {gameState.currentWildColor.toUpperCase()}
              </div>
            )}
          </div>

          <h2 style={{margin: '30px 0', fontSize: '32px', color: isMyTurn ? '#f1c40f' : 'white'}}>
            {isMyTurn ? "⭐ YOUR TURN ⭐" : `${currentPlayer.username.toUpperCase()}'S TURN`}
          </h2>

          <div className="hand">
            {me?.hand.map((card, index) => (
              <div key={index} style={{animationDelay: `${index * 0.05}s`}}>
                {renderCard(card, () => isMyTurn && playCard(index))}
              </div>
            ))}
          </div>

          <div className="controls">
            {!gameState.canPlayDrawnCard ? (
              <div style={{display: 'flex', gap: '15px'}}>
                <button className="btn btn-draw" 
                  style={{ background: isMyTurn ? '#e67e22' : '#7f8c8d', fontSize: '20px', padding: '15px 40px' }} 
                  onClick={drawCard} disabled={!isMyTurn}
                >
                  {gameState.drawStack > 0 ? `DRAW ${gameState.drawStack}` : 'DRAW'}
                </button>
                
                {isMyTurn && me?.hand.length === 2 && !me.unoDeclared && (
                  <button className="btn btn-uno" onClick={declareUno}>UNO!</button>
                )}
              </div>
            ) : (
              <div style={{display: 'flex', gap: '20px'}}>
                <button className="btn btn-draw" style={{background: '#27ae60', fontSize: '18px'}} onClick={() => playCard((me?.hand.length || 1) - 1)}>
                  PLAY DRAWN
                </button>
                <button className="btn btn-pass" style={{fontSize: '18px'}} onClick={passTurn}>
                  KEEP & PASS
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      {connectionIndicator}
      <div className="lobby">
        <h1 style={{fontSize: '48px', marginBottom: '10px'}}>LOBBY</h1>
        <div style={{background: 'rgba(255,255,255,0.1)', padding: '40px', borderRadius: '30px', minWidth: '350px'}}>
          <h3 style={{marginBottom: '20px'}}>PLAYERS ({roomData?.players?.length || 0}/20)</h3>
          <ul style={{listStyle: 'none', padding: 0}}>
            {roomData?.players?.map((p: any) => (
              <li key={p.id} style={{padding: '12px', borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: '18px'}}>
                👤 {p.username} {p.id === socket.id ? '(You)' : ''}
              </li>
            ))}
          </ul>
          <div style={{marginTop: '30px'}}>
            {(roomData?.players?.length || 0) >= 2 ? (
              roomData?.hostId === socket.id && <button className="btn btn-start" style={{width: '100%', fontSize: '22px'}} onClick={startGame}>START MATCH</button>
            ) : (
              roomData?.hostId === socket.id && <p style={{color: '#f1c40f'}}>Waiting for 2+ players...</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
