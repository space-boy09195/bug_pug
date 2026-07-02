/* ================================================================
   players.js — Supabase connection, player state, movement
   ================================================================
   SETUP: Replace the two lines below with your credentials.
================================================================ */
const SUPABASE_URL  = 'YOUR_SUPABASE_PROJECT_URL';
const SUPABASE_ANON = 'YOUR_SUPABASE_ANON_KEY';

/* shared player state (used by all modules) */
let myId       = null;
let myNickname = null;
let myEmoji    = null;
let myX        = 50;
let myY        = 50;

let supabaseClient = null;
const players      = {};   // { id: { nick, emoji, x, y, el, em } }
const keysDown     = {};
const bubbleTimers = {};

const STEP         = 2.5;
const BUBBLE_TTL   = 5000;
const SYNC_MS      = 80;
let   lastSyncTime = 0;

/* ----------------------------------------------------------------
   initPub — called after the user completes onboarding
---------------------------------------------------------------- */
async function initPub() {
  myId = 'bug_' + Math.random().toString(36).slice(2, 10);
  myX  = 20 + Math.random() * 60;
  myY  = 25 + Math.random() * 50;

  // canvas + render loop started in game.js
  initCanvas();
  setupInput();

  if (SUPABASE_URL === 'YOUR_SUPABASE_PROJECT_URL') {
    addOrUpdatePlayer(myId, myNickname, myEmoji, myX, myY, true);
    sysMsg('⚠️ Demo mode — add Supabase keys for multiplayer!');
    return;
  }

  try {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

    // load existing players
    const { data: existing } = await supabaseClient.from('players').select('*');
    if (existing) existing.forEach(p => {
      if (p.id !== myId) addOrUpdatePlayer(p.id, p.nickname, p.emoji, p.x, p.y, false);
    });

    // register self
    await supabaseClient.from('players').upsert({
      id: myId, nickname: myNickname, emoji: myEmoji, x: myX, y: myY
    });

    // load chat history
    const { data: hist } = await supabaseClient
      .from('messages').select('*')
      .order('created_at', { ascending: true }).limit(20);
    if (hist) hist.forEach(m => appendChat(m.player_id, m.nickname, m.emoji, m.content));

    // realtime subscriptions
    supabaseClient.channel('players_ch')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, onPlayerChange)
      .subscribe();

    supabaseClient.channel('messages_ch')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, pl => {
        const m = pl.new;
        if (m.player_id === myId) return;
        appendChat(m.player_id, m.nickname, m.emoji, m.content);
        showBubble(m.player_id, m.content);
      }).subscribe();

    // subscribe to notice board
    supabaseClient.channel('notes_ch')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notes' }, pl => {
        renderNote(pl.new);
      }).subscribe();

    // subscribe to dice scores
    supabaseClient.channel('dice_ch')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dice_scores' }, () => {
        loadDiceLeaderboard();
      }).subscribe();

    window.addEventListener('beforeunload', async () => {
      await supabaseClient.from('players').delete().eq('id', myId);
    });

    updateCount(Object.keys(players).length + 1);
    sysMsg(`🍺 ${myNickname} scuttled into the pub!`);
  } catch (err) {
    console.error('Supabase connection error:', err);
    sysMsg('⚠️ Could not connect to Supabase. Running in demo mode.');
  }

  addOrUpdatePlayer(myId, myNickname, myEmoji, myX, myY, true);
}

/* ----------------------------------------------------------------
   Player DOM sprite management
---------------------------------------------------------------- */
function addOrUpdatePlayer(id, nick, emoji, x, y, isSelf) {
  const room = document.getElementById('pub-room');
  let e = players[id];
  if (!e) {
    const el = document.createElement('div');
    el.className = 'player'; el.id = 'p_' + id;
    const ne = document.createElement('div');
    ne.className = 'player-name' + (isSelf ? ' is-self' : '');
    ne.textContent = nick;
    const em = document.createElement('div');
    em.className = 'player-emoji'; em.textContent = emoji;
    el.appendChild(ne); el.appendChild(em);
    room.appendChild(el);
    e = { id, nick, emoji, x, y, el, em, isSelf };
    players[id] = e;
  }
  e.x = x; e.y = y;
  e.el.style.left = x + '%';
  e.el.style.top  = y + '%';
}

function removePlayer(id) {
  const e = players[id];
  if (e) { e.el.remove(); delete players[id]; }
}

function hop(id) {
  const e = players[id]; if (!e) return;
  e.em.classList.remove('moving');
  void e.em.offsetWidth;
  e.em.classList.add('moving');
}

/* Play a gesture animation on a player's emoji */
function playGesture(id, gesture) {
  const e = players[id]; if (!e) return;
  e.em.classList.remove('drinking', 'eating', 'moving');
  void e.em.offsetWidth;
  e.em.classList.add(gesture);
  setTimeout(() => e.em.classList.remove(gesture), 2000);
}

function onPlayerChange({ eventType: et, new: p, old }) {
  if (et === 'INSERT' && p.id !== myId) {
    addOrUpdatePlayer(p.id, p.nickname, p.emoji, p.x, p.y, false);
    sysMsg(`🐞 ${p.nickname} crawled into the pub`);
  } else if (et === 'UPDATE' && p.id !== myId) {
    const was = players[p.id];
    addOrUpdatePlayer(p.id, p.nickname, p.emoji, p.x, p.y, false);
    if (was && (was.x !== p.x || was.y !== p.y)) hop(p.id);
  } else if (et === 'DELETE') {
    const g = players[old.id];
    if (g) { sysMsg(`👋 ${g.nick} left the pub`); removePlayer(old.id); }
  }
  updateCount(Object.keys(players).length);
}

/* ----------------------------------------------------------------
   Input — keyboard + click-to-move
---------------------------------------------------------------- */
function setupInput() {
  document.getElementById('pub-room').focus();

  window.addEventListener('keydown', e => {
    if (e.target === document.getElementById('chat-input')) return;
    if (e.target === document.getElementById('board-input')) return;
    keysDown[e.key] = true;
  });
  window.addEventListener('keyup', e => { keysDown[e.key] = false; });

  // movement loop
  (function loop() {
    let moved = false;
    if (keysDown['ArrowUp']    || keysDown['w'] || keysDown['W']) { myY -= STEP * .35; moved = true; }
    if (keysDown['ArrowDown']  || keysDown['s'] || keysDown['S']) { myY += STEP * .35; moved = true; }
    if (keysDown['ArrowLeft']  || keysDown['a'] || keysDown['A']) { myX -= STEP * .35; moved = true; }
    if (keysDown['ArrowRight'] || keysDown['d'] || keysDown['D']) { myX += STEP * .35; moved = true; }
    if (moved) moveSelf();
    requestAnimationFrame(loop);
  })();
}

function moveSelf() {
  myX = clamp(myX, 2, 98); myY = clamp(myY, 5, 98);
  addOrUpdatePlayer(myId, myNickname, myEmoji, myX, myY, true);
  hop(myId);
  const now = Date.now();
  if (supabaseClient && now - lastSyncTime > SYNC_MS) {
    lastSyncTime = now;
    supabaseClient.from('players')
      .update({ x: myX, y: myY, updated_at: new Date().toISOString() })
      .eq('id', myId).then(() => {});
  }
}

/* ── helpers ── */
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function updateCount(n) { document.getElementById('online-count').textContent = `🟢 ${n} online`; }