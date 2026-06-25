/* ================================================================
   ① CONFIGURATION  ← Replace these two values
================================================================ */
const SUPABASE_URL  = 'https://qxibcwgvvltrjfknsufv.supabase.co';  // e.g. https://xyzabc.supabase.co
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF4aWJjd2d2dmx0cmpma25zdWZ2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzMzE4NjcsImV4cCI6MjA5NzkwNzg2N30.bvYDhmLPJegpJvTmID3flY3ph5ccA6UMHzsVLeaBuos';     // long JWT string starting with eyJ…


/* ================================================================
   ② QUIZ DATA
================================================================ */

/**
 * The onboarding quiz. Each option has weighted scores for each bug emoji.
 * The bug with the highest weight for the chosen answer is assigned to the player.
 */
const QUIZ = {
  question: 'What best describes your coding style?',
  options: [
    {
      label: '🔥 Ship fast, fix later',
      weights: { '🦋': 3, '🐝': 2, '🪲': 1, '🐜': 1, '🐛': 0, '🪳': 0 }
    },
    {
      label: '🧪 Test everything first',
      weights: { '🐜': 3, '🪲': 2, '🐛': 1, '🦋': 0, '🐝': 1, '🪳': 0 }
    },
    {
      label: '☕ Coffee → code → repeat',
      weights: { '🐝': 3, '🦋': 1, '🪳': 2, '🐛': 1, '🪲': 0, '🐜': 0 }
    },
    {
      label: '🌙 Midnight debugging only',
      weights: { '🪳': 3, '🐛': 2, '🪲': 1, '🦋': 0, '🐝': 0, '🐜': 1 }
    },
  ]
};

/** Display name shown on the bug reveal screen */
const BUG_NAMES = {
  '🦋': 'The Butterfly Dev',
  '🐝': 'The Busy Bee',
  '🪲': 'The Beetle Coder',
  '🐜': 'The Ant Architect',
  '🐛': 'The Night Crawler',
  '🪳': 'The Cockroach (unkillable)',
};


/* ================================================================
   ③ GAME CONSTANTS
================================================================ */
const STEP          = 2.5;   // % of room dimensions per animation frame at full speed
const MOVE_SPEED    = 0.35;  // multiplier applied to STEP each rAF tick
const BUBBLE_TTL    = 5000;  // ms a chat bubble stays visible above an emoji
const MAX_LOG       = 80;    // max chat entries kept in the sidebar
const SYNC_THROTTLE = 80;    // ms between position pushes to Supabase (rate-limit guard)


/* ================================================================
   ④ RUNTIME STATE
================================================================ */
let supabaseClient = null;   // Supabase JS client (null in demo mode)

// Local player identity (set after the modal is completed)
let myId       = null;
let myNickname = null;
let myEmoji    = null;
let myX        = 50;         // current X position as % of room width
let myY        = 50;         // current Y position as % of room height

// Onboarding
let quizAnswer = null;       // index of the selected quiz option

// Remote players:  { [id]: { id, nickname, emoji, x, y, el, emojiEl, isSelf } }
const players = {};

// Input tracking
const keysDown     = {};     // e.g. { 'ArrowUp': true }
let lastSyncTime   = 0;      // timestamp of the last Supabase position update
let movementLoopId = null;   // requestAnimationFrame handle
const bubbleTimers = {};     // { [playerId]: timeoutId } for auto-hiding bubbles


/* ================================================================
   ⑤ ONBOARDING — QUIZ SETUP
================================================================ */

/**
 * Runs once the DOM is loaded.
 * Populates the quiz option buttons and wires up the nickname Enter key.
 */
window.addEventListener('DOMContentLoaded', () => {
  // Build quiz option buttons dynamically
  const container = document.getElementById('quiz-options');
  QUIZ.options.forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.className   = 'quiz-opt';
    btn.textContent = opt.label;
    btn.onclick = () => {
      // Deselect all, then mark this one
      document.querySelectorAll('.quiz-opt').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      quizAnswer = i;
      // Show the "See My Bug" confirm button
      document.getElementById('quiz-submit-btn').style.display = 'block';
    };
    container.appendChild(btn);
  });

  // Set the question text
  document.getElementById('quiz-question').textContent = QUIZ.question;

  // Allow pressing Enter to advance from Step 1
  document.getElementById('nickname-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') goToStep2();
  });
});


/**
 * Step 1 → Step 2: validate nickname and show the quiz.
 * Called by the "Find My Bug →" button.
 */
function goToStep2() {
  const raw = document.getElementById('nickname-input').value.trim();
  if (!raw) {
    document.getElementById('nickname-input').focus();
    return;
  }
  myNickname = raw.substring(0, 18);
  document.getElementById('step-1').style.display = 'none';
  document.getElementById('step-2').style.display = '';
}


