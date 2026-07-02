/* ================================================================
   game.js — HTML5 Canvas pixel-art pub room renderer
================================================================ */
let canvas, ctx, TW, TH, animFrame = 0, hoveredObj = null;
const COLS = 32, ROWS = 20;

const C = {
  stoneA:'#1c1828', stoneB:'#201c2e', grout:'#0f0d1a',
  wallA:'#161224',  wallB:'#131020',
  barTop:'#6b3a1f', barFront:'#4a2810', barEdge:'#8a5030', barShelf:'#3d2010',
  tableTop:'#5c3418', tableEdge:'#7a4828', chairSeat:'#4a2c14', chairBack:'#3a2010',
  barrelWood:'#6b4020', barrelHoop:'#c8922a', barrelDark:'#3d2010',
  shelfWood:'#4a2c14', book1:'#7b3030', book2:'#305070', book3:'#306040', book4:'#705030',
  cauldronMetal:'#2a2a3a', cauldronRim:'#4a4a6a', cauldronLiquid:'#1a4a1a',
  rugA:'#2a1a3a', rugBorder:'#5a3a6a',
  fireplaceStone:'#2a2535', fireplaceDark:'#1a1525',
  boardWood:'#5c3418', boardPaper:'#d4b870', boardText:'#3a2010',
  musicBox:'#2a2040',
};

/* Objects players can click */
const OBJECTS = [
  { id:'bar',      x:6,  y:1,  w:14, h:3,  label:'🍺 THE BAR',        emoji:'🍺', popup:'popup-bar'      },
  { id:'fire',     x:13, y:1,  w:5,  h:3,  label:'🔥 THE HEARTH',      emoji:'🔥', popup:null             },
  { id:'shelf',    x:1,  y:5,  w:3,  h:7,  label:'📚 ARCANE SHELF',    emoji:'📚', popup:'popup-shelf'    },
  { id:'barrel',   x:23, y:2,  w:3,  h:3,  label:'🛢️ LEGACY BARREL',   emoji:'🛢️', popup:null             },
  { id:'board',    x:27, y:5,  w:4,  h:6,  label:'📜 NOTICE BOARD',    emoji:'📜', popup:'popup-board'    },
  { id:'table1',   x:3,  y:9,  w:7,  h:5,  label:'🪑 CORNER TABLE',    emoji:'🪑', popup:null             },
  { id:'table2',   x:16, y:9,  w:7,  h:5,  label:'🎲 GAME TABLE',      emoji:'🎲', popup:'popup-dice'     },
  { id:'cauldron', x:27, y:13, w:4,  h:5,  label:'🫕 THE CAULDRON',    emoji:'🫕', popup:'popup-cauldron' },
  { id:'music',    x:1,  y:13, w:3,  h:4,  label:'🎵 MUSIC BOX',       emoji:'🎵', popup:'popup-music'    },
];

/* ── exported so interactions.js can trigger extra bubbles ── */
let cauldronBubbling = false;

function initCanvas() {
  canvas = document.getElementById('pub-canvas');
  ctx    = canvas.getContext('2d');
  window.addEventListener('resize', resizeCanvas);
  resizeCanvas();

  canvas.addEventListener('mousemove', e => {
    const { tc, tr } = getTile(e);
    hoveredObj = OBJECTS.find(o => tc >= o.x && tc < o.x+o.w && tr >= o.y && tr < o.y+o.h) || null;
    canvas.style.cursor = hoveredObj ? 'pointer' : 'crosshair';
  });
  canvas.addEventListener('mouseleave', () => { hoveredObj = null; canvas.style.cursor = 'crosshair'; });
  canvas.addEventListener('click', onCanvasClick);

  (function loop() { drawRoom(); requestAnimationFrame(loop); })();
}

function resizeCanvas() {
  const room = document.getElementById('pub-room');
  canvas.width  = room.clientWidth;
  canvas.height = room.clientHeight;
  TW = Math.floor(canvas.width  / COLS);
  TH = Math.floor(canvas.height / ROWS);
}

function getTile(e) {
  const r = canvas.getBoundingClientRect();
  return {
    tc: (e.clientX - r.left) * (canvas.width  / r.width)  / TW,
    tr: (e.clientY - r.top)  * (canvas.height / r.height) / TH
  };
}

