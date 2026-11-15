// Tunable rules: how MUD text is recognised and which art stands in for what.
// Everything here is heuristic - adjust it against real session logs (kkmud/logs/*.log).

export const PARSER = {
  // A line that lists the exits marks "this block of text is a room". Group 1 = the exit list.
  // Captured from kks.muds.idv.tw:  "    這裡明顯的出口是 north、south 和 east。"  /  "    這裡唯一的出口是 south。"
  exits: [
    /^\s*這裡(?:明顯的|唯一的)?出口是\s*(.+)$/,
    /^\s*(?:這裡)?(?:明顯的|唯一的)?(?:出口|出路)\s*(?:是|有|為)?\s*[:：]?\s*([A-Za-z].*)$/,
    /^\s*(?:obvious )?exits?\s*(?:are|is)?\s*[:：]\s*(.+)$/i,
  ],
  noExits: /^\s*這裡沒有(?:任何)?(?:明顯的)?(?:出口|出路)/,
  // Room title line:  "綠色矮人酒吧 - "
  title: /^([^\s,，。、:：][^,，。]{0,19}?)\s+-\s*$/,          // short, unindented, no punctuation: description lines can also end in " - "
  // Lines inside the description that are weather/time rather than the place itself.
  ambient: /^\s*(?:太陽|月亮|夕陽|朝陽|夜幕|天色|星星|繁星|一輪|黎明|黃昏).{0,40}。$/,
  // "你撿起十枚金幣。" / "你撿起一柄短劍。" - something left the floor (group 1 = what, with its measure word).
  picked: /^你撿起(.{1,30}?)。\s*$/,
  // People coming and going (captured):  阿德走了過來。  青嵐飄了過來。  阿德往西離開。  青嵐往西飄去。  阿德祈求神把阿德帶回冒險者之家 ...
  // Group 1 is the name. Names never contain spaces or punctuation, which keeps chat and descriptions from matching.
  arrive: /^([^\s:：,，。「」()（）]{1,20}?)(?:走|飄|飛|跑|爬|游|跳|衝|滾|溜|騎)了過來。$/,
  leave: [
    /^([^\s:：,，。「」()（）]{1,20}?)往[東西南北上下][東西南北]?(?:方|邊|面)?(?:離開|離去|走去|飄去|飛去|跑去|爬去|游去|逃去|逃走|騎去)了?。$/,
    /^([^\s:：,，。「」()（）]{1,20}?)祈求神把.{1,20}?帶回冒險者之家/,
  ],
  // Pager for long output:  "== 未完繼續 51% == (ENTER 繼續下一頁﹐q 離開﹐b 前一頁)"  - no prompt follows until it is answered.
  pager: /^== 未完繼續\s*(\d+)%\s*==/,
  // Reply to "i" / "inventory":
  //   你身上帶著下列這些東西(負重 725/1050 )﹕
  //       ￠小木彈弓￠(Small wooden bow)        <- carried
  //     ˇ短劍(Shortsword)                      <- "ˇ" = in use (wielded or worn)
  invHead: /^你身上帶著下列這些東西(?:\(負重\s*(\d+)\s*\/\s*(\d+)\s*\))?/,
  invItem: /^ {2}(ˇ| {2})\s*(.+?)\(([A-Za-z][\w' -]{0,40})\)\s*$/,
  invEmpty: /^你身上(?:沒有|什麼也沒)(?:帶|攜帶)?(?:任何)?東西/,
  // Message boards (captured). "look board":
  //   這是一個供人留下建議的留言板。                        <- the board's own description
  //   留言板的使用方法請見 help board。
  //   [ 1]  回來玩了, 還有人在嗎?                      阿星(astar) (10/2  09:20 2023)
  // "read 27" (paged like any long output, and ends with "== 本文完畢，請按任意鍵繼續 ..." which also waits for a key):
  //   [27] Re : 對新地圖的建議                      夜行者(nightowl)(Wed Oct 28)
  //   ----------------------------------------------------------------------
  boardHead: /^留言[板版]的使用方法請見 help board/,
  boardItem: /^\[\s*(\d+)\]\s+(.+?)\s+(\S+?)\(([A-Za-z][\w-]*)\)\s*\(\s*([^)]*?)\s*\)\s*$/,
  postEnd: /^== 本文完畢/,
  // What your character says when a spell goes off (captured), right after "cast ...":
  //   妳喃喃唸道 : 摩里多納 ～～ 賀魯 ...      妳低頭喃喃唸道 : 以大地之神 - 凱亞的聖名, 降福於吾身吧 !      你高舉雙手 : 戰神啊 ! ...
  // Group 1 is 你 (male) or 妳 (female). A failed cast ("你要有目標才能施法。") has no colon, so it stays silent.
  incant: /^([你妳])[^\s:：「」,，。!！]{1,10}\s*[:：]\s*\S/,
  // A move that did not happen.
  blocked: /這個方向沒有出路|沒有這個方向|你不能往|擋住了你|門是關著的|^What\?$/,
  exitSplit: /[、,，\s和及與跟。.\[\]【】()（）]+/,
  // A line under the exits that names something present: "名字(id)" with optional decorations.
  thing: /^[\s　]*(?:[\[【<（(][^\]】>）)]{1,8}[\]】>）)]\s*)*(?:「[^」]{0,24}」)?\s*(.{1,30}?)\s*\(([A-Za-z][\w' -]{0,30})\)/,     // "  「稱號」名字(Id) [附註]"
  thingMaxPlain: 24,                 // lines without "(id)" still count if this short
  prompt: /^[>\]]\s*$|^.{0,40}[>:：]\s*$/,
  hp: [/(?:HP|生命|體力)[\s:：<>]*(\d+)\s*[\/／]\s*(\d+)/i],          // "體力 :  116/ 116"  and  "<體力>  116/ 116"
  mp: [/(?:MP|SP|法力|魔力)[\s:：<>]*(\d+)\s*[\/／]\s*(\d+)/i],
  // Combat lines captured from the server:
  //   你用短劍往新手冒險者的身體斜砍, 結果造成一處傷害 !        新手冒險者的短劍刺向你, 但是沒有造成任何傷害。
  //   ( 新手冒險者已經奄奄一息了。 )                            新手冒險者死了。
  combat: {
    mine: /^你(?:的|用|倒握|揮動|舉起|一)/,                         // a line describing your own attack
    theirs: /往你的|刺向你|斬向你|砍向你|對準你|攻擊你|撲向你|咬向你/,   // someone attacking you
    hit: /結果造成/,
    died: /^(.{1,24}?)死了。\s*$/,
    condition: /^\(\s*(.{1,24}?)(正處於最佳狀況|似乎受了點傷|受了幾處傷|傷到不少地方|身上到處都是傷口|已經奄奄一息)/,
    conditionPct: { 正處於最佳狀況: 100, 似乎受了點傷: 90, 受了幾處傷: 75, 傷到不少地方: 50, 身上到處都是傷口: 28, 已經奄奄一息: 8 },
  },
};

export const DIRS = {
  north: { dx: 0, dy: -1, dz: 0, zh: '北' }, south: { dx: 0, dy: 1, dz: 0, zh: '南' }, east: { dx: 1, dy: 0, dz: 0, zh: '東' }, west: { dx: -1, dy: 0, dz: 0, zh: '西' },
  northeast: { dx: 1, dy: -1, dz: 0, zh: '東北' }, northwest: { dx: -1, dy: -1, dz: 0, zh: '西北' }, southeast: { dx: 1, dy: 1, dz: 0, zh: '東南' }, southwest: { dx: -1, dy: 1, dz: 0, zh: '西南' },
  up: { dx: 0, dy: 0, dz: 1, zh: '上' }, down: { dx: 0, dy: 0, dz: -1, zh: '下' },
};
export const DIR_ALIAS = {
  n: 'north', s: 'south', e: 'east', w: 'west', ne: 'northeast', nw: 'northwest', se: 'southeast', sw: 'southwest', u: 'up', d: 'down',
  北: 'north', 南: 'south', 東: 'east', 西: 'west', 東北: 'northeast', 西北: 'northwest', 東南: 'southeast', 西南: 'southwest', 上: 'up', 下: 'down',
  北方: 'north', 南方: 'south', 東方: 'east', 西方: 'west', 上面: 'up', 下面: 'down',
};

// Ground art. tile = sprite folder/RID under sprites/, path = tile used for the walkways to the exits.
// `name` (optional) is tested against the room title first and wins over the generic `re`, which is tried on the title and then the description.
export const TERRAIN = [
  { key: 'lava',   re: /熔岩|岩漿|火山|煉獄|地獄/,                    tile: 'MapPattern13/RID12864', path: 'MapPattern13/RID12966', decor: [] },
  { key: 'snow',   re: /雪|冰原|冰洞|寒冰|凍原/,                      tile: 'MapPattern17_4/RID1344', path: 'MapPattern17_4/RID1351', decor: ['樹'] },
  { key: 'beach',  name: /海邊|沙灘|海岸|海灘/, re: /沙灘|海灘/,       tile: 'MapPattern11/RID10520', path: 'MapPattern11/RID10520', decor: ['石'] },
  { key: 'swamp',  name: /沼澤|泥沼|濕地/, re: /沼澤|泥沼|爛泥/,       tile: 'MapPattern16/RID15514', path: 'MapPattern16/RID15514', decor: ['樹'] },
  { key: 'road',   name: /^(道路|小徑|小路|山路|林道|黃土路)$/, re: /黃土路|碎石鋪成的道路/, tile: 'MapPattern01/RID64', path: 'MapPattern01/RID452', decor: ['樹'] },
  { key: 'city',   name: /路口|大道|街|巷|廣場|市場|市集|城門|門口|橋|碼頭|港|前$|外$/, re: /街道|大街|石板/, tile: 'MapPattern01/RID769', path: 'MapPattern02_1/RID1408', decor: ['路標', '招牌'] },
  { key: 'indoor', name: /屋|房|室|店|舖|鋪|館|廳|殿|堂|廟|宮|塔|樓|酒吧|旅館|銀行|教堂|公會|工會|倉庫|廚房|走道|走廊|之家|的家|魔法陣|訓練場|郵局/,
                   re: /酒吧|神殿|大廳|房間|屋內|店裡|走道/,           tile: 'MapPattern06/RID5632', path: 'MapPattern08/RID7433', decor: ['桌', '椅', '燭台'] },
  { key: 'cave',   re: /洞|穴|地道|地下|礦坑|礦場|墓|地牢|監牢|下水道|迷宮/, tile: 'MapPattern20/RID12096', path: 'MapPattern02/RID1216', decor: ['石'] },
  { key: 'water',  name: /海|湖|河|溪|池|瀑布|水中|水底/, re: /湖邊|河邊|溪邊/, tile: 'MapPattern15/RID14743', path: 'MapPattern06/RID5632', decor: [] },
  { key: 'forest', name: /森林|樹林|林$|叢林/, re: /森林|樹林/,        tile: 'MapPattern01/RID135', path: 'MapPattern01/RID452', decor: ['樹', '樹', '樹'] },
  { key: 'mount',  name: /山|丘|崖|峰|嶺|坡|谷|岩/, re: /丘陵|山坡|山崖|岩壁/, tile: 'MapPattern17_2/RID13184', path: 'MapPattern01/RID452', decor: ['石', '樹'] },
  { key: 'desert', re: /沙漠|荒地|荒野|沙丘/,                         tile: 'MapPattern11/RID10520', path: 'MapPattern01/RID452', decor: ['石'] },
  { key: 'grass',  name: /草|平原|原野|田|園|牧場|花/, re: /草地|草原|綠草|平野/, tile: 'MapPattern01/RID64', path: 'MapPattern01/RID64', decor: ['樹'] },
];
export const DEFAULT_TERRAIN = { key: 'plain', tile: 'MapPattern01/RID64', path: 'MapPattern01/RID452', decor: [] };

// Chinese name -> monster model folder (gltf/bin/monster/<folder>). First match wins, so keep specific names first.
export const MONSTERS = [
  [/骨龍|骷髏龍/, 'skeletondragon'], [/毒龍/, 'poisondragon'], [/神龍/, 'goddragon'], [/龍人/, 'dragonman'], [/幼龍|雛龍|龍寶寶/, 'dragonbaby'],
  [/小龍|飛龍|翼龍/, 'smalldragon'], [/龍騎/, 'knightdragon'], [/龍/, 'dragon'],
  [/吸血鬼王|吸血鬼伯爵/, 'vampireking'], [/吸血鬼|吸血/, 'vampire'], [/骷髏/, 'skeleton'], [/殭屍|僵屍|不死|活屍|屍鬼/, 'undead'], [/死神/, 'reaper'],
  [/幽靈|鬼魂|亡魂|怨靈|鬼/, 'ghost'], [/幻影|幻象/, 'phantom'], [/影魔|暗影/, 'shadowdemon'],
  [/蜥蜴人/, 'lizardman'], [/牛頭/, 'minotaur'], [/半人馬|人馬/, 'centaur'], [/獨眼/, 'cyclops'], [/巨魔|食人妖|山怪/, 'troll'], [/食人魔|歐克|獸人/, 'ogre'],
  [/泰坦|銅人|銅巨人/, 'coppergiant'], [/巨人/, 'giant'], [/石像鬼/, 'gargoyle'], [/魔像|石人|石巨人|高崙|傀儡/, 'golem'],
  [/梅杜莎|蛇髮/, 'medusa'], [/奇美拉|合成獸/, 'chimera'], [/比蒙|巨獸/, 'behemoth'], [/獅鷲|獅鷹|鷹獅/, 'griffon'], [/雞蛇|雞尾蛇/, 'cockatrice'], [/石化蜥|蛇怪/, 'basilisk'],
  [/眼魔|魔眼|眼球/, 'beholder'], [/寶箱怪/, 'mimic'], [/惡魔|魔王|魔族/, 'demon'], [/魔鬼|邪魔/, 'devil'], [/天使/, 'angel'],
  [/火元素|火精|火靈/, 'elemfire'], [/土元素|地精靈|土靈/, 'elemearth'], [/風元素|風靈/, 'elemwind'], [/麒麟/, 'firekirin'], [/鳳凰/, 'phoenix'],
  [/樹精|樹妖|樹人/, 'dryad'], [/妖精|仙子|小精靈/, 'fairy'], [/女精靈/, 'elf_w'], [/精靈/, 'elf_m'], [/矮人/, 'irdwarf'], [/半身人|哈比/, 'halfing'],
  [/史萊姆|黏液|泥怪|軟泥/, 'slime'], [/蘑菇|菇/, 'mushroom'], [/食人花|花妖|花/, 'flower'], [/水母/, 'jellyfish'], [/蟲/, 'wormlord'],
  [/蝙蝠/, 'bat'], [/蜘蛛/, 'spider'], [/蛇/, 'snake'], [/野豬|山豬/, 'wild_pig'], [/豬/, 'pig'], [/狼/, 'wolf'], [/老虎|虎/, 'tiger'], [/狐/, 'tailfox'],
  [/熊/, 'bearsnow'], [/雪人/, 'snowman'], [/猩猩/, 'orangutan'], [/猴/, 'monkey'], [/大象|象/, 'elephant'], [/馴鹿/, 'reindeer'], [/鹿/, 'deer'],
  [/山羊/, 'goat'], [/羊/, 'sheep'], [/水牛/, 'buffalo'], [/牛/, 'cow'], [/小雞/, 'kid_chicken'], [/雞/, 'chicken'], [/狗|犬/, 'dog'], [/貓/, 'cat'],
  [/老鼠|鼠/, 'mouse'], [/兔/, 'rabbit'], [/獨角獸/, 'unicorn'], [/飛馬|天馬/, 'flyhorse'], [/白馬/, 'whitehorse'], [/馬/, 'horse'],
  [/老鷹|鷹|鵰/, 'eagle'], [/鳥|鴉|雀/, 'bird'], [/蝴蝶/, 'butterfly'], [/烏龜|龜/, 'turtle'], [/聖誕/, 'santa'], [/盜賊|小偷|扒手|強盜|土匪/, 'thief'],
];

// People: keyword -> player-class model (gltf/bin/player/<class>_<m|w>).
export const PEOPLE = [
  [/衛兵|守衛|士兵|警衛|騎士|隊長|護衛/, 'knight'], [/紅衣主教|大主教/, 'archbishop'], [/冒險者|獵人|旅人|旅行者/, 'warrior'], [/酒保|老闆|店員|商人|服務生|大師|工匠/, 'bard'], [/戰士|傭兵|劍士|武士|鬥士/, 'warrior'], [/狂戰/, 'berserker'], [/將軍|國王|城主|領主|王/, 'general'],
  [/大法師|賢者/, 'archmage'], [/法師|魔法師|巫師|術士/, 'mage'], [/主教/, 'bishop'], [/牧師|祭司|神父|修女|僧侶/, 'cleric'], [/僧|武僧/, 'monk'],
  [/吟遊|詩人|歌手/, 'bard'], [/刺客|殺手|忍者/, 'assassin'], [/長老|老人|老者/, 'elder'],
];
export const PEOPLE_DEFAULT = ['bard', 'priest', 'wizard', 'monk', 'warrior', 'sage'];
export const FEMALE = /女|小姐|姑娘|婦|妹|姊|姐|公主|皇后|王后|娘|媽|太太|夫人|修女|女孩|少女/;

// Click menu: [label, command]. {id} is the thing's English id in lower case.
// All of these were seen working in session logs.
export const ACTIONS = {
  person:  [['查看', 'look {id}'], ['攻擊', 'kill {id}']],
  monster: [['查看', 'look {id}'], ['攻擊', 'kill {id}']],
  item:    [['查看', 'look {id}'], ['撿起', 'get {id}']],
  corpse:  [['查看', 'look {id}'], ['全部拾取', 'get all from {id}']],          // "get corpse" answers 這個東西拿不起來
};
// Room descriptions advertise what you can do there as  中文(english), e.g. 存(deposit)/提(withdraw)款和轉帳(transfer).
// Each such word becomes a button. Verbs listed here are sent as commands: [label, needsArgument].
// With needsArgument the click only fills the command box (so you can type the amount or item); without it the command is sent at once.
// Words not listed are treated as things to look at:  銅牌(plaque) -> "look plaque".
export const ROOM_WORD = /\(([a-z][a-z' ]{1,18})\)/g;
export const ROOM_VERBS = {
  deposit: ['存款', true], withdraw: ['提款', true], transfer: ['轉帳', true], balance: ['查餘額', false],
  buy: ['購買', true], sell: ['販賣', true], list: ['商品列表', false], value: ['估價', true], repair: ['修理', true], identify: ['鑑定', true],
  pray: ['祈禱', false], try: ['試鑰匙', false], marry: ['結婚', true], divorce: ['離婚', true],
  train: ['訓練', true], practice: ['練習', true], learn: ['學習', true], study: ['研讀', true], advance: ['升級', false],
  order: ['點餐', true], drink: ['喝', true], eat: ['吃', true], rent: ['訂房', false], rest: ['休息', false], sleep: ['睡覺', false],
  read: ['閱讀', true], post: ['留言', true], mail: ['寄信', true], news: ['看新聞', false], vote: ['投票', true],
  enter: ['進入', false], climb: ['攀爬', false], jump: ['跳', false], swim: ['游泳', false], search: ['搜尋', false], dig: ['挖掘', false],
  push: ['推', true], pull: ['拉', true], open: ['打開', true], close: ['關上', true], knock: ['敲門', false], ring: ['搖鈴', false],
  join: ['加入', true], quest: ['任務', false], ask: ['詢問', true], give: ['給予', true],
};

// Shop listings: the reply to these commands is read as a table of goods and shown as a panel with buy buttons.
// Captured from the server (蓋茲裝備店):   "本店目前還有 : "   then   "武士服(Fighter's robe)                  300 枚金幣"   per item,
// paged with "== 未完繼續 51% ==". shopLine in parser.js also accepts numbered layouts in case other shops differ.
// backpack: what to offer for each item. A weapon is guessed from its name or id; both choices are always offered.
export const INVENTORY = {
  list: 'i',
  weapon: /劍|刀|槍|矛|戟|斧|錘|鎚|棍|杖|棒|鞭|弓|弩|匕首|叉|爪|鐮|拳套|飛鏢/,
  weaponId: /sword|blade|bow|staff|axe|spear|dagger|whip|club|mace|hammer|knife|lance|halberd|wand|rod|claw/i,
  wield: 'wield {id}', unwield: 'unwield {id}', wear: 'wear {id}', remove: 'remove {id}', look: 'look {id}',
};

// message boards (see PARSER.boardHead for the layout). `thing` tells a board among the things in a room.
export const BOARD = {
  thing: /留言[板版]|公布欄|佈告欄|告示[板牌]|討論[板版]|看板/,
  list: 'look {id}', read: 'read {n}', next: 'read new',
  autoPages: 30,              // pages of one post the panel turns by itself
};

// Spell -> casting voice (assets: audio/sound/voice/<n>_<m|f>_<0..2>.wav, recordings of the incantations above).
// The voices are numbered by an older spell list, so this is not simply "spell number - 2000": spells added later
// (dispel, double_heal, ...) have no voice and push the rest down. Worked out by speech-recognising the clips and
// matching them to incantations seen in real sessions. Confirmed: angel 1, bless 5, calm 7, cure 9, cure_poison 10,
// death_touch 13, demon_bane 15, detect_invi 17, divine_dust 18, first_aid 26, float 30, heal 35, holy_* 37-43,
// make_rope 54, mind_blast 55, natural_heal 57, pure_shield 61, restore 63, sanctuary 64, spectre_touch 69, strong 75.
// Best guesses between those anchors: 44-53 (ice_lance ... magic_shield), 65-68 and 70-74; 101-150 are numbered
// directly. Correct a number here if a spell sounds wrong.
export const SPELL_VOICE = {
  angel: 1, angel_voice: 2, anti_magic: 3, arc_fire: 4, bless: 5, blind: 6, calm: 7, coating: 8,
  cure: 9, cure_poison: 10, dagger_fall: 11, dancing_sword: 12, death_touch: 13, delay_bomb: 14, demon_bane: 15, demon_strike: 16,
  detect_invi: 17, divine_dust: 18, divine_power: 19, dragon: 20, dragon_breath: 21, enlarge: 22, fear: 23, fireball: 24,
  firefly: 25, first_aid: 26, fist: 27, flame_sword: 28, flare: 29, float: 30, freeze: 31, gravity: 32,
  haste: 33, hazy: 34, heal: 35, heroism: 36, holy_blast: 37, holy_light: 38, holy_power: 39, holy_spirit: 40,
  holy_strike: 41, holy_water: 42, holy_word: 43, ice_lance: 44, identify: 45, invisible: 47, lightning: 48, lightning_bolt: 49,
  location: 50, magefire: 51, magic_missle: 52, magic_shield: 53, make_rope: 54, mind_blast: 55, moon_light: 56, natural_heal: 57,
  ogre_power: 58, poison: 59, pure_blade: 60, pure_shield: 61, regeneration: 62, restore: 63, sanctuary: 64, shadow_shield: 65,
  silence: 66, sky_sword: 67, soul_steal: 68, spectre_touch: 69, speedup: 70, spirit_hammer: 71, stone: 72, stone_skin: 73,
  storm: 74, strong: 75, miracle_light: 101, clear_word: 102, protect_word: 103, lightning_word: 104, voice: 105, hold: 106,
  command: 107, words: 108, bloodlust: 109, forgetter: 110, darken: 111, fly_swords: 112, sword_shield: 113, earth_sword: 114,
  meteor_shower: 115, animate: 116, drain: 117, dark_gate: 118, death_curse: 119, vampires: 120, dark_abyss: 122, divine_word: 123,
  god_power: 124, divine_blame: 125, divine_aid: 126, divine_nuke: 127, my_word: 128, my_blame: 129, my_aid: 130, angel_tear: 131,
  deep_recover: 132, mind_storm: 133, deep_terror: 134, time_storm: 135, holy_path: 136, full_heal: 137, power_word: 138, mighty_word: 140,
  dark_cloak: 141, arc_dagger: 142, slashs: 143, energy_shock: 144, energy_storm: 146, my_power: 147, my_nuke: 148, lightning_blade: 149,
  dark_soul: 150,
};

export const SHOP = {
  trigger: /^(list|menu)\b/i,
  skip: /^[\s\-=_*~+|│─━]+$|名稱.*(價|金)|^\s*(品名|編號|商品|目前|這裡|本店|歡迎|您|你)/,
  price: /(\d[\d,]*)\s*(?:枚\s*)?(?:金幣|銀幣|元|gold|coins?)/i,
  buy: 'buy {id}',            // used when the line shows an (id)
  buyByIndex: 'buy {n}',      // used when it only shows a number
  look: 'look {id}',
};

export const CORPSE = /屍體|屍首|遺骸/;
export const CORPSE_MODEL = 'gltf/bin/building/corpse.glb';

// Things that are objects rather than creatures.
export const ITEMS = [
  [/屍體|遺骸|屍首/, 'gltf/bin/building/corpse.glb'],
  [/留言[板版]|公布欄|佈告|告示|討論[板版]|專用板|看板|小艇|船$|馬車|劍$|刀$|斧$|槍$|矛$|弓$|彈弓|杖$|棒$|錘$|鎚$|盾$|盾牌|甲$|盔$|袍$|衫$|褲$|裙$|靴$|鞋$|帽$|頭巾|頭環|斗[蓬篷]|披風|手套|臂環|戒指|戒$|項鍊|鏡$|羽飾|綾緞|藥水|藥草|藥膏|卷軸|袋$|箱$|金幣|銀幣|寶石|鑰匙|麵包|水壺|火把|骨頭|招牌|噴泉|雕像/, 'gltf/bin/building/item.glb'],
];
// English head nouns that make a thing an object whatever its Chinese name says: the last word of the id,
// or the word before " of " ("The magic ring of minerva" -> ring). Checked before monsters, so 龍鱗盾(Dragon shield) is a shield.
// People keep theirs: "Priest of moon" -> priest, "Soldier of west gate" -> soldier.
export const ITEM_IDS = new Set(('sword shortsword longsword blade dagger knife axe hammer mace club staff wand rod spear lance halberd bow crossbow arrow arrows whip claw '
  + 'shield buckler armor armour mail plate robe cloth clothes shirt vest coat cloak cape mantle pants trousers skirt belt leggings '
  + 'boots shoes chaussure sandals gloves gauntlets helmet helm hat cap turban hood mask ring necklace amulet earring bracelet arms armlet '
  + 'zonate circle crown tiara brocade feather mirror wing hand potion pill plaster herb scroll book key gold coin coins gem jewel bone bag box '
  + 'chest torch bottle bread board sign ship boat statue fountain corpse').split(' '));

// Sample text for the offline demo button (invented rooms written in the server's real layout).
export const DEMO = [
  '奇岩城中央廣場 - \n    這裡是奇岩城最熱鬧的中央廣場，石板鋪成的街道向四方延伸，廣場中央有一座\n噴泉，旁邊立著一塊招牌，幾棵樹在微風中搖曳。\n    這裡明顯的出口是 north、south、east 和 west。\n  城門衛兵(guard)\n  流浪的吟遊詩人(bard)\n  一隻野狗(dog)\n> ',
  '城北森林 - \n    茂密的森林，高大的樹木遮住了陽光，草叢中似乎有東西在移動。\n    這裡明顯的出口是 south 和 northeast。\n  \x1b[1;31m兇猛的野狼(wolf)\x1b[2;37;0m\n  一隻蝙蝠(bat)\n  巨大的蜘蛛(spider)\n> ',
  '幽暗的洞穴 - \n    潮濕陰冷的洞穴，地上散落著白骨，深處傳來低沉的吼聲。\n    這裡明顯的出口是 southwest、up 和 down。\n  \x1b[1;31m紅龍(dragon)\x1b[2;37;0m\n  骷髏戰士(skeleton)\n  冒險者的屍體(corpse)\n  藤木小盾牌(Small shield)\n  米娜娃魔力閃戒(The magic ring of minerva)\n> ',
  '你用短劍往骷髏戰士的身體斜砍, 結果造成一處傷害 !\n( 骷髏戰士傷到不少地方, 流了許多鮮血。 )\n骷髏戰士的短劍刺向你, 但是沒有造成任何傷害。\n你倒握短劍, 順勢往骷髏戰士的頭部一刺, 結果造成一處嚴重的傷害 !\n( 骷髏戰士已經奄奄一息了。 )\n\n骷髏戰士死了。\n\n(你得到 69 點經驗。)\n',
  '查克銀行 - \n    你走進了一家銀行, 行員們正在櫃檯後忙碌著, 幾個渾身肌肉的警衛正\n狠狠的盯著你看。這裏是世界聞名的大奸商查克開的銀行。你可以在這裏存(deposit)/提(withdraw)款和轉帳(transfer), 牆上掛著一面銅牌(plaque)。\n    這裡唯一的出口是 \x1b[1mnorth\x1b[2;37;0m。\n  酸甜苦辣留言板(Board) [ 35 張留言﹐35 張未讀 ]\n  短劍(Shortsword)\n  十枚金幣(Gold)\n> ',
  '你撿起十枚金幣。\n> ',
  // shop listing in the captured layout, stopped by the pager, then its second page
  '本店目前還有 : \n武士服(Fighter\'s robe)                  300 枚金幣\n銀戒指(Silver ring)                      40 枚金幣\n鐵劍(Iron sword)                        430 枚金幣\n天行者大盾(Sky walker shield)      610 枚金幣\n== 未完繼續 51% == (ENTER 繼續下一頁﹐q 離開﹐b 前一頁)',
  '\n夢之盔(Dream helmet)      150 枚金幣\n天行者大盾(Sky walker shield)      610 枚金幣\n天行者大盾(Sky walker shield)      610 枚金幣\n> ',
  // people coming and going (captured phrasing)
  '阿德走了過來。\n阿德在阿德帳戶存入 3036 枚金幣。\n青嵐飄了過來。\n',
  '青嵐往西飄去。\n阿德祈求神把阿德帶回冒險者之家 ...\n',
  // a shop that names "list" without parentheses (captured)
  '雷的藥店 - \n    你走進一家充滿藥草味的藥店, 店裡陳列著各種瓶瓶罐罐, 這裏是史坎\n布雷唯一的藥店所在, 你可以在這裏買到各種傷藥繃帶甚至大補丸, 如果你\n覺得該補一補了, 可以用 list 看看有什麼貨色, 再考慮要不要買(buy)。\n    這裡唯一的出口是 west。\n  藥店老闆 雷(Ray)\n> ',
  // backpack (captured layout; ˇ = in use)
  '你身上帶著下列這些東西(負重 725/1050 )﹕\n    \x1b[1;34m￠\x1b[1;33m小木\x1b[1;32m彈弓\x1b[1;34m￠\x1b[0m(Small wooden bow)\n    \x1b[0m\x1b[33m獸皮\x1b[1m\x1b[37m小\x1b[0m\x1b[33m手套\x1b[0m(Small gloves)\n    \x1b[1m\x1b[37m琉璃小戒指\x1b[0m(Small ring)\n    \x1b[1m\x1b[37m琉璃小戒指\x1b[0m(Small ring)\n  \x1b[1;36mˇ\x1b[2;37;0m黑色長袍(Black robe)\n  \x1b[1;36mˇ\x1b[2;37;0m短劍(Shortsword)\n> ',
  // message board (captured layout, invented posts): the list, then a post stopped by the pager, then its end
  '這是一個供人留下建議的留言板。\n留言板的使用方法請見 help board。\n\x1b[1;33m[ 1]\x1b[2;37;0m  回來玩了, 還有人在嗎?                      阿星(astar) (10/2  09:20 2023)\n\x1b[1;33m[ 2]\x1b[2;37;0m  Re : 回來玩了, 還有人在嗎?              \x1b[1;35m林小花\x1b[2;37;0m(lily) (10/2  11:44 2023)\n\x1b[1;33m[ 3]\x1b[2;37;0m  新手請問練功地點                      小明(ming) (11/3  20:15 2026)\n> ',
  '[2] Re : 回來玩了, 還有人在嗎?                      \x1b[1;35m林小花\x1b[2;37;0m(lily)(Mon Oct 2)\n' + '-'.repeat(70) + '\n\x1b[32m\n>在阿星(astar)的留言中提到 : \n> 好久沒上線了，還有人在玩嗎？\n\x1b[2;37;0m\n有喔！冒險者之家每天都有人。\n== 未完繼續 \x1b[1;33m60%\x1b[2;37;0m == (ENTER 繼續下一頁﹐q 離開﹐b 前一頁)',
  '\n晚上人比較多，歡迎回來。\n\n== 本文完畢，請按任意鍵繼續 ...',
];
// the command each demo step pretends to answer (by index); steps not listed continue the previous one or answer nothing
export const DEMO_CMD = { 0: '', 1: 'north', 2: 'northeast', 3: '', 4: 'south', 5: '', 6: 'list', 8: '', 9: '', 10: '', 11: 'i', 12: 'look board', 13: 'read 2' };
