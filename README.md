# KILLER — Live Multiplayer

A small Node.js + Socket.IO multiplayer party game.

## Local test

```bash
npm install
npm start
```

Open http://localhost:10000 in multiple browser tabs/devices on the same network (for LAN testing, use the computer's local IP).

## Deploy

Use a Node Web Service on a host that supports WebSockets. Render Free is suitable for a hobby prototype. Build command: `npm install`; Start command: `npm start`.

The server keeps active rooms in memory. If the free service restarts/spins down, active rooms are lost. Players can reconnect to an existing room while the server is still running because player identity is saved in the browser.

## Game rules implemented

- 5–10 players
- 10 rounds, max 100 points per player
- One random name clue each round: contains A / first letter A–M / more than 5 letters
- Killer is selected from players matching the chosen clue
- Killer secretly eliminates one living player
- No discussion timer
- Start Vote manually
- All player names remain in voting list; eliminated players are disabled
- Killer is a valid vote target; Killer cannot vote
- Eliminated players cannot vote
- Correct innocent guess = +10
- Wrong innocent guess = 0
- If every eligible innocent guesses correctly, Killer = 0; otherwise Killer = +10
- Vote arrows/results are revealed only after voting ends
- Text chat is live to everyone in the room
