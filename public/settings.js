// Account switcher and the settings dialog (account / aliases / triggers / timers). Everything is stored by the local server.
import { sid, get, post } from './api.js';

const $ = id => document.getElementById(id);
let profiles = [], me = null;

async function load() {
  profiles = await get('/api/profiles');
  me = profiles.find(p => p.id === sid) || profiles[0];
  const sel = $('profile');
  sel.textContent = '';
  for (const p of profiles) sel.add(new Option(`${p.status?.connected ? '● ' : ''}${p.name}${p.user ? `（${p.user}）` : ''}`, p.id));
  sel.value = me.id;
  document.title = `${me.name} - 萬王之王 MUD`;
  drawQuick();
}

// ---- the ten quick buttons above the command line
let openAt = () => {};
function drawQuick() {
  const bar = $('quick'); bar.textContent = '';
  for (let i = 0; i < QUICK; i++) {
    const q = me?.quick?.[i] || {}, b = document.createElement('button');
    if (q.commands) {
      b.textContent = q.label || q.commands.split(';')[0].slice(0, 10);
      b.title = `${quickKey(i)}：${q.commands}`;
      b.onclick = () => runQuick(i);
    } else {
      b.className = 'empty'; b.textContent = `${(i + 1) % 10}`; b.title = `${quickKey(i)}：尚未設定，按一下設定快捷按鈕`;
      b.onclick = () => openAt('quick');
    }
    bar.append(b);
  }
}
async function runQuick(i) {
  if (!me?.quick?.[i]?.commands) return;
  const b = $('quick').children[i];
  b?.classList.add('ran'); setTimeout(() => b?.classList.remove('ran'), 300);
  const r = await post('/api/quick', { n: i }).catch(() => null);
  if (r?.ok) dispatchEvent(new CustomEvent('kk:quick', { detail: me.quick[i].commands }));
  if (!r?.ok) b && (b.title = `${quickKey(i)}：${me.quick[i].commands}（未送出：尚未連線或尚未登入）`);
  $('cmd').focus();
}
addEventListener('keydown', e => {                           // Alt+1 .. Alt+0
  if (!e.altKey || e.ctrlKey || e.metaKey || !/^Digit\d$/.test(e.code) || document.querySelector('dialog[open]')) return;
  const n = +e.code.slice(5); runQuick(n === 0 ? 9 : n - 1); e.preventDefault();
});

const urlFor = id => id === 'default' ? location.pathname : `${location.pathname}?s=${encodeURIComponent(id)}`;

// ---- editable lists
function row(cells, onRemove) {
  const r = document.createElement('div'); r.className = 'item-row';
  for (const c of cells) r.append(c);
  const x = document.createElement('button'); x.type = 'button'; x.textContent = '✕'; x.title = '刪除'; x.onclick = () => { r.remove(); onRemove?.(); };
  r.append(x); return r;
}
function field(cls, value, placeholder, type = 'text') {
  const i = document.createElement('input'); i.type = type; i.className = cls; i.value = value ?? ''; i.placeholder = placeholder; i.spellcheck = false; i.autocomplete = 'off';
  return i;
}
function check(label, value, title) {
  const l = document.createElement('label'); if (title) l.title = title;
  const i = document.createElement('input'); i.type = 'checkbox'; i.checked = !!value;
  l.append(i, label); return l;
}
const addAlias = (a = {}) => $('aliasList').append(row([field('w-m', a.name, '別名，如 gc'), field('w-l', a.commands, '指令，如 get all from corpse')]));
const addTrig = (t = { enabled: true, cooldown: 1 }) => $('trigList').append(row([
  check('啟用', t.enabled), field('w-l', t.pattern, '出現的文字，如 死了。'), check('正規', t.regex, '以正規表示式比對'),
  field('w-l', t.commands, '指令，如 get all from corpse'), field('w-s', t.cooldown, '冷卻秒', 'number')]));
const addTimer = (t = { enabled: true, every: 60 }) => $('timerList').append(row([
  check('啟用', t.enabled), field('w-s', t.every, '秒', 'number'), field('w-l', t.commands, '指令，如 hp')]));

const QUICK = 10;
const quickKey = i => `Alt+${(i + 1) % 10}`;
function quickRows(list) {
  $('quickList').textContent = '';
  for (let i = 0; i < QUICK; i++) {
    const q = list?.[i] || {};
    const r = document.createElement('div'); r.className = 'item-row';
    const k = document.createElement('span'); k.className = 'w-s key'; k.textContent = quickKey(i);
    r.append(k, field('w-m', q.label, '名稱，如 回家'), field('w-l', q.commands, '指令，如 recall;#wait 1000;look'));
    $('quickList').append(r);
  }
}

