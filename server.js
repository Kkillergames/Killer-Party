const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, credentials: false }
});

const PORT = process.env.PORT || 10000;
const TOTAL_ROUNDS = 10;
const MAX_PLAYERS = 10;
const MIN_PLAYERS = 5;
const rooms = new Map();

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true }));

function cleanName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ').slice(0, 15);
}
function makeId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-5);
}
function makeRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  do {
    code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}
function playerPublic(p) {
  return {
    id: p.id,
    name: p.name,
    alive: p.alive,
    connected: p.connected,
    isHost: p.id === p.hostId
  };
}
function publicPlayers(room) {
  return room.players.map(p => playerPublic({ ...p, hostId: room.hostId }));
}
function clueMatches(clue, name) {
  const n = String(name || '').trim();
  const upper = n.toUpperCase();
  if (clue === "Killer-এর নামের মধ্যে 'A' আছে") return upper.includes('A');
  if (clue === 'Killer-এর নামের প্রথম অক্ষর A–M এর মধ্যে') return /^[A-M]/.test(upper);
  if (clue === 'Killer-এর নাম 5 অক্ষরের বেশি') return n.length > 5;
  return false;
}
function chooseKiller(room) {
  const clues = [
    "Killer-এর নামের মধ্যে 'A' আছে",
    'Killer-এর নামের প্রথম অক্ষর A–M এর মধ্যে',
    'Killer-এর নাম 5 অক্ষরের বেশি'
  ];
  const valid = clues.filter(clue => room.players.some(p => clueMatches(clue, p.name)));
  // A clue must always have at least one matching player. If none of the
  // three clues can match the current names, fall back to a safe clue/player
  // pair instead of crashing the round.
  if (!valid.length) {
    const killer = room.players[Math.floor(Math.random() * room.players.length)];
    return { clue: 'Killer-এর নামের 5 অক্ষরের বেশি', killer };
  }
  const clue = valid[Math.floor(Math.random() * valid.length)];
  const eligible = room.players.filter(p => clueMatches(clue, p.name));
  const killer = eligible[Math.floor(Math.random() * eligible.length)];
  return { clue, killer };
}
function getRoom(socket) {
  return rooms.get(socket.data.roomCode);
}
function getPlayer(room, playerId) {
  return room?.players.find(p => p.id === playerId);
}
function sendState(room) {
  for (const p of room.players) {
    if (!p.socketId) continue;
    const socket = io.sockets.sockets.get(p.socketId);
    if (!socket) continue;
    socket.emit('state', stateForPlayer(room, p));
  }
}
function stateForPlayer(room, player) {
  const result = room.phase === 'result' ? room.lastResult : null;
  return {
    roomCode: room.code,
    hostId: room.hostId,
    phase: room.phase,
    round: room.round,
    totalRounds: TOTAL_ROUNDS,
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    players: publicPlayers(room),
    clue: room.clue,
    victimId: room.victimId,
    yourId: player.id,
    yourRole: room.killerId === player.id ? 'killer' : 'innocent',
    canKill: room.phase === 'kill' && room.killerId === player.id,
    canStartVote: room.phase === 'discussion' && player.alive && room.killerId !== player.id,
    canVote: room.phase === 'vote' && player.alive && room.killerId !== player.id,
    voted: !!room.votes[player.id],
    votesSubmitted: Object.keys(room.votes).length,
    eligibleVoters: room.players.filter(p => p.alive && p.id !== room.killerId).length,
    lastResult: result,
    scores: room.players.map(p => ({ id: p.id, name: p.name, score: p.score }))
  };
}
function emitError(socket, message) {
  socket.emit('gameError', message);
}
function emitSystem(room, message) {
  for (const p of room.players) {
    if (!p.socketId) continue;
    io.to(p.socketId).emit('systemMessage', message);
  }
}
function ensureHost(room) {
  const host = room.players.find(p => p.id === room.hostId);
  if (host && host.connected) return;
  const next = room.players.find(p => p.connected);
  if (next) room.hostId = next.id;
}
function startRound(room) {
  room.phase = 'kill';
  room.votes = {};
  room.victimId = null;
  room.lastResult = null;
  room.players.forEach(p => { p.alive = true; });
  const picked = chooseKiller(room);
  room.clue = picked.clue;
  room.killerId = picked.killer.id;
  sendState(room);
  emitSystem(room, `Round ${room.round} started.`);
}
function allVotesIn(room) {
  const eligible = room.players.filter(p => p.alive && p.connected && p.id !== room.killerId);
  return eligible.length > 0 && eligible.every(p => room.votes[p.id]);
}
function finishVoting(room) {
  if (!allVotesIn(room)) return;
  const killerId = room.killerId;
  const eligible = room.players.filter(p => p.alive && p.connected && p.id !== killerId);
  const correct = [];
  const wrong = [];
  const voteRows = [];
  for (const voter of eligible) {
    const targetId = room.votes[voter.id];
    const target = room.players.find(p => p.id === targetId);
    if (!target) continue;
    const isCorrect = target.id === killerId;
    if (isCorrect) { voter.score += 10; correct.push(voter.name); }
    else wrong.push(voter.name);
    voteRows.push({ voterId: voter.id, voterName: voter.name, targetId: target.id, targetName: target.name, correct: isCorrect });
  }
  const killer = room.players.find(p => p.id === killerId);
  if (wrong.length > 0) killer.score += 10;
  room.lastResult = {
    killerId,
    killerName: killer.name,
    victimId: room.victimId,
    victimName: room.players.find(p => p.id === room.victimId)?.name || 'Unknown',
    voteRows,
    correctCount: correct.length,
    wrongCount: wrong.length,
    killerPoints: wrong.length > 0 ? 10 : 0
  };
  room.phase = 'result';
  sendState(room);
}

