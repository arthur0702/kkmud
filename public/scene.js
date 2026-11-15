// 3D room view: tiled ground, walkways to the exits, sprites for scenery, glTF models for the player and creatures.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DIRS } from './config.js';

const A = '/assets/';
const HALF = 4.5;                 // room is 9x9 tiles, 1 unit = one 80px tile
const HUMAN_H = 1.3;              // on-screen height of a person, in tiles
const PITCH = Math.PI / 6;        // 30 degrees: makes square ground cells read as the 2:1 tiles the art was drawn for

export class RoomScene {
  constructor(canvas, overlay, handlers) {
    this.canvas = canvas; this.overlay = overlay; this.h = handlers;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.scene = new THREE.Scene(); this.scene.background = new THREE.Color(0x0b0c0f);
    this.camera = new THREE.OrthographicCamera(-6, 6, 4, -4, 0.1, 100);
    this.camera.position.set(0, Math.sin(PITCH) * 30, Math.cos(PITCH) * 30); this.camera.lookAt(0, 0.6, 0);
    this.room = new THREE.Group(); this.scene.add(this.room);
    this.actors = new THREE.Group(); this.scene.add(this.actors);
    this.loader = new GLTFLoader(); this.texLoader = new THREE.TextureLoader();
    this.gltf = new Map(); this.tex = new Map();
    this.mixers = new Set(); this.labels = []; this.exitBtns = [];
    this.things = []; this.k = null; this.player = null; this.walk = null; this.token = 0;
    this.clock = new THREE.Clock();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement); this.resize();
    this.renderer.setAnimationLoop(() => this.tick());
  }

  resize() {
    const p = this.canvas.parentElement, w = p.clientWidth, h = Math.max(1, p.clientHeight);
    this.renderer.setSize(w, h, false);
    // fit the 9x9 room: its screen footprint is 9 wide and 9*sin(pitch) + headroom tall
    const needW = HALF * 2 + 1.2, needH = HALF * 2 * Math.sin(PITCH) + 3.4;
    const s = Math.max(needW / (w / h), needH) / 2;
    Object.assign(this.camera, { left: -s * w / h, right: s * w / h, top: s, bottom: -s }); this.camera.updateProjectionMatrix();
  }

  texture(path) {
    if (!this.tex.has(path)) {
      const t = this.texLoader.load(A + path); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
      this.tex.set(path, t);
    }
    return this.tex.get(path);
  }

  async model(url) {
    if (!this.gltf.has(url)) this.gltf.set(url, this.loader.loadAsync(A + url).catch(() => null));
    const g = await this.gltf.get(url);
    if (!g) return null;
    const model = g.scene.clone(true);
    // the exported models face -Z (Unity is left-handed); turn them once so that rotation.y = 0 means "facing the camera"
    const turn = new THREE.Group(); turn.rotation.y = Math.PI; turn.add(model);
    const root = new THREE.Group(); root.add(turn);
    model.traverse(o => {
      if (!o.isMesh) return;
      const conv = m => {
        const shadow = /^shadow/i.test(m.name);
        return new THREE.MeshBasicMaterial({ map: m.map, color: shadow ? 0x000000 : m.color, alphaTest: shadow ? 0 : m.alphaTest, transparent: shadow,
          opacity: shadow ? 0.35 : 1, depthWrite: !shadow, side: THREE.DoubleSide });
      };
      o.userData.shadow = [].concat(o.material).some(m => /^shadow/i.test(m.name));
      o.material = Array.isArray(o.material) ? o.material.map(conv) : conv(o.material);
      if (/floor/i.test(o.name)) o.visible = false;
    });
    const mixer = g.animations.length ? new THREE.AnimationMixer(model) : null;
    const actor = { root, mixer, clips: g.animations, action: null, base: null };
    // native height, ignoring blob shadows
    const box = new THREE.Box3(); root.updateWorldMatrix(true, true);
    root.traverse(o => { if (o.isMesh && o.visible && !o.userData.shadow) box.expandByObject(o); });
    const sz = box.isEmpty() ? new THREE.Vector3(1, 1, 1) : box.getSize(new THREE.Vector3());
    actor.height = Math.max(0.01, sz.y);
    actor.span = Math.max(0.01, sz.y, 0.6 * Math.max(sz.x, sz.z));     // tall things by height, long things by length
    if (mixer) {
      this.mixers.add(mixer);
      mixer.addEventListener('finished', () => this.play(actor, 'idle'));
    }
    return actor;
  }

  play(actor, kind) {
    if (!actor?.mixer) return;
    const pick = re => actor.clips.find(c => re.test(c.name));
    const clip = { idle: pick(/@standby$/i) || pick(/@(none|idle)$/i) || pick(/standby|idle/i) || actor.clips[0],
      walk: pick(/@walk$/i) || pick(/walk|run/i), attack: pick(/@attack$/i) || pick(/@attack/i), hurt: pick(/@hurt/i), die: pick(/@die/i) }[kind];
    if (!clip) return;
    const next = actor.mixer.clipAction(clip);
    if (actor.action === next && (kind === 'idle' || kind === 'walk')) return;
    const once = kind === 'attack' || kind === 'hurt' || kind === 'die';
    next.reset(); next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity); next.clampWhenFinished = kind === 'die';
    if (actor.action && actor.action !== next) next.crossFadeFrom(actor.action, 0.12, false);
    next.play(); actor.action = next;
  }

  dispose(actor) {
    if (!actor) return;
    if (actor.mixer) { actor.mixer.stopAllAction(); this.mixers.delete(actor.mixer); }
    actor.root.removeFromParent();
    actor.root.traverse(o => { if (o.isMesh) for (const m of [].concat(o.material)) m.dispose(); });
  }

  async setPlayer(url) {
    const a = await this.model(url);
    if (!a) return;
    this.k = HUMAN_H / a.height;                      // one global scale keeps creatures in proportion to people
    this.dispose(this.player);
    a.root.scale.setScalar(this.k); this.actors.add(a.root); this.player = a; this.play(a, 'idle');
  }

  // ---- room
  setRoom(room, enterDir) {
    const token = ++this.token;
    this.room.clear();
    for (const b of this.exitBtns) b.remove(); this.exitBtns = [];
    const ground = (tile, w, d) => {
      const t = this.texture(`sprites/${tile}.png`).clone(); t.needsUpdate = true; t.repeat.set(w, d);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ map: t }));
      m.rotation.x = -Math.PI / 2; return m;
    };
    this.room.add(ground(room.terrain.tile, HALF * 2, HALF * 2));
    const hub = ground(room.terrain.path, 1.4, 1.4); hub.position.y = 0.004; this.room.add(hub);
    for (const ex of room.exits) {
      const d = DIRS[ex];
      if (!d || d.dz) continue;
      const len = Math.hypot(d.dx, d.dy) * HALF;
      const strip = ground(room.terrain.path, 1, len);          // the plane's long side lies along -Z before the yaw
      const g = new THREE.Group(); g.add(strip);
      g.position.set(d.dx * HALF / 2, 0.003, d.dy * HALF / 2); g.rotation.y = Math.atan2(-d.dx, -d.dy);
      this.room.add(g);
    }
    // up and down: a flight of steps behind the player, a dark opening in front
    const STAIRS = { up: new THREE.Vector3(1.05, 0, -0.85), down: new THREE.Vector3(-1.05, 0, 0.85) };
    if (room.exits.includes('up')) {
      for (let i = 0; i < 4; i++) {
        const h = 0.08 * (i + 1), step = new THREE.Mesh(new THREE.BoxGeometry(0.75, h, 0.18), new THREE.MeshBasicMaterial({ color: i % 2 ? 0x9a9184 : 0x8a8174 }));
        step.position.set(STAIRS.up.x, h / 2, STAIRS.up.z + 0.27 - i * 0.18); this.room.add(step);
      }
    }
    if (room.exits.includes('down')) {
      const rim = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.85), new THREE.MeshBasicMaterial({ color: 0x5d564c }));
      const hole = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 0.66), new THREE.MeshBasicMaterial({ color: 0x0a0a0c }));
      for (const [m, y] of [[rim, 0.006], [hole, 0.008]]) { m.rotation.x = -Math.PI / 2; m.position.set(STAIRS.down.x, y, STAIRS.down.z); this.room.add(m); }
    }
    // exit buttons live in the HTML overlay and are positioned every frame
    for (const ex of room.exits) {
      const d = DIRS[ex];
      const b = document.createElement('button');
      const vert = ex === 'up' || ex === 'down';
      b.className = 'exit' + (d && (!d.dz || vert) ? '' : ' side'); b.textContent = d ? d.zh + (ex === 'up' ? ' ↑' : ex === 'down' ? ' ↓' : '') : ex; b.title = ex;
      b.onclick = () => this.h.exit(ex);
      if (d && !d.dz) b._pos = new THREE.Vector3(d.dx * (HALF - 0.35), 0.02, d.dy * (HALF - 0.35));
      else if (vert) b._pos = STAIRS[ex].clone().setY(ex === 'up' ? 0.55 : 0.05);
      (b._pos ? this.overlay : document.getElementById('sideExits')).append(b); this.exitBtns.push(b);
    }
    // scenery sprites: seeded so a room always looks the same
    const rnd = mulberry(hash(room.name + room.exits.join()));
    for (const s of room.decor) {
      let x = 0, z = 0;
      for (let tries = 0; tries < 20; tries++) {
        x = (rnd() * 2 - 1) * (HALF - 0.6); z = (rnd() * 2 - 1) * (HALF - 0.6);
        // keep the stairs in sight: nothing close to them, and nothing tall standing between them and the camera
        const clear = ['up', 'down'].every(e => { if (!room.exits.includes(e)) return true; const s = STAIRS[e];
          return Math.hypot(x - s.x, z - s.z) > 1.2 && !(Math.abs(x - s.x) < 1 && z > s.z); });
        if (clear && Math.abs(x) > 1.3 && Math.abs(z) > 1.3 && Math.abs(Math.abs(x) - Math.abs(z)) > 0.9) break;
      }
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.texture(s.f), alphaTest: 0.5 }));
      sp.center.set(0.5, 0); sp.scale.set(s.w / 80, s.h / 80, 1); sp.position.set(x, 0, z); this.room.add(sp);
    }
    // player walks in from the side opposite to the way they travelled
    if (this.player) {
      const d = enterDir && DIRS[enterDir];
      if (d && !d.dz) {
        const from = new THREE.Vector3(-d.dx, 0, -d.dy).multiplyScalar(HALF - 0.6);
        this.player.root.position.copy(from); this.player.root.rotation.y = Math.atan2(d.dx, d.dy);
        this.walk = { from, t: 0, dur: 0.85 }; this.play(this.player, 'walk');
      } else { this.player.root.position.set(0, 0, 0); this.player.root.rotation.y = 0; this.walk = null; this.play(this.player, 'idle'); }
    }
    this.setThings([], token);
  }

  // things: [{name, id, url, kind}]
  async setThings(list, token = this.token) {
    const keep = new Map(this.things.map(t => [t.key, t]));
    const next = [];
    const SLOTS = [[-1.9, -1.2], [1.9, -1.2], [-2.6, 0.9], [2.6, 0.9], [0, -2.5], [-1.2, 2.3], [1.2, 2.3], [-3.3, -2.4], [3.3, -2.4], [-3.4, 2.6], [3.4, 2.6], [0, 3.3]];
    // each thing keeps its place while it is in the room; newcomers take the first free spot
    const shown = list.slice(0, SLOTS.length);
    const used = new Set(shown.map(t => keep.get(t.uid)?.slot).filter(s => s !== undefined));
    for (const t of shown) {
      let cur = keep.get(t.uid);
      if (cur) keep.delete(t.uid);
      else {
        let slot = keep.get(t.inherit)?.slot;                    // a corpse lies where its owner stood
        if (slot === undefined || used.has(slot)) slot = SLOTS.findIndex((_, i) => !used.has(i));
        used.add(slot);
        cur = { key: t.uid, slot, t, actor: null, pos: new THREE.Vector3(SLOTS[slot][0], 0, SLOTS[slot][1]), label: this.label(t) };
      }
      next.push(cur);
    }
    for (const old of keep.values()) { this.dispose(old.actor); old.label.remove(); }
    this.things = next;
    for (const cur of next) {
      if (cur.actor || cur.loading) continue;
      cur.loading = true;
      this.model(cur.t.url).then(a => {
        cur.loading = false;
        if (!a || !this.things.includes(cur) || token !== this.token) { if (a) this.dispose(a); return; }
        // creature models are not in a common unit, so each is fitted to a size class instead
        let s = this.k || 1;
        if (cur.t.kind === 'item' || cur.t.kind === 'corpse') s = (cur.t.kind === 'corpse' ? 1.1 : 0.8) / Math.max(a.span, a.height);
        else if (cur.t.kind === 'monster') s = sizeOf(cur.t.url) / a.span;
        a.root.scale.setScalar(s); a.root.position.copy(cur.pos);
        a.root.rotation.y = 0;                                    // everyone faces the viewer
        cur.h = a.height * s; cur.actor = a; this.actors.add(a.root); this.play(a, 'idle');
      });
    }
  }

  label(t) {
    const el = document.createElement('div');
    el.className = 'tag ' + t.kind; el.textContent = t.name; el.title = '點一下選擇動作';
    el.onclick = e => { e.stopPropagation(); this.h.thing(t, el); };
    this.overlay.append(el); return el;
  }

  // the living thing with this name (first one still standing)
  find(name) {
    const alive = this.things.filter(x => !x.dead && x.t.kind !== 'item' && x.t.kind !== 'corpse');
    return alive.find(x => x.t.name === name) || alive.find(x => name && (x.t.name.includes(name) || name.includes(x.t.name)));
  }

  // ev: {type:'attack', target, hit} | {type:'mobAttack', who, hit} | {type:'die', who} | {type:'cond', who, pct}
  act(ev) {
    const m = this.find(ev.who ?? ev.target);
    if (ev.type === 'attack') { this.play(this.player, 'attack'); if (ev.hit && m?.actor) this.play(m.actor, 'hurt'); }
    else if (ev.type === 'mobAttack') { if (m?.actor) this.play(m.actor, 'attack'); if (ev.hit) this.play(this.player, 'hurt'); }
    else if (ev.type === 'cond') { if (m) { m.label.style.setProperty('--hp', ev.pct + '%'); m.label.classList.add('hurt'); } }
    else if (ev.type === 'die') { if (m) { m.dead = true; m.label.classList.add('dead'); m.label.style.setProperty('--hp', '0%'); if (m.actor) this.play(m.actor, 'die'); } }
    return m;
  }

  project(v, el, dy = 0) {
    const p = v.clone().project(this.camera), w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    el.style.transform = `translate(-50%, -100%) translate(${(p.x + 1) / 2 * w}px, ${(1 - p.y) / 2 * h + dy}px)`;
  }

  tick() {
    const dt = Math.min(this.clock.getDelta(), 0.1);
    for (const m of this.mixers) m.update(dt);
    if (this.walk && this.player) {
      const w = this.walk; w.t += dt / w.dur;
      const k = Math.min(1, w.t);
      this.player.root.position.copy(w.from).multiplyScalar(1 - k);
      if (k >= 1) { this.walk = null; this.player.root.rotation.y = 0; this.play(this.player, 'idle'); }
    }
    for (const t of this.things) this.project(new THREE.Vector3(t.pos.x, (t.h || 1) + 0.15, t.pos.z), t.label);
    for (const b of this.exitBtns) if (b._pos) this.project(b._pos, b, 12);
    this.renderer.render(this.scene, this.camera);
  }
}

const BIG = /dragon(?!baby)|giant|behemoth|golem|cyclops|troll|ogre|elephant|talos|demon|devil|chimera|griffon|phoenix|kirin|wormlord|minotaur|bullhead|reaper/;
const SMALL = /^(bat|mouse|mousegold|rabbit\d*|chicken|kid_chicken|cat|butterfly|bird|slime|mushroom|snake|spider|fairy|elfin|elfincute|jellyfish|turtle|flower|carbuncle)$/;
const MID = /dog|wolf|pig|sheep|goat|deer|tiger|fox|monkey|dragonbaby|smalldragon|eagle/;
function sizeOf(url) { const n = url.split('/').slice(-2)[0]; return n === 'smalldragon' || n === 'dragonbaby' ? 1.3 : BIG.test(n) ? 2.7 : SMALL.test(n) ? 0.75 : MID.test(n) ? 1.05 : 1.35; }
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
export { hash };
