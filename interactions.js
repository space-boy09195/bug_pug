/* ================================================================
   interactions.js
   Handles: bar drink/eat, dice game, notice board,
            bookshelf reader, cauldron stir, music box
================================================================ */

/* ── shared helper ── */
function closeAllPopups() {
  document.querySelectorAll('.popup').forEach(p => p.style.display = 'none');
}
function closeBook() {
  document.getElementById('book-reader').style.display = 'none';
  document.getElementById('book-frame').src = '';
}

/* ================================================================
   BAR — Drink / Eat gestures
================================================================ */
const DRINK_LINES = [
  'orders a Dark Mode Stout 🍺',
  'sips a Recursive Ale 🍺',
  'downs a pint of Legacy Code Porter 🍺',
  'chugs a Segmentation Fault IPA 🍺',
  'requests "something strong" after a prod deploy 🍺',
];
const EAT_LINES = [
  'munches on Pixel Pretzels 🥨',
  'devours a Stack Overflow Sandwich 🥪',
  'snacks on Crunchy Callback Chips 🍟',
  'enjoys the Mystery Bug Stew 🍲',
  'eats a slice of Deploy Day Pizza 🍕',
];

function barAction(type) {
  closeAllPopups();
  const lines = type === 'drink' ? DRINK_LINES : EAT_LINES;
  const line  = lines[Math.floor(Math.random() * lines.length)];
  const gesture = type === 'drink' ? 'drinking' : 'eating';

  // animate local player
  playGesture(myId, gesture);
  showBubble(myId, type === 'drink' ? '🍺 *glug glug*' : '🍖 *nom nom*');

  // broadcast to chat so others see it
  const msg = `${myEmoji} ${myNickname} ${line}`;
  sysMsg(msg);
  if (supabaseClient) {
    supabaseClient.from('messages').insert({
      player_id: myId, nickname: myNickname, emoji: myEmoji,
      content: line
    });
  }
}

/* ================================================================
   DICE GAME — Binary Dice (roll two d6, track scores per session)
================================================================ */
let diceRolling = false;
let myDiceScore = null;

function rollDice() {
  if (diceRolling) return;
  diceRolling = true;

  const d1el = document.getElementById('die1');
  const d2el = document.getElementById('die2');
  d1el.classList.add('rolling'); d2el.classList.add('rolling');
  document.getElementById('dice-status').textContent = 'Rolling…';
  document.getElementById('dice-score').textContent  = '';

  // animate for 600ms then resolve
  let ticks = 0;
  const interval = setInterval(() => {
    d1el.textContent = Math.ceil(Math.random()*6);
    d2el.textContent = Math.ceil(Math.random()*6);
    ticks++;
    if (ticks >= 10) {
      clearInterval(interval);
      const r1 = Math.ceil(Math.random()*6);
      const r2 = Math.ceil(Math.random()*6);
      d1el.textContent = r1; d2el.textContent = r2;
      d1el.classList.remove('rolling'); d2el.classList.remove('rolling');
      myDiceScore = r1 + r2;
      document.getElementById('dice-score').textContent = `Total: ${myDiceScore}`;
      document.getElementById('dice-status').textContent = myDiceScore >= 10 ? '🎉 Big roll!' : myDiceScore <= 3 ? '😬 Rough luck…' : 'Not bad!';
      diceRolling = false;

      // save score
      if (supabaseClient) {
        supabaseClient.from('dice_scores').upsert({
          player_id: myId, nickname: myNickname, emoji: myEmoji, score: myDiceScore
        }, { onConflict: 'player_id' }).then(() => loadDiceLeaderboard());
      } else {
        loadDiceLeaderboard();
      }
      sysMsg(`🎲 ${myNickname} rolled ${r1} + ${r2} = ${myDiceScore}!`);
    }
  }, 60);
}

function resetDice() {
  document.getElementById('die1').textContent = '?';
  document.getElementById('die2').textContent = '?';
  document.getElementById('dice-score').textContent  = '';
  document.getElementById('dice-status').textContent = 'Roll the dice — highest total wins!';
  document.getElementById('dice-leaderboard').innerHTML = '';
  myDiceScore = null;
  if (supabaseClient) {
    supabaseClient.from('dice_scores').delete().eq('player_id', myId).then(() => loadDiceLeaderboard());
  }
}

async function loadDiceLeaderboard() {
  const board = document.getElementById('dice-leaderboard');
  if (!supabaseClient) {
    if (myDiceScore !== null) {
      board.innerHTML = `<h4>🏆 SCOREBOARD</h4><div class="dice-entry"><span class="winner">${myEmoji} ${myNickname}</span><span>${myDiceScore}</span></div>`;
    }
    return;
  }
  const { data } = await supabaseClient
    .from('dice_scores').select('*').order('score', { ascending: false }).limit(8);
  if (!data || !data.length) { board.innerHTML = ''; return; }
  board.innerHTML = '<h4>🏆 SCOREBOARD</h4>' + data.map((row, i) =>
    `<div class="dice-entry">
      <span class="${i===0?'winner':''}">${row.emoji} ${row.nickname}${i===0?' 👑':''}</span>
      <span>${row.score}</span>
    </div>`
  ).join('');
}

