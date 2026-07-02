/* ================================================================
   chat.js — Chat log, bubbles, system messages
================================================================ */
const MAX_LOG = 80;

window.addEventListener('DOMContentLoaded', () => {
  document.getElementById('chat-input')
    .addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });
});

async function sendChat() {
  const inp  = document.getElementById('chat-input');
  const text = inp.value.trim();
  if (!text) return;
  inp.value = '';

  appendChat(myId, myNickname, myEmoji, text);
  showBubble(myId, text);

  if (supabaseClient) {
    await supabaseClient.from('messages').insert({
      player_id: myId, nickname: myNickname, emoji: myEmoji, content: text
    });
  }
}

function appendChat(senderId, nick, emoji, text) {
  const log = document.getElementById('chat-log');
  while (log.children.length >= MAX_LOG) log.removeChild(log.firstChild);

  const e  = document.createElement('div'); e.className = 'chat-entry';
  const ts = document.createElement('span'); ts.className = 'ts';
  ts.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const sn = document.createElement('span');
  sn.className = 'sender' + (senderId === myId ? ' me' : '');
  sn.textContent = emoji + ' ' + nick + ':';
  const m = document.createElement('span'); m.textContent = ' ' + text;

  e.appendChild(ts); e.appendChild(sn); e.appendChild(m);
  log.appendChild(e);
  log.scrollTop = log.scrollHeight;
}

function sysMsg(text) {
  const log = document.getElementById('chat-log');
  const e   = document.createElement('div');
  e.className = 'chat-entry system-msg'; e.textContent = text;
  log.appendChild(e);
  log.scrollTop = log.scrollHeight;
}

function showBubble(playerId, text) {
  const entry = players[playerId]; if (!entry) return;
  const ex = entry.el.querySelector('.chat-bubble'); if (ex) ex.remove();
  if (bubbleTimers[playerId]) clearTimeout(bubbleTimers[playerId]);
  const b = document.createElement('div');
  b.className = 'chat-bubble'; b.textContent = text;
  entry.em.style.position = 'relative';
  entry.em.appendChild(b);
  bubbleTimers[playerId] = setTimeout(() => b.remove(), BUBBLE_TTL);
}