io.on('connection', socket => {
  socket.on('createGame', ({ name }) => {
    name = cleanName(name);
    if (!name) return emitError(socket, 'Enter your name first.');
    const code = makeRoomCode();
    const player = { id: makeId(), name, alive: true, score: 0, connected: true, socketId: socket.id };
    const room = {
      code,
      hostId: player.id,
      players: [player],
      phase: 'lobby',
      round: 0,
      clue: '',
      killerId: null,
      victimId: null,
      votes: {},
      lastResult: null
    };
    rooms.set(code, room);
    socket.data.roomCode = code;
    socket.data.playerId = player.id;
    socket.emit('created', { roomCode: code, playerId: player.id });
    sendState(room);
  });

  socket.on('joinGame', ({ name, roomCode, playerId }) => {
    name = cleanName(name);
    roomCode = String(roomCode || '').trim().toUpperCase();
    const room = rooms.get(roomCode);
    if (!room) return emitError(socket, 'Room not found. Ask the host for the current room code.');

    let player = playerId ? getPlayer(room, playerId) : null;
    if (player) {
      player.socketId = socket.id;
      player.connected = true;
      socket.data.roomCode = roomCode;
      socket.data.playerId = player.id;
      socket.emit('joined', { roomCode, playerId: player.id, reconnected: true });
      sendState(room);
      emitSystem(room, `${player.name} reconnected.`);
      return;
    }
    if (!name) return emitError(socket, 'Enter your name first.');
    if (room.phase !== 'lobby' && !playerId) return emitError(socket, 'This game has already started.');
    if (room.players.length >= MAX_PLAYERS) return emitError(socket, 'Room is full (maximum 10 players).');
    if (room.players.some(p => p.name.toLowerCase() === name.toLowerCase())) return emitError(socket, 'That name is already in the room.');
    player = { id: makeId(), name, alive: true, score: 0, connected: true, socketId: socket.id };
    room.players.push(player);
    socket.data.roomCode = roomCode;
    socket.data.playerId = player.id;
    socket.emit('joined', { roomCode, playerId: player.id, reconnected: false });
    sendState(room);
    emitSystem(room, `${player.name} joined the room.`);
  });

  socket.on('startGame', () => {
    const room = getRoom(socket);
    const player = room && getPlayer(room, socket.data.playerId);
    if (!room || !player) return;
    if (room.hostId !== player.id) return emitError(socket, 'Only the host can start the game.');
    if (room.players.length < MIN_PLAYERS) return emitError(socket, `Need at least ${MIN_PLAYERS} players.`);
    room.round = 1;
    room.players.forEach(p => p.score = 0);
    startRound(room);
  });

  socket.on('killPlayer', ({ targetId }) => {
    const room = getRoom(socket);
    const player = room && getPlayer(room, socket.data.playerId);
    if (!room || !player || room.phase !== 'kill') return;
    if (room.killerId !== player.id) return emitError(socket, 'Only the Killer can eliminate a player.');
    const target = getPlayer(room, targetId);
    if (!target || !target.alive || target.id === room.killerId) return emitError(socket, 'Invalid target.');
    target.alive = false;
    room.victimId = target.id;
    room.phase = 'discussion';
    sendState(room);
    emitSystem(room, `💀 ${target.name} has been eliminated.`);
  });

  socket.on('startVote', () => {
    const room = getRoom(socket);
    const player = room && getPlayer(room, socket.data.playerId);
    if (!room || !player || room.phase !== 'discussion') return;
    if (!player.alive || room.killerId === player.id) return emitError(socket, 'You cannot start the vote right now.');
    room.phase = 'vote';
    room.votes = {};
    sendState(room);
    emitSystem(room, '🗳️ Voting has started.');
  });

  socket.on('castVote', ({ targetId }) => {
    const room = getRoom(socket);
    const player = room && getPlayer(room, socket.data.playerId);
    if (!room || !player || room.phase !== 'vote') return;
    if (!player.alive || room.killerId === player.id) return emitError(socket, 'You cannot vote.');
    if (room.votes[player.id]) return emitError(socket, 'You already voted.');
    const target = getPlayer(room, targetId);
    if (!target || !target.alive) return emitError(socket, 'That player is eliminated.');
    room.votes[player.id] = target.id;
    sendState(room);
    finishVoting(room);
  });

  socket.on('nextRound', () => {
    const room = getRoom(socket);
    const player = room && getPlayer(room, socket.data.playerId);
    if (!room || !player || room.phase !== 'result') return;
    if (room.hostId !== player.id) return emitError(socket, 'Only the host can start the next round.');
    if (room.round >= TOTAL_ROUNDS) {
      room.phase = 'final';
      sendState(room);
      return;
    }
    room.round += 1;
    startRound(room);
  });

  socket.on('keepAlive', () => {
    const room = getRoom(socket);
    if (room) room.lastTouched = Date.now();
    socket.emit('keepAliveAck');
  });

  socket.on('chat', ({ message }) => {
    const room = getRoom(socket);
    const player = room && getPlayer(room, socket.data.playerId);
    const text = String(message || '').trim().slice(0, 200);
    if (!room || !player || !text) return;
    for (const p of room.players) {
      if (p.socketId) io.to(p.socketId).emit('chat', { playerId: player.id, playerName: player.name, message: text });
    }
  });

  socket.on('disconnect', () => {
    const room = getRoom(socket);
    const player = room && getPlayer(room, socket.data.playerId);
    if (!room || !player) return;
    player.connected = false;
    player.socketId = null;
    if (room.hostId === player.id) ensureHost(room);
    sendState(room);
    emitSystem(room, `${player.name} disconnected.`);
    if (room.phase === 'vote') finishVoting(room);
    room.lastTouched = Date.now();
  });
});

setInterval(() => {
  // Remove abandoned lobby rooms after 2 hours; active games stay until all players leave.
  const now = Date.now();
  for (const [code, room] of rooms) {
    room.lastTouched = room.lastTouched || now;
    const connected = room.players.some(p => p.connected);
    if (!connected && now - room.lastTouched > 2 * 60 * 60 * 1000) rooms.delete(code);
  }
}, 60 * 1000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`KILLER server running on port ${PORT}`);
});
