// Built-in art that needs no game assets: chess pieces for everyone, a checkerboard floor in the colours of the
// terrain, and a few simple shapes for scenery. Everything is made from three.js primitives.
import * as THREE from 'three';

// ------------------------------------------------------------------ ground colours per terrain (TERRAIN keys in config.js)
// a / b: the two squares of the board, path: the walkways to the exits
export const BOARD = {
  plain:  { a: '#7a9a58', b: '#6c8c4c', path: '#b8a27a' },
  grass:  { a: '#74b05a', b: '#64a04b', path: '#c4ae80' },
  forest: { a: '#426e3c', b: '#365f31', path: '#8c6f4a' },
  road:   { a: '#a28c66', b: '#94805a', path: '#cdb88e' },
  city:   { a: '#a3a19a', b: '#8f8d86', path: '#cbc5b6' },
  indoor: { a: '#9c7549', b: '#88653d', path: '#8f3030' },
  cave:   { a: '#504a43', b: '#433d37', path: '#71685d' },
  water:  { a: '#4079aa', b: '#356a98', path: '#cdbd92' },
  beach:  { a: '#e4d29c', b: '#d6c289', path: '#bea673' },
  snow:   { a: '#eaf0f5', b: '#d6e0e9', path: '#b5c1cb' },
  lava:   { a: '#4c2b22', b: '#3b211a', path: '#d4592b' },
  swamp:  { a: '#5d6c3e', b: '#4f5d34', path: '#7c6b47' },
  mount:  { a: '#8c806d', b: '#7a6e5e', path: '#ab9b80' },
  desert: { a: '#ddc084', b: '#cfb075', path: '#c09c63' },
};
const boardOf = key => BOARD[key] || BOARD.plain;

// a 9x9 board texture, each square shaded a little differently (seeded, so a room always looks the same)
const boardTex = new Map();
export function boardTexture(key, cells = 9) {
  if (boardTex.has(key)) return boardTex.get(key);
  const c = document.createElement('canvas'), px = 32; c.width = c.height = cells * px;
  const g = c.getContext('2d'), { a, b } = boardOf(key), rnd = mulberry(hashStr(key));
  for (let y = 0; y < cells; y++) for (let x = 0; x < cells; x++) {
    g.fillStyle = shade((x + y) % 2 ? b : a, (rnd() - 0.5) * 0.08);
    g.fillRect(x * px, y * px, px, px);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter;
  boardTex.set(key, t); return t;
}
export const pathColor = key => new THREE.Color(boardOf(key).path);

// ------------------------------------------------------------------ pieces
const WHITE = 0xe9e3d4, PLAYER = 0xf1d68a, BLACK = 0x2c2c32, GOLD = 0xd9b24c, DEAD = 0x8f8a80;
const lathe = (pts, mat) => new THREE.Mesh(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), 40), mat);
const BASE = [[0, 0], [0.34, 0], [0.34, 0.07], [0.29, 0.1], [0.3, 0.14], [0.22, 0.18]];