/**
 * Step 2 → Step 3: calculate the winning bug from quiz weights and reveal it.
 * Called by the "See My Bug 🔍" button.
 */
function revealBug() {
  if (quizAnswer === null) return;

  // Sort the weights map by value descending, pick the top bug
  const weights = QUIZ.options[quizAnswer].weights;
  myEmoji = Object.entries(weights).sort((a, b) => b[1] - a[1])[0][0];

  document.getElementById('bug-reveal-emoji').textContent = myEmoji;
  document.getElementById('bug-reveal-name').textContent  = BUG_NAMES[myEmoji] || myEmoji;
  document.getElementById('step-2').style.display = 'none';
  document.getElementById('step-3').style.display = '';
}


/**
 * Step 3 → Pub: dismiss the modal and boot the game.
 * Called by the "Enter the Pub 🍺" button.
 */
function enterPub() {
  document.getElementById('modal-overlay').style.display = 'none';
  initPub();
}


/* ================================================================
   ⑥ PUB INITIALISATION
================================================================ */

/**
 * Main entry point after the player completes onboarding.
 * Bootstraps either live (Supabase) or demo mode.
 */
async function initPub() {
  // Generate a random session ID for this browser tab
  myId = 'bug_' + Math.random().toString(36).slice(2, 10);

  // Spawn at a random position away from the edges
  myX = 20 + Math.random() * 60;
  myY = 20 + Math.random() * 60;

  // ── DEMO MODE ─────────────────────────────────────────────────
  // If the credentials are still placeholders, skip Supabase entirely.
  // The UI is fully functional but no other players will appear.
  if (SUPABASE_URL === 'YOUR_SUPABASE_PROJECT_URL') {
    addOrUpdatePlayerSprite(myId, myNickname, myEmoji, myX, myY, true);
    addSystemMessage('⚠️ Demo mode — add your Supabase keys to enable multiplayer!');
    startMovementLoop();
    setupInputs();
    return;
  }

  // ── LIVE MODE ─────────────────────────────────────────────────
  try {
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

    // Fetch players already in the pub and render them
    const { data: existingPlayers } = await supabaseClient
      .from('players')
      .select('*');

    if (existingPlayers) {
      existingPlayers.forEach(p => {
        if (p.id !== myId) {
          addOrUpdatePlayerSprite(p.id, p.nickname, p.emoji, p.x, p.y, false);
        }
      });
      updateOnlineCount(existingPlayers.length + 1);
    }

    // Register this player in the database
    await supabaseClient.from('players').upsert({
      id:       myId,
      nickname: myNickname,
      emoji:    myEmoji,
      x:        myX,
      y:        myY,
    });

    // Load recent chat history (last 20 messages)
    const { data: history } = await supabaseClient
      .from('messages')
      .select('*')
      .order('created_at', { ascending: true })
      .limit(20);

    if (history) {
      history.forEach(m => appendChatLog(m.player_id, m.nickname, m.emoji, m.content));
    }

    // Subscribe to player position/join/leave events
    supabaseClient
      .channel('players_channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, handlePlayerChange)
      .subscribe();

    // Subscribe to incoming chat messages
    supabaseClient
      .channel('messages_channel')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
        const m = payload.new;
        if (m.player_id === myId) return; // already shown locally
        appendChatLog(m.player_id, m.nickname, m.emoji, m.content);
        showBubble(m.player_id, m.content);
      })
      .subscribe();

    // Clean up this player's row when the tab closes
    window.addEventListener('beforeunload', () => {
      supabaseClient.from('players').delete().eq('id', myId).then(() => {});
    });

    addSystemMessage(`🍺 ${myNickname} scuttled in!`);

  } catch (err) {
    console.error('Supabase connection error:', err);
    addSystemMessage('⚠️ Could not connect to Supabase. Running in demo mode.');
  }

  // Render the local player sprite regardless of connection status
  addOrUpdatePlayerSprite(myId, myNickname, myEmoji, myX, myY, true);
  startMovementLoop();
  setupInputs();
}


/* ================================================================
   ⑦ PLAYER SPRITES
================================================================ */

/**
 * Creates or repositions a player's sprite in the pub room.
 *
 * @param {string}  id        - Unique player session ID
 * @param {string}  nickname  - Display name
 * @param {string}  emoji     - Bug emoji character
 * @param {number}  x         - X position as % of room width
 * @param {number}  y         - Y position as % of room height
 * @param {boolean} isSelf    - True if this is the local player
 */
