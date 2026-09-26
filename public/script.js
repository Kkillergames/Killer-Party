const socket = io({ transports: ['websocket', 'polling'] });
const $ = id => document.getElementById(id);
const TOTAL_ROUNDS = 10;
let state = null;
let playerId = localStorage.getItem('killer_player_id') || '';
let roomCode = localStorage.getItem('killer_room_code') || '';
let reconnecting = false;

function show(id){document.querySelectorAll('.screen').forEach(x=>x.classList.remove('active'));$(id).classList.add('active');}
function esc(v){const d=document.createElement('div');d.textContent=String(v??'');return d.innerHTML;}
function toast(msg){const t=$('toast');t.textContent=msg;t.classList.add('show');clearTimeout(window.__toast);window.__toast=setTimeout(()=>t.classList.remove('show'),2400);}
function homeMsg(msg){$('homeMessage').textContent=msg||'';}
function saveIdentity(){if(playerId)localStorage.setItem('killer_player_id',playerId);if(roomCode)localStorage.setItem('killer_room_code',roomCode);}
function clearIdentity(){localStorage.removeItem('killer_player_id');localStorage.removeItem('killer_room_code');playerId='';roomCode='';}
function me(){return state?.players.find(p=>p.id===state.yourId);}

$('showJoinBtn').onclick=()=>{$('joinPanel').classList.remove('hidden');$('roomCodeInput').focus();};
$('createBtn').onclick=()=>{const name=$('playerName').value.trim();if(!name)return homeMsg('Enter your name first.');socket.emit('createGame',{name});};
$('joinBtn').onclick=()=>{const name=$('playerName').value.trim();const code=$('roomCodeInput').value.trim().toUpperCase();if(!name)return homeMsg('Enter your name first.');if(!/^[A-Z0-9]{6}$/.test(code))return homeMsg('Enter a valid 6-character room code.');socket.emit('joinGame',{name,roomCode:code,playerId: playerId && roomCode===code ? playerId : ''});};
$('startBtn').onclick=()=>socket.emit('startGame');
$('leaveBtn').onclick=()=>{clearIdentity();location.reload();};
$('backHomeBtn').onclick=()=>{clearIdentity();location.reload();};
$('copyRoomBtn').onclick=async()=>{try{await navigator.clipboard.writeText(state.roomCode);toast('Room code copied.');}catch{toast(`Room code: ${state.roomCode}`);}};
$('sendChatBtn').onclick=sendChat;
$('chatInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();sendChat();}});
function sendChat(){const input=$('chatInput');const message=input.value.trim();if(!message)return;socket.emit('chat',{message});input.value='';input.focus();}

socket.on('connect',()=>{
  if(playerId && roomCode && !reconnecting){
    reconnecting=true;
    socket.emit('joinGame',{name:'',roomCode,playerId});
  }
});
socket.on('created',d=>{playerId=d.playerId;roomCode=d.roomCode;saveIdentity();homeMsg('');});
socket.on('joined',d=>{playerId=d.playerId;roomCode=d.roomCode;saveIdentity();$('playerName').value='';reconnecting=false;});
socket.on('gameError',msg=>{homeMsg(msg);toast(msg);});
socket.on('systemMessage',msg=>appendChat('System',msg,true));
socket.on('chat',d=>appendChat(d.playerName,d.message,false));
socket.on('state',s=>{state=s;render();});
setInterval(()=>{if(state && state.phase!=='lobby' && socket.connected) socket.emit('keepAlive');}, 5*60*1000);

function appendChat(name,message,system){const box=$('chatBox');if(!box)return;const div=document.createElement('div');div.className=`chat-message ${system?'system':''}`;div.innerHTML=system?`• ${esc(message)}`:`<b>${esc(name)}:</b> ${esc(message)}`;box.appendChild(div);box.scrollTop=box.scrollHeight;}
function render(){if(!state)return;if(state.phase==='lobby')renderLobby();else if(state.phase==='final')renderFinal();else renderGame();}
function renderLobby(){show('lobby');$('roomCode').textContent=state.roomCode;$('playerCount').textContent=`${state.players.length}/${state.maxPlayers}`;const list=$('playerList');list.innerHTML=state.players.map(p=>`<div class="player"><span>${p.isHost?'👑 ':''}${esc(p.name)}</span><small>${p.connected?'● online':'○ offline'}</small></div>`).join('');const start=$('startBtn');start.disabled=state.yourId!==state.hostId||state.players.length<state.minPlayers;start.textContent=state.yourId===state.hostId?'▶️ Start Game':'⏳ Waiting for host';}
function renderGame(){show('game');$('roundText').textContent=`Round ${state.round} / ${state.totalRounds}`;const role=$('roleCard');role.className=`role-card ${state.yourRole}`;role.innerHTML=state.yourRole==='killer'?`<div class="role-main">🔪 KILLER</div><div class="role-sub">Choose one player to eliminate.</div>`:`<div class="role-main">👤 INNOCENT</div><div class="role-sub">Find the Killer. Keep your role secret.</div>`;const p=$('phaseTitle'),d=$('phaseDescription'),a=$('actionArea');a.innerHTML='';if(state.phase==='kill')renderKill(p,d,a);else if(state.phase==='discussion')renderDiscussion(p,d,a);else if(state.phase==='vote')renderVote(p,d,a);else if(state.phase==='result')renderResult(p,d,a);}
function renderKill(p,d,a){p.textContent='🔪 Killer Phase';d.textContent=state.canKill?'Choose one player.':'The Killer is choosing...';if(state.canKill){const targets=state.players.filter(x=>x.alive&&x.id!==state.yourId);a.innerHTML='<div class="action-grid">'+targets.map(x=>`<button class="action-btn kill" data-kill="${x.id}">🔪 ${esc(x.name)}</button>`).join('')+'</div>';a.querySelectorAll('[data-kill]').forEach(b=>b.onclick=()=>socket.emit('killPlayer',{targetId:b.dataset.kill}));}else a.innerHTML='<div class="info">⏳ Waiting for the Killer.</div>';}
function renderDiscussion(p,d,a){p.textContent='💬 Discussion';d.textContent='Discuss as long as you need. No timer.';const victim=state.players.find(x=>x.id===state.victimId);a.innerHTML=`<div class="clue">💡 <strong>Clue:</strong> ${esc(state.clue)}</div><div class="victim">💀 <strong>${esc(victim?.name||'Player')}</strong> has been eliminated.</div>`+(state.canStartVote?'<button id="startVoteBtn" class="action-btn green">🗳️ Start Vote</button>':'<div class="info">🗣️ Discussion is open. Wait for someone to start the vote.</div>');const b=$('startVoteBtn');if(b)b.onclick=()=>socket.emit('startVote');}
function renderVote(p,d,a){p.textContent='🗳️ Vote';d.textContent=state.canVote?'Who do you think is the Killer?':'You are watching the vote.';const rows=state.players.map(x=>`<button class="vote-target ${x.alive?'':'dead'}" ${x.alive&&state.canVote&&!state.voted?'':'disabled'} data-vote="${x.id}">${x.alive?'👤':'💀'} ${esc(x.name)}${x.id===state.yourId?' (you)':''}${x.alive?'':' — eliminated'}</button>`).join('');a.innerHTML=`<div class="vote-grid">${rows}</div><div class="vote-progress">🗳️ ${state.votesSubmitted}/${state.eligibleVoters} votes submitted</div>`;a.querySelectorAll('[data-vote]').forEach(b=>b.onclick=()=>{socket.emit('castVote',{targetId:b.dataset.vote});});}
function renderResult(p,d,a){p.textContent='📊 Round Result';d.textContent='The round is complete.';const r=state.lastResult;if(!r)return;a.innerHTML=`<div class="result"><div class="muted small">🔎 The Killer was</div><div class="result-killer">🔪 ${esc(r.killerName)}</div><div class="victim">💀 Eliminated: <strong>${esc(r.victimName)}</strong></div><div style="margin-top:9px"><strong>🗳️ Votes</strong>${r.voteRows.map(v=>`<div class="vote-row ${v.correct?'correct':''}"><span>👤 ${esc(v.voterName)}</span><span>➡️</span><span>${v.correct?'🎯':'❌'} ${esc(v.targetName)}</span></div>`).join('')}</div><div class="info">🎯 Correct: ${r.correctCount} × 10 &nbsp; • &nbsp; ❌ Wrong: ${r.wrongCount} × 0 &nbsp; • &nbsp; 🔪 Killer: +${r.killerPoints}</div></div>`+(state.yourId===state.hostId?`<button id="nextBtn" class="action-btn green">${state.round>=TOTAL_ROUNDS?'🏆 Show Final Result':'➡️ Next Round'}</button>`:'<div class="info">👑 Waiting for the host to continue.</div>');const b=$('nextBtn');if(b)b.onclick=()=>socket.emit('nextRound');}
function renderFinal(){
  show('final');
  const list=[...state.scores].sort((a,b)=>b.score-a.score || a.name.localeCompare(b.name));
  let lastScore=null, rank=0;
  $('finalScores').innerHTML=list.map((p,i)=>{
    if(lastScore===null || p.score<lastScore) rank=i+1;
    lastScore=p.score;
    const medal=rank===1?'🏆':rank===2?'🥈':rank===3?'🥉':`${rank}.`;
    const label=rank===1?'WINNER':rank===2?'2ND':rank===3?'3RD':`${rank}TH`;
    return `<div class="score-row ${rank===1?'winner':''}"><span><b>${medal}</b> ${esc(p.name)} <small class="rank-label">${label}</small></span><strong>${p.score}/100</strong></div>`;
  }).join('');
  const top=list[0];
  $('finalSubtitle').textContent=top?`👑 ${top.name} wins with ${top.score}/100 points.`:'10 rounds completed.';
}
