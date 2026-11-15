// One MUD connection per profile: telnet, Big5, logging, plus the automation that has to survive a closed browser tab
// (auto-login, auto-reconnect, aliases, triggers, timers).
const net = require('net'), fs = require('fs'), path = require('path');
const { encodeBig5 } = require('./big5');

const RETRY = (process.env.KK_RETRY_MS || '5000,15000,30000,60000,120000,300000').split(',').map(Number);
const MAX_RETRIES = 20;
const FLOOD = { max: 30, windowMs: 10000 };          // automated commands allowed per window before automation is paused
const LOGIN = { name: /英文名字/, password: /輸入密碼/ };
const sleep = ms => new Promise(r => setTimeout(r, ms));

class Session {
  constructor(id, getProfile, logDir) {
    this.id = id; this.getProfile = getProfile; this.logDir = logDir;
    this.clients = new Set(); this.backlog = [];
    this.sock = null; this.echoOff = false; this.inGame = false;
    this.wanted = false; this.retries = 0; this.retryTimer = null; this.timers = [];
    this.auto = []; this.paused = false; this.trigLast = new Map();
  }
  get profile() { return this.getProfile(this.id); }

  // ---- browser side
  push(msg) {
    if (msg.t === 'text' || msg.t === 'cmd' || msg.t === 'sys') { this.backlog.push(msg); if (this.backlog.length > 500) this.backlog.shift(); }
    const line = 'data: ' + JSON.stringify(msg) + '\n\n';
    for (const r of this.clients) r.write(line);
  }
  sys(text) { this.push({ t: 'sys', d: text }); }
  status() {
    const p = this.profile || {};
    return { t: 'status', s: this.id, connected: !!this.sock, inGame: this.inGame, echoOff: this.echoOff, host: p.host, port: p.port,
      reconnecting: !!this.retryTimer, paused: this.paused };
  }

  // ---- connection
  connect(manual = true) {
    if (this.sock) return;
    const p = this.profile; if (!p) return;
    if (manual) { this.retries = 0; this.loginFailed = false; this.paused = false; this.auto = []; }
    clearTimeout(this.retryTimer); this.retryTimer = null;
    this.wanted = true;
    this.decoder = new TextDecoder('big5'); this.pending = Buffer.alloc(0); this.echoOff = false; this.inGame = false;
    this.tail = ''; this.lineBuf = ''; this.stage = 0;
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    this.log = fs.createWriteStream(path.join(this.logDir, `${this.id === 'default' ? 'session' : this.id}-${stamp}.log`));
    const s = net.connect(p.port, p.host);
    this.sock = s;
    s.setKeepAlive(true, 30000);
    s.on('connect', () => this.push(this.status()));
    s.on('data', d => { if (this.sock === s) this.onData(d); });
    s.on('error', e => this.sys('連線錯誤：' + e.message));
    s.on('close', () => { if (this.sock === s) this.closed(); });
  }

  disconnect() { this.wanted = false; clearTimeout(this.retryTimer); this.retryTimer = null; this.sock?.destroy(); this.push(this.status()); }

  closed() {
    const wasLoggingIn = this.stage > 0 && this.stage < 3;
    this.sock = null; this.echoOff = false; this.inGame = false; this.stopTimers();
    this.log?.end(); this.log = null;
    this.sys('連線已中斷。');
    const p = this.profile;
    if (this.wanted && p?.autoReconnect && !this.loginFailed) {
      if (wasLoggingIn) this.retries += 4;                      // dropped during login: give up quickly rather than hammer the server
      if (this.retries < MAX_RETRIES) {
        const wait = RETRY[Math.min(this.retries, RETRY.length - 1)];
        this.retries++;
        this.sys(`${Math.round(wait / 1000)} 秒後自動重新連線（第 ${this.retries} 次）。`);
        this.retryTimer = setTimeout(() => { this.retryTimer = null; this.connect(false); }, wait);
      } else this.sys('自動重連次數已達上限，已停止。');
    }
    this.push(this.status());
  }

  onData(chunk) {
    const b = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk;
    this.pending = Buffer.alloc(0);
    const out = [];
    for (let i = 0; i < b.length; i++) {
      if (b[i] !== 255) { out.push(b[i]); continue; }
      if (i + 1 >= b.length) { this.pending = b.subarray(i); break; }
      const cmd = b[i + 1];
      if (cmd === 255) { out.push(255); i++; continue; }
      if (cmd >= 251 && cmd <= 254) {
        if (i + 2 >= b.length) { this.pending = b.subarray(i); break; }
        const opt = b[i + 2]; i += 2;
        if (cmd === 251) { if (opt === 1) { this.sock.write(Buffer.from([255, 253, 1])); this.setEcho(true); } else this.sock.write(Buffer.from([255, 254, opt])); }
        else if (cmd === 252) { if (opt === 1) { this.sock.write(Buffer.from([255, 254, 1])); this.setEcho(false); } }
        else if (cmd === 253) this.sock.write(Buffer.from([255, 252, opt]));
        continue;
      }
      if (cmd === 250) {
        let j = i + 2; while (j + 1 < b.length && !(b[j] === 255 && b[j + 1] === 240)) j++;
        if (j + 1 >= b.length) { this.pending = b.subarray(i); break; }
        i = j + 1; continue;
      }
      i++;
    }
    if (!out.length) return;
    const text = this.decoder.decode(Buffer.from(out), { stream: true }).replace(/\r/g, '');
    if (!text) return;
    this.log?.write(text);
    this.push({ t: 'text', d: text });
    this.scan(text);
  }
  setEcho(off) { if (this.echoOff !== off) { this.echoOff = off; this.push(this.status()); } }

