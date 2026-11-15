// End-to-end test of the automation against the mock MUD (never touches the real server or the real profiles).
//   node tools/autotest.js
const { spawn } = require('child_process'), fs = require('fs'), os = require('os'), path = require('path'), http = require('http');
const mock = require('./mockmud').start(4999);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kkmud-test-'));
const PORT = 8149, base = `http://127.0.0.1:${PORT}`;
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js'), String(PORT)],
  { env: { ...process.env, KK_DATA: path.join(tmp, 'data'), KK_LOGS: path.join(tmp, 'logs'), KK_RETRY_MS: '400' }, stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const post = (p, d) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) }).then(r => r.json());
let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!ok) fails++; };

(async () => {
  await sleep(700);
  const prof = await post('/api/profile', { name: '測試', host: '127.0.0.1', port: 4999, user: 'tester', password: 'testpass', autoLogin: true, autoReconnect: true,
    aliases: [{ name: 'gc', commands: 'get all from corpse' }, { name: 'two', commands: 'look;#wait 200;hp' }, { name: 'say2', commands: 'say %1 and %*' },
      { name: 'many', commands: Array(40).fill('poke').join(';') }],
    triggers: [{ enabled: true, pattern: '死了。', regex: false, commands: 'gc', cooldown: 1 }, { enabled: true, pattern: '^洪水 (\\d+)$', regex: true, commands: 'echo %1', cooldown: 0.2 }],
    timers: [{ enabled: true, every: 5, commands: 'hp' }],
    quick: [{ label: '看看', commands: 'look;#wait 200;hp' }, { label: '撿屍', commands: 'gc' }, ...Array(8).fill({}), { label: 'x', commands: 'extra' }, { label: 'y', commands: 'extra' }] });
  const s = prof.id;
  check('profile saved without exposing the password', prof.hasPassword === true && prof.password === undefined);
  check('quick buttons: always exactly ten slots', prof.quick.length === 10 && prof.quick[0].label === '看看' && !JSON.stringify(prof.quick).includes('extra'));

  // collect the event stream
  const events = [];
  http.get(`${base}/api/stream?s=${s}`, res => { let b = ''; res.on('data', d => { b += d; let i; while ((i = b.indexOf('\n\n')) >= 0) { const m = b.slice(0, i); b = b.slice(i + 2); if (m.startsWith('data: ')) events.push(JSON.parse(m.slice(6))); } }); });
  const stream = () => JSON.stringify(events);
  const got = () => mock.state.received;

  await post('/api/connect', { s });
  await sleep(900);
  check('auto-login reached the game', mock.state.logins === 1 && events.some(e => e.t === 'status' && e.inGame));
  check('password never appears in the browser stream', !stream().includes('testpass'));

  await post('/api/send', { s, text: 'gc' }); await sleep(300);
  check('alias gc -> get all from corpse', got().includes('get all from corpse') && !got().includes('gc'));
  await post('/api/send', { s, text: 'two' }); await sleep(700);
  check('alias with several commands and #wait', got().slice(-2).join() === 'look,hp', got().slice(-2).join());
  await post('/api/send', { s, text: 'say2 hello big world' }); await sleep(300);
  check('alias arguments %1 and %*', got().at(-1) === 'say hello and hello big world', got().at(-1));

  await post('/api/quick', { s, n: 0 }); await sleep(700);
  check('quick button runs several commands with #wait', got().slice(-2).join() === 'look,hp', got().slice(-2).join());
  const gcBefore = got().filter(x => x === 'get all from corpse').length;
  await post('/api/quick', { s, n: 1 }); await sleep(300);
  check('quick button can use an alias', got().filter(x => x === 'get all from corpse').length === gcBefore + 1);
  const r = await post('/api/quick', { s, n: 9 }), r2 = await post('/api/quick', { s, n: 99 });
  check('quick button: empty or missing slot sends nothing', got().at(-1) === 'get all from corpse' && r.ok === false && r2.ok === false);
  const kept = await post('/api/profile', { ...prof, quick: undefined });
  check('saving a profile without quick keeps the buttons', kept.quick[0].commands === 'look;#wait 200;hp');

  const before = got().filter(x => x === 'get all from corpse').length;
  await post('/api/send', { s, text: 'die' }); await sleep(500);
  check('trigger 死了。 -> gc', got().filter(x => x === 'get all from corpse').length === before + 1);

  const hpBefore = got().filter(x => x === 'hp').length;
  await sleep(5600);
  check('timer every 5 s -> hp', got().filter(x => x === 'hp').length > hpBefore);

  await post('/api/send', { s, text: 'kick' }); await sleep(1800);
  check('auto-reconnect and second auto-login', mock.state.logins === 2 && events.filter(e => e.t === 'status' && e.inGame).length >= 2, `logins=${mock.state.logins}`);

  await post('/api/send', { s, text: 'flood' }); await sleep(800);
  const echoes = got().filter(x => x.startsWith('echo ')).length;
  check('trigger cooldown: 40 matching lines at once fire it once', echoes === 1, `echo commands sent=${echoes}`);
  await post('/api/send', { s, text: 'many' }); await sleep(1200);
  const pokes = got().filter(x => x === 'poke').length;
  check('flood guard caps a runaway command list and pauses automation', pokes > 0 && pokes <= 30 && events.some(e => e.t === 'status' && e.paused), `poke commands sent=${pokes} of 40`);

  await post('/api/disconnect', { s }); await sleep(900);
  check('manual disconnect does not reconnect', mock.state.logins === 2);

  // wrong password: must stop instead of retrying forever
  const bad = await post('/api/profile', { name: '錯誤密碼', host: '127.0.0.1', port: 4999, user: 'tester', password: 'wrong', autoLogin: true, autoReconnect: true });
  await post('/api/connect', { s: bad.id }); await sleep(2500);
  check('wrong password is tried once, then automation stops', mock.state.passwords.filter(p => p === 'wrong').length === 1, `attempts=${mock.state.passwords.filter(p => p === 'wrong').length}`);

  const logs = fs.readdirSync(path.join(tmp, 'logs')).map(f => fs.readFileSync(path.join(tmp, 'logs', f), 'utf8')).join('\n');
  check('password never written to the logs', !logs.includes('testpass') && !logs.includes('wrong'));
  const list = await fetch(base + '/api/profiles').then(r => r.json());
  check('profile list never returns passwords', !JSON.stringify(list).includes('testpass'));

  srv.kill(); mock.server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(fails ? `\n${fails} FAILED` : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); srv.kill(); process.exit(1); });
