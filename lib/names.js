// Name -> id book shared by every account: learnt from each "名字(Id)" the MUD prints (room lists, score, who, board
// authors, ...), saved in data/names.json, and seeded from the session logs at start-up. Used to turn "小雨" into "rainy".
const fs = require('fs'), path = require('path');

const MAX = 5000;
// a name (no spaces or punctuation, at most 12 characters) right before "(Id)"
const PAIR = /([^\s「」『』()（）:：,，。!！?？>]{1,12})\(([A-Za-z][A-Za-z']{1,19}(?: [A-Za-z][A-Za-z']*){0,3})\)/g;

const book = new Map();
let file = null, timer = null;

function learn(text) {
  let added = 0;
  for (const m of String(text).matchAll(PAIR)) {
    const name = m[1], id = m[2].toLowerCase();
    if (book.get(name) === id) continue;
    book.delete(name); book.set(name, id); added++;               // newest last, so the oldest go first when full
  }
  if (!added) return 0;
  while (book.size > MAX) book.delete(book.keys().next().value);
  if (file) { clearTimeout(timer); timer = setTimeout(save, 2000); }
  return added;
}
const idOf = name => book.get(name) || '';

function save() {
  if (!file) return;
  const tmp = file + '.tmp';
  fs.writeFile(tmp, JSON.stringify(Object.fromEntries(book)), err => { if (!err) fs.rename(tmp, file, () => {}); });
}

// load the saved book, then read the newest logs (they may hold names seen before this feature existed)
function load(dataDir, logDir) {
  file = path.join(dataDir, 'names.json');
  try { for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(file, 'utf8')))) book.set(k, v); } catch { /* first run */ }
  try {
    const logs = fs.readdirSync(logDir).filter(f => f.endsWith('.log'))
      .map(f => ({ f, t: fs.statSync(path.join(logDir, f)).mtimeMs })).sort((a, b) => a.t - b.t).slice(-40);
    for (const { f } of logs) learn(fs.readFileSync(path.join(logDir, f), 'utf8').replace(/\x1b\[[\d;?]*[A-Za-z]/g, '').replace(/« .*? »/g, ''));
  } catch { /* no logs yet */ }
}

module.exports = { learn, idOf, load, book };