function onCanvasClick(e) {
  const { tc, tr } = getTile(e);
  const obj = OBJECTS.find(o => tc >= o.x && tc < o.x+o.w && tr >= o.y && tr < o.y+o.h);

  if (obj) {
    if (obj.popup) {
      closeAllPopups();
      const pop = document.getElementById(obj.popup);
      if (pop) {
        const r   = canvas.getBoundingClientRect();
        const px  = Math.min(e.clientX - r.left + 12, r.width  - 320);
        const py  = Math.max(e.clientY - r.top  - 80, 10);
        pop.style.left = px + 'px';
        pop.style.top  = py + 'px';
        pop.style.display = 'flex';
        // trigger any load hooks
        if (obj.id === 'board')    loadBoardNotes();
        if (obj.id === 'shelf')    loadBookshelf();
        if (obj.id === 'table2')   loadDiceLeaderboard();
      }
    } else if (obj.id === 'fire') {
      sysMsg('🔥 ' + (myNickname||'Someone') + ' warmed themselves by the fire');
    } else if (obj.id === 'barrel') {
      sysMsg('🛢️ ' + (myNickname||'Someone') + ' sniffed the legacy barrel and immediately regretted it');
    } else if (obj.id === 'table1') {
      sysMsg('🪑 ' + (myNickname||'Someone') + ' settled into the corner table');
    }
    return;
  }

  // click-to-move
  closeAllPopups();
  const r = document.getElementById('pub-room').getBoundingClientRect();
  myX = clamp(((e.clientX - r.left) / r.width)  * 100, 2, 98);
  myY = clamp(((e.clientY - r.top)  / r.height) * 100, 5, 98);
  moveSelf();
  const rip = document.createElement('div'); rip.className = 'ripple';
  rip.style.left = (e.clientX - r.left) + 'px';
  rip.style.top  = (e.clientY - r.top)  + 'px';
  document.getElementById('pub-room').appendChild(rip);
  setTimeout(() => rip.remove(), 600);
}