function addOrUpdatePlayerSprite(id, nickname, emoji, x, y, isSelf) {
  const room = document.getElementById('pub-room');
  let entry  = players[id];

  if (!entry) {
    // ── First time: build the sprite DOM ──
    const el = document.createElement('div');
    el.className = 'player';
    el.id        = 'player_' + id;

    const nameEl = document.createElement('div');
    nameEl.className   = 'player-name' + (isSelf ? ' is-self' : '');
    nameEl.textContent = nickname;

    const emojiEl = document.createElement('div');
    emojiEl.className   = 'player-emoji';
    emojiEl.textContent = emoji;

    el.appendChild(nameEl);
    el.appendChild(emojiEl);
    room.appendChild(el);

    entry = { id, nickname, emoji, x, y, el, emojiEl, isSelf };
    players[id] = entry;
  }

  // Update stored coordinates and CSS position
  entry.x = x;
  entry.y = y;
  entry.el.style.left = x + '%';
  entry.el.style.top  = y + '%';
}


/**
 * Removes a player's sprite from the DOM and the players map.
 * @param {string} id
 */
function removePlayerSprite(id) {
  const entry = players[id];
  if (entry) {
    entry.el.remove();
    delete players[id];
  }
}


/**
 * Restarts the "hop" CSS animation on a player's emoji element.
 * Works by removing the class, forcing a reflow, then re-adding it.
 * @param {string} id
 */
function triggerHop(id) {
  const entry = players[id];
  if (!entry) return;
  entry.emojiEl.classList.remove('moving');
  void entry.emojiEl.offsetWidth; // force reflow so animation replays
  entry.emojiEl.classList.add('moving');
}


/* ================================================================
   ⑧ SUPABASE REALTIME HANDLERS
================================================================ */

/**
 * Handles INSERT / UPDATE / DELETE events on the `players` table.
 * Called by the Supabase Realtime subscription.
 * @param {object} payload - Supabase postgres_changes payload
 */
function handlePlayerChange(payload) {
  const { eventType, new: p, old } = payload;

  if (eventType === 'INSERT') {
    // A new player joined — skip self (we already rendered ourselves)
    if (p.id === myId) return;
    addOrUpdatePlayerSprite(p.id, p.nickname, p.emoji, p.x, p.y, false);
    addSystemMessage(`🐞 ${p.nickname} just crawled in`);
    updateOnlineCount(Object.keys(players).length);

  } else if (eventType === 'UPDATE') {
    // Position or data changed — skip self (we manage our own position locally)
    if (p.id === myId) return;
    const prev = players[p.id];
    const hasMoved = prev && (prev.x !== p.x || prev.y !== p.y);
    addOrUpdatePlayerSprite(p.id, p.nickname, p.emoji, p.x, p.y, false);
    if (hasMoved) triggerHop(p.id);

  } else if (eventType === 'DELETE') {
    // Player left the pub
    const gone = players[old.id];
    if (gone) {
      addSystemMessage(`👋 ${gone.nickname} left the pub`);
      removePlayerSprite(old.id);
    }
    updateOnlineCount(Object.keys(players).length);
  }
}


/* ================================================================
   ⑨ MOVEMENT — keyboard & click
================================================================ */

/**
 * Sets up all input event listeners.
 * Must be called after initPub() so the pub room exists in the DOM.
 */
function setupInputs() {
  // Auto-focus the pub room so arrow keys work without clicking first
  document.getElementById('pub-room').focus();

  // Track which keys are held down (only when chat input is NOT focused)
  window.addEventListener('keydown', e => {
    if (e.target === document.getElementById('chat-input')) return;
    keysDown[e.key] = true;
  });

  window.addEventListener('keyup', e => {
    keysDown[e.key] = false;
  });

  // Click anywhere in the pub room to teleport-move there
  document.getElementById('pub-room').addEventListener('click', e => {
    const room = document.getElementById('pub-room');
    const rect  = room.getBoundingClientRect();

    // Convert click pixel coords to % of room dimensions
    myX = clamp(((e.clientX - rect.left) / rect.width)  * 100, 2, 98);
    myY = clamp(((e.clientY - rect.top)  / rect.height) * 100, 2, 98);
    moveSelf();

    // Visual ripple feedback at the click location
    const ripple = document.createElement('div');
    ripple.className  = 'click-ripple';
    ripple.style.left = (e.clientX - rect.left) + 'px';
    ripple.style.top  = (e.clientY - rect.top)  + 'px';
    room.appendChild(ripple);
    setTimeout(() => ripple.remove(), 600);
  });

  // Send chat on Enter key while chat input is focused
  document.getElementById('chat-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') sendChat();
  });
}


/**
 * Starts the requestAnimationFrame movement loop.
 * Reads keysDown each frame and moves the local player accordingly.
 */