function pawn(m) {
  const g = new THREE.Group();
  g.add(lathe([...BASE, [0.15, 0.24], [0.11, 0.46], [0.19, 0.5], [0.19, 0.54], [0.1, 0.57], [0, 0.57]], m));
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 32, 16), m); head.position.y = 0.7; g.add(head);
  return [g, 0.86];
}
function rook(m) {
  const g = new THREE.Group();
  g.add(lathe([...BASE, [0.2, 0.24], [0.17, 0.7], [0.25, 0.76], [0.25, 0.9], [0, 0.9]], m));
  for (let i = 0; i < 4; i++) {                                   // battlements
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.12, 0.13), m), a = i * Math.PI / 2 + Math.PI / 4;
    t.position.set(Math.cos(a) * 0.17, 0.96, Math.sin(a) * 0.17); t.rotation.y = -a; g.add(t);
  }
  return [g, 1.02];
}
function bishop(m) {
  const g = new THREE.Group();
  g.add(lathe([...BASE, [0.15, 0.26], [0.1, 0.68], [0.2, 0.72], [0.2, 0.76], [0.11, 0.79], [0, 0.79]], m));
  const mitre = new THREE.Mesh(new THREE.SphereGeometry(0.15, 32, 16), m); mitre.scale.y = 1.45; mitre.position.y = 0.97; g.add(mitre);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 8), m); tip.position.y = 1.2; g.add(tip);
  return [g, 1.25];
}
function queen(m) {
  const g = new THREE.Group();
  g.add(lathe([...BASE, [0.17, 0.26], [0.1, 0.82], [0.22, 0.86], [0.22, 0.9], [0.13, 0.94], [0.2, 1.12], [0.06, 1.1], [0, 1.1]], m));
  for (let i = 0; i < 8; i++) {                                   // crown points
    const b = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 6), m), a = i * Math.PI / 4;
    b.position.set(Math.cos(a) * 0.19, 1.14, Math.sin(a) * 0.19); g.add(b);
  }
  const top = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 8), m); top.position.y = 1.2; g.add(top);
  return [g, 1.27];
}
function king(m) {
  const g = new THREE.Group();
  g.add(lathe([...BASE, [0.18, 0.26], [0.11, 0.86], [0.23, 0.9], [0.23, 0.94], [0.13, 0.98], [0.19, 1.14], [0, 1.16]], m));
  const v = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.26, 0.07), m); v.position.y = 1.28; g.add(v);
  const h = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.07, 0.07), m); h.position.y = 1.31; g.add(h);
  return [g, 1.42];
}
function knight(m) {
  const g = new THREE.Group();
  g.add(lathe([...BASE, [0.2, 0.26], [0.22, 0.34], [0, 0.34]], m));
  // horse head, side profile in the XY plane, extruded sideways
  const s = new THREE.Shape();
  [[-0.16, 0.34], [0.16, 0.34], [0.14, 0.62], [0.2, 0.82], [0.3, 0.86], [0.34, 0.93], [0.24, 1.0], [0.08, 1.12], [0.02, 1.2],
    [-0.04, 1.08], [-0.14, 1.0], [-0.2, 0.84], [-0.2, 0.6]].forEach(([x, y], i) => (i ? s.lineTo(x, y) : s.moveTo(x, y)));
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.2, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2 });
  geo.translate(0, 0, -0.1);
  const head = new THREE.Mesh(geo, m); head.rotation.y = -0.5; g.add(head);     // turned a little towards the viewer
  return [g, 1.2];
}
const SHAPES = { pawn, rook, bishop, queen, king, knight };

// which piece stands in for whom
const ROLE = [
  [/國王|女王|皇后|王后|公主|王子|城主|領主|將軍|大臣/, n => (/女王|皇后|王后|公主/.test(n) ? 'queen' : 'king')],
  [/騎士|衛兵|守衛|士兵|警衛|隊長|士官|護衛|獵人|傭兵|戰士|劍士|武士/, () => 'knight'],
  [/主教|祭司|牧師|神父|修女|僧|法師|巫師|術士|賢者|長老|老者/, () => 'bishop'],
];
export function pieceFor(t, size = 1.35) {
  if (t.kind === 'player') return t.female ? 'queen' : 'king';
  if (t.kind === 'monster') return size >= 2 ? 'rook' : size >= 1.3 ? 'bishop' : size >= 1 ? 'knight' : 'pawn';
  for (const [re, f] of ROLE) if (re.test(t.name)) return f(t.name);
  return 'pawn';
}

// an actor in the shape scene.js expects: root (positioned), inner (animated), height
export function makePiece(t, size = 1.35) {
  const root = new THREE.Group(), inner = new THREE.Group(); root.add(inner);
  if (t.kind === 'item') {
    const m = new THREE.MeshStandardMaterial({ color: GOLD, roughness: 0.35, metalness: 0.5 });
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.24, 0.34), m); box.position.y = 0.12; box.rotation.y = 0.6; inner.add(box);
    return { root, inner, proc: true, fixed: true, height: 0.3, mats: [m] };
  }
  const color = t.kind === 'player' ? PLAYER : t.kind === 'corpse' ? DEAD : t.kind === 'monster' ? BLACK : WHITE;
  const m = new THREE.MeshStandardMaterial({ color, roughness: t.kind === 'monster' ? 0.3 : 0.5, metalness: 0.05, emissive: 0x000000 });
  const kind = t.kind === 'corpse' ? 'pawn' : pieceFor(t, size);
  const [g, h] = SHAPES[kind](m);
  // monsters are sized by how big the creature is; everyone else at chess proportions
  const scale = t.kind === 'monster' ? Math.max(0.7, Math.min(1.4, size / 1.35)) : 1;
  g.scale.setScalar(scale); inner.add(g);
  if (t.kind === 'corpse') { inner.rotation.z = -Math.PI / 2; inner.position.set(0.35, 0.18, 0); }     // a toppled piece
  return { root, inner, proc: true, fixed: true, height: t.kind === 'corpse' ? 0.4 : h * scale, mats: [m], dead: t.kind === 'corpse' };
}

