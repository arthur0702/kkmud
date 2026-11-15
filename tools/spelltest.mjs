// Casting voices: which spell went off, and 你/妳:  node tools/spelltest.mjs
import { MudParser } from '../public/parser.js';
import { SPELL_VOICE } from '../public/config.js';

let fails = 0;
const check = (name, ok, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); if (!ok) fails++; };
const replay = text => {
  const got = [];
  const p = new MudParser({ cast: (spell, sex) => got.push(spell + '/' + sex) });
  for (const part of text.split(/(\n« .*? »\n)/)) { const c = /^\n« (.*?) »\n$/.exec(part); if (c) p.sent(c[1]); else p.feed(part); }
  return got;
};

// replies captured from the server
const log = '> \n« cast float »\n妳喃喃唸道 : 摩里多納 ～～ 賀魯 ...\n> 妳緩緩從地面升起 ...\n' +
  '\n« cast bless »\n妳低頭喃喃唸道 : 以大地之神 - 凱亞的聖名, 降福於吾身吧 !\n> 一道藍色的光芒緩緩從地面升起 ...\n' +
  '\n« cast strong »\n你高舉雙手 : 戰神啊 ! 加您的神力於吾身吧 !\n> 你渾身肌肉變得更發達 ...\n' +
  '\n« cast strong »\n你已經夠壯了。\n> ' +
  '\n« cast arc_fire »\n你要有目標才能施法。\n> ' +
  '\n« say 你好 »\n你說道 : 你好\n> ' +
  "\n« cast 'heal' me »\n妳低頭喃喃唸道 : 慈愛之神黛妮雅啊 ... 請治療您的信徒吧 !\n> ";
const got = replay(log);
check('each spell that went off, with 你/妳', got.join() === 'float/f,bless/f,strong/m,heal/f', got.join());
check('a failed cast and an ordinary "說道 :" stay silent', !got.includes('arc_fire/m') && got.length === 4);

// numbers confirmed by matching the recordings to incantations seen in real sessions
const sure = { angel: 1, bless: 5, calm: 7, cure: 9, cure_poison: 10, death_touch: 13, demon_bane: 15, detect_invi: 17, divine_dust: 18, first_aid: 26,
  float: 30, heal: 35, holy_blast: 37, holy_word: 43, make_rope: 54, mind_blast: 55, natural_heal: 57, pure_shield: 61, restore: 63, sanctuary: 64,
  spectre_touch: 69, strong: 75 };
const off = Object.entries(sure).filter(([k, v]) => SPELL_VOICE[k] !== v);
check(`${Object.keys(sure).length} confirmed voice numbers`, !off.length, off.map(([k, v]) => `${k}=${SPELL_VOICE[k]} (want ${v})`).join(' '));
const nums = Object.values(SPELL_VOICE);
check('no voice is used by two spells', new Set(nums).size === nums.length);

console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