/* ================================================================
   NOTICE BOARD — Pin notes (stored in Supabase `notes` table)
================================================================ */
async function loadBoardNotes() {
  const container = document.getElementById('board-notes');
  container.innerHTML = '';

  if (!supabaseClient) {
    container.innerHTML = '<p style="color:var(--mist);font-size:15px">Connect Supabase to save notes!</p>';
    return;
  }
  const { data } = await supabaseClient
    .from('notes').select('*').order('created_at', { ascending: false }).limit(30);
  if (data) data.forEach(n => renderNote(n));
}

function renderNote(note) {
  const container = document.getElementById('board-notes');
  if (!container) return;
  const div = document.createElement('div');
  div.className = 'board-note';
  const time = new Date(note.created_at).toLocaleString([], {
    month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'
  });
  div.innerHTML = `
    <div>${note.content}</div>
    <div class="note-meta">📌 <span class="note-author">${note.emoji} ${note.nickname}</span> · ${time}</div>
  `;
  container.insertBefore(div, container.firstChild);
}

async function pinNote() {
  const inp  = document.getElementById('board-input');
  const text = inp.value.trim();
  if (!text) return;
  inp.value = '';

  if (!supabaseClient) {
    // demo mode — just render locally
    renderNote({ content: text, nickname: myNickname, emoji: myEmoji, created_at: new Date().toISOString() });
    return;
  }
  await supabaseClient.from('notes').insert({
    player_id: myId, nickname: myNickname, emoji: myEmoji, content: text
  });
  // renderNote will be called via realtime subscription
}

/* ================================================================
   BOOKSHELF — Book catalogue + iframe reader
   Add books by dropping HTML files in the books/ folder and
   adding entries to the BOOKS array below.
================================================================ */
const BOOKS = [
  {
    title:  'The Art of the Debug',
    author: 'B. Ugsworth',
    emoji:  '🔴',
    file:   'books/art-of-debug.html',
    desc:   'A practical guide to staring at code until it confesses.',
  },
  {
    title:  'Clean Code & Dark Magic',
    author: 'R. C. Martin (the other one)',
    emoji:  '🟣',
    file:   'books/clean-code-dark-magic.html',
    desc:   'Refactoring spells and incantations for the modern developer.',
  },
  {
    title:  'Recursion for Adventurers',
    author: 'A. Nonymous',
    emoji:  '🔵',
    file:   'books/recursion.html',
    desc:   'See: Recursion for Adventurers.',
  },
  {
    title:  'The Night Owl\'s Git Guide',
    author: 'C. Heckout',
    emoji:  '🟢',
    file:   'books/git-guide.html',
    desc:   'Commit messages, branches, and midnight merge conflicts.',
  },
  // ── ADD YOUR OWN BOOKS HERE ──
  // {
  //   title:  'My Book Title',
  //   author: 'Author Name',
  //   emoji:  '🟡',
  //   file:   'books/my-book.html',
  //   desc:   'Short description.',
  // },
];

function loadBookshelf() {
  const container = document.getElementById('shelf-books');
  container.innerHTML = '';
  BOOKS.forEach(book => {
    const el = document.createElement('div');
    el.className = 'shelf-book';
    el.innerHTML = `
      <div class="book-spine">${book.emoji}</div>
      <div class="book-info">
        <div class="book-title">${book.title}</div>
        <div class="book-author">by ${book.author}</div>
      </div>
    `;
    el.title = book.desc;
    el.onclick = () => openBook(book);
    container.appendChild(el);
  });
}

function openBook(book) {
  closeAllPopups();
  document.getElementById('book-reader-title').textContent = book.emoji + ' ' + book.title;
  document.getElementById('book-frame').src = book.file;
  document.getElementById('book-reader').style.display = 'flex';
  sysMsg(`📖 ${myNickname} is reading "${book.title}"`);
}

/* ================================================================
   CAULDRON — Stir to trigger bubble burst
================================================================ */
const CAULDRON_MSGS = [
  'The brew reacts violently. A frog appears briefly, then disappears.',
  'A face forms in the bubbles and whispers "have you tried turning it off and on again?"',
  'The liquid turns a deeper green. You smell like npm install now.',
  'The cauldron gurgles. It outputs: undefined.',
  'Something stirs back. The cauldron liked it.',
  'The brew bubbles faster. A commit message floats to the surface: "fix: stuff".',
];
let cauldronMsgIndex = 0;

function stirCauldron() {
  // trigger extra bubbles in canvas
  cauldronBubbling = true;
  setTimeout(() => { cauldronBubbling = false; }, 3000);

  const msg = CAULDRON_MSGS[cauldronMsgIndex % CAULDRON_MSGS.length];
  cauldronMsgIndex++;
  document.getElementById('cauldron-msg').textContent = msg;
  sysMsg(`🫕 ${myNickname} stirred the cauldron… ${msg}`);
}