// procedural animation (pieces have no clips): call every frame
export function animatePiece(a, dt) {
  const s = a.anim; if (!s || a.dead && s.kind !== 'die') return;
  s.t += dt;
  const p = a.inner, m = a.mats[0];
  if (s.kind === 'walk') { p.position.y = Math.abs(Math.sin(s.t * 11)) * 0.09; return; }
  if (s.kind === 'idle') { p.position.set(0, 0, 0); p.rotation.set(0, 0, 0); m.emissive?.setHex(0); a.anim = null; return; }
  if (s.kind === 'attack') {                                       // lunge forward and back
    const k = Math.min(1, s.t / 0.4); p.position.z = Math.sin(k * Math.PI) * 0.4; p.rotation.x = Math.sin(k * Math.PI) * 0.25;
    if (k >= 1) a.anim = { kind: 'idle', t: 0 };
  } else if (s.kind === 'hurt') {                                  // shake and flash red
    const k = Math.min(1, s.t / 0.35); p.position.x = Math.sin(s.t * 70) * 0.05 * (1 - k); m.emissive?.setRGB(0.55 * (1 - k), 0, 0);
    if (k >= 1) a.anim = { kind: 'idle', t: 0 };
  } else if (s.kind === 'die') {                                   // topple over and stay down
    const k = Math.min(1, s.t / 0.6), e = 1 - (1 - k) ** 3;
    p.rotation.z = -Math.PI / 2 * e; p.position.set(0.35 * e, 0.18 * e, 0); m.color?.lerp(new THREE.Color(DEAD), 0.08);
    if (k >= 1) { a.dead = true; a.anim = null; }
  }
}

// ------------------------------------------------------------------ scenery
// words in the room text -> simple shapes
export const DECOR_WORDS = { 樹: 'tree', 林: 'tree', 石: 'rock', 岩: 'rock', 碑: 'stone', 花: 'flower', 井: 'well' };
export function makeDecor(kind, terrainKey, rnd) {
  const g = new THREE.Group(), std = (c, r = 0.8) => new THREE.MeshStandardMaterial({ color: c, roughness: r });
  if (kind === 'tree') {
    const snow = terrainKey === 'snow', dark = terrainKey === 'forest' || terrainKey === 'swamp';
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.4, 8), std(0x6b4a2b)); trunk.position.y = 0.2; g.add(trunk);
    const leaf = std(snow ? 0xe8eef2 : dark ? 0x2f5a2c : 0x4f8a3c);
    for (let i = 0; i < 3; i++) { const c = new THREE.Mesh(new THREE.ConeGeometry(0.42 - i * 0.1, 0.5, 10), leaf); c.position.y = 0.55 + i * 0.28; g.add(c); }
    g.scale.setScalar(0.85 + rnd() * 0.45);
  } else if (kind === 'rock') {
    const r = new THREE.Mesh(new THREE.DodecahedronGeometry(0.28, 0), std(terrainKey === 'lava' ? 0x2a2522 : 0x7d776e, 0.95));
    r.scale.set(1.2, 0.7, 1); r.position.y = 0.16; r.rotation.y = rnd() * 3; g.add(r);
  } else if (kind === 'stone') {
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.6, 0.12), std(0x8d8a84, 0.9)); s.position.y = 0.3; g.add(s);
  } else if (kind === 'flower') {
    for (let i = 0; i < 5; i++) {
      const f = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 6), std([0xe2574c, 0xf1c443, 0xd77fd0, 0xffffff][i % 4], 0.6));
      f.position.set((rnd() - 0.5) * 0.5, 0.08, (rnd() - 0.5) * 0.5); g.add(f);
    }
  } else if (kind === 'well') {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.38, 0.32, 16, 1, true), std(0x8a8378, 0.9)); w.position.y = 0.16; g.add(w);
    const water = new THREE.Mesh(new THREE.CircleGeometry(0.33, 16), std(0x2d5f8a, 0.3)); water.rotation.x = -Math.PI / 2; water.position.y = 0.2; g.add(water);
  } else return null;
  return g;
}

// ------------------------------------------------------------------ helpers
function shade(hex, d) { const c = new THREE.Color(hex); const hsl = {}; c.getHSL(hsl); c.setHSL(hsl.h, hsl.s, Math.max(0, Math.min(1, hsl.l + d))); return '#' + c.getHexString(); }
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
export function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