  // ---- reading the output: login prompts, "in game" detection, triggers
  scan(text) {
    const plain = text.replace(/\x1b\[[\d;?]*[A-Za-z]/g, '');
    this.lineBuf += plain;
    const parts = this.lineBuf.split('\n'); this.lineBuf = parts.pop();
    this.tail = this.lineBuf;                                  // prompts arrive without a newline
    this.login();
    if (!this.inGame && /^(> )+$/.test(this.tail)) this.entered();
    if (this.inGame) for (const l of parts) this.trigger(l.replace(/^(> )+/, '').replace(/\s+$/, ''));
  }

  login() {
    const p = this.profile;
    if (!p?.autoLogin || !p.user || this.loginFailed || this.stage >= 3) return;
    if (LOGIN.name.test(this.tail)) {
      if (this.stage >= 1) {                                    // asked for the name again: the login was refused
        this.loginFailed = true; this.stage = 9;
        this.sys('自動登入失敗（伺服器再次要求輸入名字），已停止自動登入與自動重連。請檢查帳號設定。');
        return;
      }
      this.stage = 1; this.tail = ''; this.lineBuf = '';
      this.send(p.user, { auto: true });
    } else if (this.stage === 1 && LOGIN.password.test(this.tail)) {
      if (!p.password) { this.stage = 9; this.sys('未儲存密碼，請手動輸入。'); return; }
      this.stage = 2; this.tail = ''; this.lineBuf = '';
      this.sock.write(Buffer.concat([encodeBig5(p.password), Buffer.from('\r\n')]));      // never logged, never sent to the browser
      this.sys('已自動送出密碼。');
    }
  }

  entered() {
    this.inGame = true; this.stage = 3; this.retries = 0;
    this.push(this.status());
    this.startTimers();
  }

  // ---- automation
  startTimers() {
    this.stopTimers();
    for (const t of this.profile?.timers || []) {
      if (!t.enabled || !t.commands) continue;
      const every = Math.max(5, +t.every || 0) * 1000;
      this.timers.push(setInterval(() => { if (this.inGame && !this.paused) this.run(t.commands, []); }, every));
    }
  }
  stopTimers() { for (const t of this.timers) clearInterval(t); this.timers = []; }
  reloadProfile() { if (this.inGame) this.startTimers(); this.trigLast.clear(); this.paused = false; this.auto = []; this.push(this.status()); }

  trigger(line) {
    if (!line || this.paused) return;
    const list = this.profile?.triggers || [];
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (!t.enabled || !t.pattern || !t.commands) continue;
      let groups = null;
      if (t.regex) { try { const m = new RegExp(t.pattern).exec(line); if (m) groups = m.slice(1); } catch { continue; } }
      else if (line.includes(t.pattern)) groups = [];
      if (!groups) continue;
      const now = Date.now(), cool = Math.max(0.2, +t.cooldown || 1) * 1000;
      if (now - (this.trigLast.get(i) || 0) < cool) continue;
      this.trigLast.set(i, now);
      this.run(t.commands, groups);
    }
  }

  // "a;b;#wait 500;c" with %1..%9 and %* filled in; each part may itself be an alias
  async run(commands, args, depth = 0, auto = true) {
    const fill = s => s.replace(/%(\d|\*)/g, (_, k) => k === '*' ? args.join(' ') : (args[+k - 1] ?? ''));
    for (const raw of String(commands).split(';')) {
      const part = fill(raw.trim());
      if (!part) continue;
      if (!this.sock) return;
      const w = /^#wait\s+(\d+)$/i.exec(part);
      if (w) { await sleep(Math.min(60000, +w[1])); continue; }
      if (!this.expand(part, depth + 1, auto)) this.send(part, { auto });
    }
  }

  // returns true when `text` was an alias and has been run
  expand(text, depth, auto) {
    if (depth > 5) return false;
    const words = text.trim().split(/\s+/);
    const a = (this.profile?.aliases || []).find(x => x.name && x.name === words[0] && x.commands);
    if (!a) return false;
    this.run(a.commands, words.slice(1), depth);              // an expansion is a script: it counts toward the flood guard
    return true;
  }

  // a quick button: same rules and same flood guard as an alias (";", "#wait", other aliases)
  userRun(commands) {
    if (!this.sock || this.echoOff || !this.inGame) return false;
    this.run(commands, [], 1);
    return true;
  }

  // typed by the user
  userSend(text) {
    if (!this.sock) return false;
    if (this.echoOff || !this.inGame || !this.expand(text, 1, false)) this.send(text, {});
    return true;
  }

  send(text, { auto = false } = {}) {
    if (!this.sock) return;
    if (auto) {
      const now = Date.now();
      this.auto = this.auto.filter(t => now - t < FLOOD.windowMs); this.auto.push(now);
      if (this.auto.length > FLOOD.max) {
        if (!this.paused) { this.paused = true; this.sys('自動指令過於頻繁，觸發與定時已暫停。請檢查設定；儲存設定或重新連線後恢復。'); this.push(this.status()); }
        return;
      }
    }
    this.sock.write(Buffer.concat([encodeBig5(text), Buffer.from('\r\n')]));
    // never log or broadcast input typed while the server hides echo (passwords)
    if (!this.echoOff) { this.log?.write(`\n« ${text} »\n`); this.push({ t: 'cmd', d: text, auto }); }
  }
}

module.exports = { Session };
