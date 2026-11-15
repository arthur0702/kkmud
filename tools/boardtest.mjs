// Message-board parsing ("look board", "read n"):  node tools/boardtest.mjs [logs/<file>.log]
import fs from 'node:fs';
import { MudParser } from '../public/parser.js';

let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!ok) fails++; };
const replay = text => {
  const boards = [], posts = [], rooms = [];
  const p = new MudParser({ board: (list, desc, more) => boards.push({ list, desc, more }), post: (x, more, waiting) => posts.push({ ...x, more, waiting }), room: r => rooms.push(r) });
  for (const part of text.split(/(\n« .*? »\n)/)) { const c = /^\n« (.*?) »\n$/.exec(part); if (c) p.sent(c[1]); else p.feed(part); }
  return { boards, posts, rooms, p };
};
const strip = t => t.replace(/\x1b\[[\d;]*[A-Za-z]/g, '');

if (process.argv[2]) {
  const { boards, posts } = replay(strip(fs.readFileSync(process.argv[2], 'utf8')));
  check('the log has board listings', boards.length > 0, `${boards.length} found`);
  for (const b of boards) console.log(`      ${b.list.length} posts: ${b.desc}  last: [${b.list.at(-1)?.n}] ${b.list.at(-1)?.title} / ${b.list.at(-1)?.author}(${b.list.at(-1)?.id}) ${b.list.at(-1)?.date}`);
  for (const x of posts) console.log(`      post [${x.n}] ${x.title} / ${x.author}(${x.id}) ${x.date}: ${x.lines.length} lines, more=${x.more} waiting=${x.waiting}`);
}

// layout copied from the server (ANSI removed)
const list = '> \n« look board »\n這是一個供人留下建議的留言板。\n留言板的使用方法請見 help board。\n' +
  '[ 1]  回來玩了, 還有人在嗎?                      阿星(astar) (10/2  09:20 2023)\n' +
  '[ 2]  Re : 回來玩了, 還有人在嗎?              林小花(lily) (10/2  11:44 2023)\n' +
  '[ 6]  我最喜歡的三個練功點(參考新手指南) ♀星月♀雲朵(cloudy) (10/14 15:01 2008)\n' +
  '[27]  Re : 對新地圖的建議                 夜行者(nightowl) (10/28 10:05 2026)\n> 小雪球走了過來。\n';
const a = replay(list);
const b = a.boards[0];
check('one list, ended by the glued prompt', a.boards.length === 1 && b.more == null && b.list.length === 4);
check('board description kept', b?.desc === '這是一個供人留下建議的留言板。');
check('number, title, author, id, date', JSON.stringify(b?.list[1]) === JSON.stringify({ n: 2, title: 'Re : 回來玩了, 還有人在嗎?', author: '林小花', id: 'lily', date: '10/2 11:44 2023' }), JSON.stringify(b?.list[1]));
check('title ending in brackets, author with symbols', b?.list[2].title === '我最喜歡的三個練功點(參考新手指南)' && b.list[2].author === '♀星月♀雲朵');
check('the line after the list is still parsed normally', a.p.queue.length === 0 && a.p.board === null);

const post = '\n« read 27 »\n[27] Re : 對新地圖的建議                      夜行者(nightowl)(Wed Oct 28)\n' + '-'.repeat(70) + '\n\n' +
  '>在管理員(admin)的留言中提到 : \n> 新地圖的怪物有點太強。\n本文第一頁\n== 未完繼續 45% == (ENTER 繼續下一頁﹐q 離開﹐b 前一頁)' +
  '\n«  »\n> ，大家覺得呢？\n我的回覆\n\n== 本文完畢，請按任意鍵繼續 ...' + '\n«  »\n> ';
const c = replay('> ' + post);
check('post header', c.posts[0]?.n === 27 && c.posts[0].title === 'Re : 對新地圖的建議' && c.posts[0].id === 'nightowl' && c.posts[0].date === 'Wed Oct 28', JSON.stringify(c.posts[0]));
check('first page shown at the pager', c.posts[0]?.more === 45 && c.posts[0].lines.join('|') === '>在管理員(admin)的留言中提到 :|> 新地圖的怪物有點太強。|本文第一頁');
check('"> " inside a post is quoting, not the prompt', c.posts.length === 2 && c.posts[1].lines.includes('> ，大家覺得呢？'));
check('whole post at 本文完畢, waiting for a key', c.posts[1]?.more == null && c.posts[1].waiting === true && c.posts[1].lines.at(-1) === '我的回覆');
check('back in step after the post', c.p.post === null && c.p.paging === false && c.p.queue.length === 0, `queue=${c.p.queue.length}`);
const d = replay('> \n« read 3 »\n[ 3] 短文                   某人(someone) (1/1  00:00 2020)\n----------------\n一行字\n> ');
check('short post ended by the prompt', d.posts.length === 1 && d.posts[0].lines.join() === '一行字' && !d.posts[0].waiting);
const e = replay('> \n« look »\n[ 3] 不是留言                   某人(someone) (1/1  00:00 2020)\n> ');
check('a numbered line outside read/look board is not a post', e.posts.length === 0 && e.boards.length === 0);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