function startMovementLoop() {
  if (movementLoopId) return; // prevent duplicate loops

  (function loop() {
    let moved = false;
    const delta = STEP * MOVE_SPEED;

    if (keysDown['ArrowUp']    || keysDown['w'] || keysDown['W']) { myY -= delta; moved = true; }
    if (keysDown['ArrowDown']  || keysDown['s'] || keysDown['S']) { myY += delta; moved = true; }
    if (keysDown['ArrowLeft']  || keysDown['a'] || keysDown['A']) { myX -= delta; moved = true; }
    if (keysDown['ArrowRight'] || keysDown['d'] || keysDown['D']) { myX += delta; moved = true; }

    if (moved) moveSelf();

    movementLoopId = requestAnimationFrame(loop);
  })();
}


/**
 * Clamps local player coordinates, updates the sprite, and throttle-syncs to Supabase.
 */
function moveSelf() {
  myX = clamp(myX, 2, 98);
  myY = clamp(myY, 2, 98);

  addOrUpdatePlayerSprite(myId, myNickname, myEmoji, myX, myY, true);
  triggerHop(myId);

  // Sync position to Supabase at most once every SYNC_THROTTLE ms
  const now = Date.now();
  if (supabaseClient && now - lastSyncTime > SYNC_THROTTLE) {
    lastSyncTime = now;
    supabaseClient
      .from('players')
      .update({ x: myX, y: myY, updated_at: new Date().toISOString() })
      .eq('id', myId)
      .then(() => {}); // fire-and-forget
  }
}


/* ================================================================
   ⑩ CHAT
================================================================ */

/**
 * Reads the chat input, sends locally and to Supabase, then clears input.
 * Called by the send button and Enter keydown.
 */
async function sendChat() {
  const input = document.getElementById('chat-input');
  const text  = input.value.trim();
  if (!text) return;
  input.value = '';

  // Show locally immediately (don't wait for the DB round-trip)
  appendChatLog(myId, myNickname, myEmoji, text);
  showBubble(myId, text);

  if (supabaseClient) {
    await supabaseClient.from('messages').insert({
      player_id: myId,
      nickname:  myNickname,
      emoji:     myEmoji,
      content:   text,
    });
  }
}


/**
 * Appends a chat message entry to the sidebar log.
 *
 * @param {string} senderId  - Player ID (to detect self)
 * @param {string} nickname
 * @param {string} emoji
 * @param {string} text
 */
function appendChatLog(senderId, nickname, emoji, text) {
  const log = document.getElementById('chat-log');

  // Trim oldest entries to stay under MAX_LOG
  while (log.children.length >= MAX_LOG) {
    log.removeChild(log.firstChild);
  }

  const entry = document.createElement('div');
  entry.className = 'chat-entry';

  const ts = document.createElement('span');
  ts.className   = 'ts';
  ts.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const sender = document.createElement('span');
  sender.className   = 'sender' + (senderId === myId ? ' is-self' : '');
  sender.textContent = `${emoji} ${nickname}:`;

  const msg = document.createElement('span');
  msg.textContent = ' ' + text;

  entry.appendChild(ts);
  entry.appendChild(sender);
  entry.appendChild(msg);
  log.appendChild(entry);

  // Auto-scroll to the latest message
  log.scrollTop = log.scrollHeight;
}


/**
 * Appends a dimmed italic system announcement to the chat log.
 * @param {string} text
 */
function addSystemMessage(text) {
  const log = document.getElementById('chat-log');
  const entry = document.createElement('div');
  entry.className   = 'chat-entry system-msg';
  entry.textContent = text;
  log.appendChild(entry);
  log.scrollTop = log.scrollHeight;
}


/**
 * Shows a transient speech bubble above a player's emoji sprite.
 * Automatically removes itself after BUBBLE_TTL ms.
 *
 * @param {string} playerId
 * @param {string} text
 */
function showBubble(playerId, text) {
  const entry = players[playerId];
  if (!entry) return;

  // Remove any existing bubble and cancel its timeout
  const existing = entry.emojiEl.querySelector('.chat-bubble');
  if (existing) existing.remove();
  if (bubbleTimers[playerId]) clearTimeout(bubbleTimers[playerId]);

  const bubble = document.createElement('div');
  bubble.className   = 'chat-bubble';
  bubble.textContent = text;
  entry.emojiEl.appendChild(bubble);

  // Auto-hide after TTL
  bubbleTimers[playerId] = setTimeout(() => bubble.remove(), BUBBLE_TTL);
}


/* ================================================================
   ⑪ UTILITIES
================================================================ */

/**
 * Clamps a number between min and max (inclusive).
 * @param {number} v
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}


/**
 * Updates the "X online" counter in the header.
 * @param {number} n
 */
function updateOnlineCount(n) {
  document.getElementById('online-count').textContent = `🟢 ${n} online`;
}