function fill(p) {
  $('pName').value = p.name || ''; $('pUser').value = p.user || ''; $('pPass').value = '';
  $('pPass').placeholder = p.hasPassword ? '已儲存（留空不變；輸入新密碼可更換）' : '未儲存';
  $('pAutoLogin').checked = !!p.autoLogin; $('pAutoRe').checked = !!p.autoReconnect;
  $('pHost').value = p.host || ''; $('pPort').value = p.port || '';
  for (const id of ['aliasList', 'trigList', 'timerList']) $(id).textContent = '';
  (p.aliases || []).forEach(addAlias); (p.triggers || []).forEach(addTrig); (p.timers || []).forEach(addTimer);
  quickRows(p.quick);
  $('pDel').hidden = p.id === 'default' || !p.id;
  $('pOpen').hidden = !p.id;
  $('setMsg').textContent = p.id ? '' : '新帳號：填好後按「儲存」';
}

function collect() {
  const rows = id => [...$(id).children].map(r => [...r.querySelectorAll('input')]);
  const out = {
    id: editing.id, name: $('pName').value.trim(), user: $('pUser').value.trim(), autoLogin: $('pAutoLogin').checked, autoReconnect: $('pAutoRe').checked,
    host: $('pHost').value.trim(), port: +$('pPort').value || undefined,
    aliases: rows('aliasList').map(([n, c]) => ({ name: n.value.trim(), commands: c.value.trim() })),
    triggers: rows('trigList').map(([en, pat, re, cmd, cool]) => ({ enabled: en.checked, pattern: pat.value, regex: re.checked, commands: cmd.value.trim(), cooldown: +cool.value || 1 })),
    timers: rows('timerList').map(([en, ev, cmd]) => ({ enabled: en.checked, every: +ev.value || 60, commands: cmd.value.trim() })),
    quick: rows('quickList').map(([label, cmd]) => ({ label: label.value.trim(), commands: cmd.value.trim() })),
  };
  if ($('pPass').value) out.password = $('pPass').value;          // left empty = keep whatever is stored
  return out;
}

let editing = null;
export async function initSettings() {
  await load();
  const dlg = $('settings');
  $('profile').onchange = () => { location.href = urlFor($('profile').value); };
  $('openSettings').onclick = async () => { await load(); editing = me; fill(me); tab('acct'); dlg.showModal(); };
  const tab = name => {
    for (const b of $('setTabs').children) b.classList.toggle('on', b.dataset.tab === name);
    for (const p of dlg.querySelectorAll('.pane')) p.hidden = p.dataset.pane !== name;
  };
  $('setTabs').onclick = e => { if (e.target.dataset.tab) tab(e.target.dataset.tab); };
  openAt = async name => { await load(); editing = me; fill(me); tab(name); dlg.showModal(); };
  $('aliasAdd').onclick = () => addAlias(); $('trigAdd').onclick = () => addTrig(); $('timerAdd').onclick = () => addTimer();
  $('pNew').onclick = () => { editing = { name: '', aliases: [], triggers: [], timers: [] }; fill(editing); tab('acct'); $('pName').focus(); };
  $('pOpen').onclick = () => window.open(urlFor(editing.id), '_blank');
  $('pDel').onclick = async () => {
    if (!confirm(`刪除帳號「${editing.name}」及其所有設定？`)) return;
    await fetch('/api/profile/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: editing.id }) });
    location.href = urlFor('default');
  };
  $('setSave').onclick = async () => {
    const data = collect();
    for (const t of data.triggers) if (t.regex) { try { new RegExp(t.pattern); } catch (e) { $('setMsg').textContent = `觸發的正規表示式有誤：${t.pattern}`; tab('trig'); return; } }
    if (data.autoLogin && !data.user) { $('setMsg').textContent = '自動登入需要填英文名字'; tab('acct'); return; }
    const saved = await fetch('/api/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(r => r.json());
    $('pPass').value = '';
    if (saved.id !== sid && !editing.id) { location.href = urlFor(saved.id); return; }      // a new account opens in its own page
    await load(); dlg.close();
  };
  setInterval(() => { if (!dlg.open) load().catch(() => {}); }, 15000);                      // keep the ● markers fresh
}
