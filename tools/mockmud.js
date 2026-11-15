// A tiny stand-in for the MUD so automation can be tested without touching the real server.
//   node tools/mockmud.js [port]      accepts user "tester" / password "testpass"
// Commands: look, hp, die (prints a death line), kick (drops the connection), flood (prints 40 trigger lines), anything else -> What?
const net = require('net');
const { encodeBig5 } = require('../lib/big5');

// a small walkable world: "x,y,z" -> room
const WORLD = {
  '0,0,0': { name: '中央廣場', exits: { north: '0,-1,0', east: '1,0,0', south: '0,1,0', up: '0,0,1' } },
  '0,-1,0': { name: '北街', exits: { south: '0,0,0', north: '0,-2,0' } },
  '0,-2,0': { name: '北門', exits: { south: '0,-1,0' } },
  '1,0,0': { name: '東街', exits: { west: '0,0,0', east: '2,0,0' } },
  '2,0,0': { name: '東邊的森林', exits: { west: '1,0,0' } },
  '0,1,0': { name: '南方小路', exits: { north: '0,0,0' } },
  '0,0,1': { name: '鐘樓頂端', exits: { down: '0,0,0' } },
};
const ALIAS = { n: 'north', s: 'south', e: 'east', w: 'west', u: 'up', d: 'down' };
const show = at => { const r = WORLD[at], ex = Object.keys(r.exits);
  return `${r.name} - \n    這是測試世界的${r.name}。\n    這裡${ex.length === 1 ? '唯一的' : '明顯的'}出口是 ${ex.length === 1 ? ex[0] : ex.slice(0, -1).join('、') + ' 和 ' + ex.at(-1)}。\n` +
    (at === '0,0,0' ? '  測試留言板(Board) [ 3 張留言﹐3 張未讀 ]\n' : '') + '> '; };
// a message board in the server's layout; post 2 is long enough for the pager (3 pages, then "本文完畢" waits for a key)
const POSTS = [['測試公告', '管理員', 'admin'], ['Re : 測試公告', '小明', 'ming'], ['一篇短文', '小華', 'hua']];
const BOARD = '這是測試用的留言板。\n留言板的使用方法請見 help board。\n' + POSTS.map(([t, a, id], i) => `\x1b[1;33m[${String(i + 1).padStart(2)}]\x1b[2;37;0m  ${t.padEnd(36)}${a}(${id}) (11/${i + 1}  10:00 2026)`).join('\n') + '\n> ';
const postPages = n => { const [t, a, id] = POSTS[n - 1], head = `[${n}] ${t}                      ${a}(${id})(Sun Nov ${n})\n${'-'.repeat(70)}\n`;
  if (n !== 2) return [head + `第 ${n} 篇的內容。\n> `];
  const body = i => Array.from({ length: 5 }, (_, k) => `${k ? '' : '> 引用的一行\n'}第 ${i} 頁第 ${k + 1} 行`).join('\n');
  return [head + body(1) + '\n== 未完繼續 \x1b[1;33m33%\x1b[2;37;0m == (ENTER 繼續下一頁﹐q 離開﹐b 前一頁)', '\n' + body(2) + '\n== 未完繼續 66% == (ENTER 繼續下一頁﹐q 離開﹐b 前一頁)',
    '\n' + body(3) + '\n\n== 本文完畢，請按任意鍵繼續 ...', '\n> ']; };

exports.start = (port = 4999) => {
  const state = { received: [], logins: 0, passwords: [] };
  const server = net.createServer(sock => {
    const out = s => sock.write(encodeBig5(s.replace(/\n/g, '\r\n')));
    let stage = 0, buf = '', at = '0,0,0', pages = null;
    out('\n萬  王  之  王 (mock)\n\n您的英文名字(新人物請輸入\'new\') : ');
    sock.on('data', d => {
      buf += d.toString('latin1').replace(/\xff[\xfb-\xfe][\s\S]/g, '');      // drop the client's telnet option replies
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, ''); buf = buf.slice(i + 1);
        if (stage === 0) { if (line === 'tester') { stage = 1; sock.write(Buffer.from([255, 251, 1])); out('請輸入密碼﹕'); } else out('沒有這個人物。\n您的英文名字(新人物請輸入\'new\') : '); continue; }
        if (stage === 1) {
          state.passwords.push(line);
          sock.write(Buffer.from([255, 252, 1]));
          if (line === 'testpass') { stage = 2; state.logins++; out('\n重新連線完畢。\n> '); } else { stage = 0; out('\n密碼錯誤 !\n您的英文名字(新人物請輸入\'new\') : '); }
          continue;
        }
        state.received.push(line);
        if (pages) {                                          // the pager takes the whole line: q leaves, anything else turns the page
          if (line === 'q') { pages = null; out('\n> '); } else { out(pages.shift()); if (!pages.length) pages = null; }
          continue;
        }
        if (line === 'look board' && at === '0,0,0') { out(BOARD); continue; }
        const rd = /^read (\d+|new)$/.exec(line);
        if (rd && at === '0,0,0') { const n = rd[1] === 'new' ? 2 : +rd[1]; if (!POSTS[n - 1]) { out('沒有這個編號的留言。\n> '); continue; }
          pages = postPages(n); out(pages.shift()); if (!pages.length) pages = null; continue; }
        const dir = ALIAS[line] || line;
        if (WORLD[at].exits[dir]) { at = WORLD[at].exits[dir]; out(show(at)); continue; }
        if (['north', 'south', 'east', 'west', 'up', 'down', 'northeast', 'northwest', 'southeast', 'southwest'].includes(dir)) { out('這個方向沒有出路。\n> '); continue; }
        if (line === 'l') { out(show(at)); continue; }
        if (line === 'look') out('測試房間 - \n    這是一個測試用的房間。\n    這裡唯一的出口是 north。\n  新手冒險者(Adventurer)\n> ');
        else if (line === 'hp') out('體力 :  116/ 116\n法力 :   30/  26\n> ');
        else if (line === 'die') out('\n新手冒險者死了。\n\n(你得到 69 點經驗。)\n> ');
        else if (line === 'get all from corpse') out('你從新手冒險者的屍體中拿出五枚金幣。\nOk。\n> ');
        else if (line === 'kick') sock.destroy();
        else if (line === 'flood') out(Array.from({ length: 40 }, (_, k) => `洪水 ${k}`).join('\n') + '\n> ');
        else out('What?\n> ');
      }
    });
    sock.on('error', () => {});
  });
  server.listen(port, '127.0.0.1');
  return { server, state };
};

if (require.main === module) { const port = +process.argv[2] || 4999; exports.start(port); console.log('mock MUD on', port); }