/* ================================================================
   DRAW
================================================================ */
function drawRoom() {
  if (!ctx) return;
  animFrame++;
  const W = canvas.width, H = canvas.height;

  // floor
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      fill(c, r, 1, 1, ((r+c)%2===0) ? C.stoneA : C.stoneB);
  ctx.strokeStyle = C.grout; ctx.lineWidth = 1;
  for (let r = 0; r <= ROWS; r++) { ctx.beginPath(); ctx.moveTo(0, r*TH); ctx.lineTo(W, r*TH); ctx.stroke(); }
  for (let c = 0; c <= COLS; c++) { ctx.beginPath(); ctx.moveTo(c*TW, 0); ctx.lineTo(c*TW, H); ctx.stroke(); }

  // wall top row
  for (let c = 0; c < COLS; c++) fill(c, 0, 1, 1, c%2===0 ? C.wallA : C.wallB);
  ctx.fillStyle = '#0a0816'; ctx.fillRect(0, TH-2, W, 3);

  drawRug();
  drawBar();
  drawFireplace();
  drawBookshelf();
  drawBarrel();
  drawNoticeBoard();
  drawMusicBox();
  drawTable(3, 9, 7, 5, '🍺');
  drawTable(16, 9, 7, 5, '🎲');
  drawTable(3, 15, 5, 4, '🕯️');
  drawCauldron(27, 13);
  drawCandle(11, 8);
  drawCandle(22, 13);
  drawCandle(7, 16);
  drawAmbientLight();

  if (hoveredObj) {
    ctx.fillStyle = 'rgba(180,143,224,.08)';
    ctx.fillRect(hoveredObj.x*TW, hoveredObj.y*TH, hoveredObj.w*TW, hoveredObj.h*TH);
    ctx.strokeStyle = 'rgba(180,143,224,.6)'; ctx.lineWidth = 2;
    ctx.strokeRect(hoveredObj.x*TW+1, hoveredObj.y*TH+1, hoveredObj.w*TW-2, hoveredObj.h*TH-2);
    ctx.fillStyle = 'rgba(220,200,255,.95)';
    ctx.font = `bold ${Math.max(10, TH*.55)}px 'VT323',monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(hoveredObj.emoji + ' ' + hoveredObj.label,
      (hoveredObj.x + hoveredObj.w/2)*TW, (hoveredObj.y - .3)*TH);
  }
}

function fill(x, y, w, h, col) { ctx.fillStyle = col; ctx.fillRect(x*TW, y*TH, w*TW, h*TH); }
function stroke(x, y, w, h, col, lw=1) { ctx.strokeStyle=col; ctx.lineWidth=lw; ctx.strokeRect(x*TW+.5, y*TH+.5, w*TW-1, h*TH-1); }

function drawRug() {
  ctx.fillStyle = C.rugA; ctx.fillRect(5.5*TW, 4.5*TH, 15*TW, 4*TH);
  ctx.strokeStyle = C.rugBorder; ctx.lineWidth = Math.max(2, TH*.18);
  ctx.strokeRect(5.5*TW+4, 4.5*TH+4, 15*TW-8, 4*TH-8);
  ctx.fillStyle = 'rgba(100,60,140,.25)';
  for (let i = 0; i < 5; i++) {
    const cx = (7+i*2.5)*TW, cy = 6.5*TH, r = TH*.5;
    ctx.beginPath(); ctx.moveTo(cx,cy-r); ctx.lineTo(cx+r,cy); ctx.lineTo(cx,cy+r); ctx.lineTo(cx-r,cy); ctx.closePath(); ctx.fill();
  }
}

function drawBar() {
  fill(6,1,14,1,C.barShelf); stroke(6,1,14,1,'#2a1408');
  [7,8,9,10,12,13,15,17,18].forEach((bx,i) => {
    ctx.fillStyle = ['#3a6a3a','#4a3a6a','#6a4a20','#5a2a2a'][i%4];
    ctx.fillRect(bx*TW+TW*.35, TH*1.15, TW*.28, TH*.65);
    ctx.fillStyle = '#c8a060'; ctx.fillRect(bx*TW+TW*.4, TH*1.08, TW*.18, TH*.14);
  });
  fill(6,2,14,1,C.barTop); stroke(6,2,14,1,C.barEdge,2);
  fill(6,3,14,1,C.barFront); stroke(6,3,14,1,'#2a1408');
  for (let i = 0; i < 5; i++) {
    const sx = (7+i*2.4)*TW;
    ctx.fillStyle = C.chairSeat; ctx.beginPath(); ctx.ellipse(sx, 4.3*TH, TW*.5, TH*.35, 0, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = C.barrelHoop; ctx.lineWidth=1; ctx.stroke();
  }
}

function drawFireplace() {
  fill(13,1,5,2,C.fireplaceStone); stroke(13,1,5,2,'#1a1525',2);
  fill(14,1,3,1.5,C.fireplaceDark);
  const ff = Math.sin(animFrame*.18)*.3+.7;
  const fh = TH*(.8+Math.sin(animFrame*.22)*.1);
  ctx.fillStyle = `rgba(220,100,20,${ff*.9})`; ctx.fillRect(14.3*TW,(2-.7)*TH,2.4*TW,fh);
  ctx.fillStyle = `rgba(245,200,60,${ff})`;    ctx.fillRect(14.6*TW,(2-.5)*TH,1.8*TW,fh*.6);
  ctx.fillStyle = `rgba(140,80,200,${ff*.6})`; ctx.fillRect(14.8*TW,(2-.65)*TH,1.4*TW,fh*.3);
}

function drawBookshelf() {
  fill(1,5,3,7,C.shelfWood); stroke(1,5,3,7,'#2a1408',2);
  [5.8,7.5,9.2,11.0].forEach(sy => {
    ctx.fillStyle='#3a2010'; ctx.fillRect(TW,sy*TH,3*TW,TH*.18);
    let bx=1.1;
    for (let b=0; b<4; b++) {
      const bw=.48+b*.04;
      ctx.fillStyle=[C.book1,C.book2,C.book3,C.book4][b%4];
      ctx.fillRect(bx*TW,(sy-.7)*TH,bw*TW,TH*.75);
      bx+=bw+.04; if(bx>3.7) break;
    }
  });
}

function drawBarrel() {
  ctx.fillStyle=C.barrelWood; ctx.beginPath(); ctx.ellipse(24.5*TW,3*TH,TW*1.2,TH*1.3,0,0,Math.PI*2); ctx.fill();
  [.2,.7,1.3,1.8].forEach(oy => { ctx.strokeStyle=C.barrelHoop; ctx.lineWidth=2; ctx.beginPath(); ctx.ellipse(24.5*TW,(2+oy)*TH,TW*1.15,TH*.22,0,0,Math.PI*2); ctx.stroke(); });
  ctx.fillStyle=C.barrelDark; ctx.beginPath(); ctx.ellipse(24.5*TW,2*TH+4,TW*1.2,TH*.25,0,0,Math.PI*2); ctx.fill();
  ctx.fillStyle='#c8a060'; ctx.font=`${TH*.4}px 'VT323',monospace`; ctx.textAlign='center';
  ctx.fillText('LEGACY',24.5*TW,3.1*TH);
}

function drawNoticeBoard() {
  fill(27,5,4,6,C.boardWood); stroke(27,5,4,6,'#2a1408',2);
  [[27.2,5.3,1.6,2.2],[29,5.4,1.6,1.8],[27.3,7.8,3.2,2.6]].forEach(([px,py,pw,ph]) => {
    fill(px,py,pw,ph,C.boardPaper); stroke(px,py,pw,ph,C.boardText);
    for (let l=0;l<3;l++) { ctx.fillStyle=C.boardText; ctx.fillRect((px+.15)*TW,(py+.3+l*.25)*TH,pw*TW*.7,2); }
  });
  ['#c84040','#4080c8','#40a840'].forEach((col,i) => { ctx.fillStyle=col; ctx.beginPath(); ctx.arc((28+i)*TW,5.2*TH,TW*.13,0,Math.PI*2); ctx.fill(); });
}

function drawMusicBox() {
  fill(1,13,3,4,C.musicBox); stroke(1,13,3,4,'#4a3a6a',2);
  // speaker grille
  for (let row=0; row<3; row++)
    for (let col=0; col<5; col++) {
      ctx.fillStyle='rgba(100,80,160,.5)';
      ctx.beginPath(); ctx.arc((1.4+col*.45)*TW,(13.8+row*.8)*TH,TW*.12,0,Math.PI*2); ctx.fill();
    }
  // music note pulse
  const pulse = Math.sin(animFrame*.08)*.3+.7;
  ctx.fillStyle=`rgba(180,143,224,${pulse})`;
  ctx.font=`${TH*.8}px serif`; ctx.textAlign='center';
  ctx.fillText('♪', 2.5*TW, 14.5*TH);
  // floating notes
  [0,.5,1].forEach((off,i) => {
    const t = ((animFrame*.012)+off)%1;
    ctx.fillStyle=`rgba(180,143,224,${(1-t)*.5})`;
    ctx.font=`${TH*.5}px serif`;
    ctx.fillText(['♪','♫','♩'][i], (1.8+i*.6)*TW, (13-t*2)*TH);
  });
}

function drawTable(tx, ty, tw, th, emoji) {
  for (let i=1; i<tw-1; i+=2) {
    ctx.fillStyle=C.chairSeat; ctx.fillRect((tx+i)*TW+2,(ty-.8)*TH,TW-4,TH*.7);
    ctx.strokeStyle=C.chairBack; ctx.lineWidth=1; ctx.strokeRect((tx+i)*TW+2,(ty-.8)*TH,TW-4,TH*.7);
  }
  for (let i=1; i<tw-1; i+=2) {
    ctx.fillStyle=C.chairSeat; ctx.fillRect((tx+i)*TW+2,(ty+th)*TH+2,TW-4,TH*.7);
    ctx.strokeStyle=C.chairBack; ctx.lineWidth=1; ctx.strokeRect((tx+i)*TW+2,(ty+th)*TH+2,TW-4,TH*.7);
  }
  ctx.fillStyle=C.tableTop; ctx.fillRect(tx*TW+3,ty*TH+3,tw*TW-6,th*TH-6);
  ctx.fillStyle=C.tableEdge; ctx.fillRect(tx*TW+3,ty*TH+3,tw*TW-6,3);
  ctx.strokeStyle='#2a1408'; ctx.lineWidth=2; ctx.strokeRect(tx*TW+3,ty*TH+3,tw*TW-6,th*TH-6);
  ctx.font=`${TH*1.1}px serif`; ctx.textAlign='center';
  ctx.fillText(emoji, (tx+tw/2)*TW, (ty+th/2+.4)*TH);
  drawCandle(tx+tw-1.5, ty+.6, .6);
}

function drawCandle(cx, cy, s=1) {
  const fl = Math.sin(animFrame*.2+cx*10)*.3+.7;
  ctx.fillStyle='#e8e0d0'; ctx.fillRect((cx-.08*s)*TW,cy*TH,TW*.16*s,TH*.5*s);
  const fh = TH*(.28+Math.sin(animFrame*.25+cy)*.06)*s*fl;
  ctx.fillStyle=`rgba(245,200,60,${fl})`; ctx.beginPath();
  ctx.ellipse(cx*TW,(cy-.1*s)*TH,TW*.09*s,fh,0,0,Math.PI*2); ctx.fill();
  const cg = ctx.createRadialGradient(cx*TW,cy*TH,0,cx*TW,cy*TH,TW*1.5*s);
  cg.addColorStop(0,`rgba(245,200,60,${.09*fl})`); cg.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle=cg; ctx.fillRect((cx-2)*TW,(cy-1)*TH,4*TW,4*TH);
}

function drawCauldron(cx, cy) {
  // legs
  ctx.fillStyle='#1a1a2a';
  ctx.fillRect((cx-.4)*TW,(cy+1.8)*TH,TW*.25,TH*.6);
  ctx.fillRect((cx+1.6)*TW,(cy+1.8)*TH,TW*.25,TH*.6);
  // body
  ctx.fillStyle=C.cauldronMetal; ctx.beginPath();
  ctx.ellipse((cx+1)*TW,(cy+1.2)*TH,TW*1.4,TH*1.3,0,0,Math.PI*2); ctx.fill();
  ctx.strokeStyle=C.cauldronRim; ctx.lineWidth=2; ctx.stroke();
  // liquid
  ctx.fillStyle=C.cauldronLiquid; ctx.beginPath();
  ctx.ellipse((cx+1)*TW,(cy+.2)*TH,TW*1.1,TH*.35,0,0,Math.PI*2); ctx.fill();
  // bubbles (always active, extra intense when cauldronBubbling)
  const intensity = cauldronBubbling ? 2.5 : 1;
  [[.5,.1],[1,.05],[1.5,.12],[.8,.08]].forEach(([bx,bp],i) => {
    const bub = Math.sin(animFrame*.15*intensity+i*1.2);
    if (bub > .2) {
      ctx.fillStyle=`rgba(60,160,60,${(bub-.2)*.8*intensity})`;
      ctx.beginPath(); ctx.arc((cx+bx)*TW,(cy+bp+bub*.2)*TH,TW*.14,0,Math.PI*2); ctx.fill();
    }
  });
  // steam
  [.6,1.1,1.6].forEach((sx,i) => {
    const st = (animFrame*.015*intensity + i*.4) % 1;
    ctx.strokeStyle=`rgba(100,200,100,${(1-st)*.4})`; ctx.lineWidth=1.5; ctx.beginPath();
    ctx.moveTo((cx+sx)*TW,(cy-st*1.5)*TH);
    ctx.bezierCurveTo((cx+sx+.3)*TW,(cy-st*1.5-.3)*TH,(cx+sx-.3)*TW,(cy-st*1.5-.6)*TH,(cx+sx)*TW,(cy-st*1.5-.9)*TH);
    ctx.stroke();
  });
}

function drawAmbientLight() {
  const W=canvas.width,H=canvas.height;
  const ff=.07+Math.sin(animFrame*.18)*.015;
  const g1=ctx.createRadialGradient(15.5*TW,3*TH,0,15.5*TW,3*TH,7*TW);
  g1.addColorStop(0,`rgba(201,124,42,${ff})`); g1.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle=g1; ctx.fillRect(0,0,W,H);
  const g2=ctx.createRadialGradient(29*TW,15*TH,0,29*TW,15*TH,4*TW);
  g2.addColorStop(0,'rgba(40,140,40,.07)'); g2.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle=g2; ctx.fillRect(24*TW,10*TH,10*TW,10*TH);
  const g3=ctx.createRadialGradient(2.5*TW,9*TH,0,2.5*TW,9*TH,3*TW);
  g3.addColorStop(0,'rgba(123,94,167,.08)'); g3.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle=g3; ctx.fillRect(0,5*TH,6*TW,10*TH);
  // music box purple glow
  const gm=ctx.createRadialGradient(2.5*TW,15*TH,0,2.5*TW,15*TH,3*TW);
  const mp=.04+Math.sin(animFrame*.08)*.02;
  gm.addColorStop(0,`rgba(123,94,167,${mp})`); gm.addColorStop(1,'rgba(0,0,0,0)');
  ctx.fillStyle=gm; ctx.fillRect(0,12*TH,6*TW,6*TH);
  // vignette
  const vg=ctx.createRadialGradient(W/2,H/2,H*.25,W/2,H/2,H*.75);
  vg.addColorStop(0,'rgba(0,0,0,0)'); vg.addColorStop(1,'rgba(5,4,12,.65)');
  ctx.fillStyle=vg; ctx.fillRect(0,0,W,H);
}