// Command recorder: records what this page sends and when, and plays it back with the same gaps.
// Recordings are kept per account in this browser (localStorage kk.macros.<sid>) and can be edited in a dialog.
// A step is { wait, cmd }: wait = seconds after the previous step (the first: after recording started).
const $ = id => document.getElementById(id);

export function initMacro({ store, sid, send, sys, canSend }) {
  const KEY = 'macros.' + sid, MAX_STEPS = 500;
  const macros = (store.get(KEY, []) || []).filter(m => m && Array.isArray(m.steps));
  const save = () => store.set(KEY, macros);
  let rec = null;            // { steps, last, started } while recording
  let play = null;           // { m, i, round, stop } while playing
  let cur = 0;               // macro shown in the editor
  const recBtn = $('recBtn'), playBtn = $('macroBtn'), dlg = $('macroDlg');
  const fmt = s => (Math.round(s * 10) / 10).toFixed(1);
  const stamp = () => { const d = new Date(), p = n => String(n).padStart(2, '0'); return `錄製 ${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };

  // ---------------------------------------------------------------- recording
  function note(text) {
    if (!rec || !text) return;
    const now = Date.now();
    if (rec.steps.length >= MAX_STEPS) return;
    rec.steps.push({ wait: Math.round((now - rec.last) / 100) / 10, cmd: text });
    rec.last = now;
    drawButtons();
  }
  function startRec() {
    if (play) stopPlay('開始錄製，播放已停止');
    rec = { steps: [], last: Date.now(), started: Date.now() };
    sys('開始錄製指令：之後送出的指令與間隔時間都會記下來，再按一次「■ 停止錄製」結束。');
    drawButtons();
  }
  function stopRec() {
    const r = rec; rec = null;
    if (!r.steps.length) { sys('錄製結束：沒有錄到任何指令。'); drawButtons(); return; }
    macros.push({ name: stamp(), steps: r.steps }); save();
    cur = macros.length - 1;
    sys(`錄製結束：${r.steps.length} 個指令，共 ${fmt(total(r.steps))} 秒，已存成「${macros[cur].name}」。`);
    drawButtons(); openEditor();
  }
  recBtn.onclick = () => { rec ? stopRec() : startRec(); $('cmd').focus(); };

  // ---------------------------------------------------------------- playback
  const total = steps => steps.reduce((a, s) => a + (+s.wait || 0), 0);
  async function startPlay(m, times) {
    if (play) return;
    if (rec) stopRec();
    const steps = m.steps.filter(s => s.cmd && s.cmd.trim()).map(s => ({ wait: Math.max(0, +s.wait || 0), cmd: s.cmd }));
    if (!steps.length) { sys(`「${m.name}」沒有指令可以播放。`); return; }
    if (!canSend()) { sys('尚未連線，不能播放。'); return; }
    let wake = null;
    const p = play = { m, steps, i: 0, round: 1, times, stopped: false,
      stop() { this.stopped = true; wake?.(); } };
    sys(`開始播放「${m.name}」（${steps.length} 個指令${times === 1 ? '' : times ? `，重複 ${times} 次` : '，無限重複'}）`);
    drawButtons();
    const sleep = ms => new Promise(res => { const t = setTimeout(res, ms); wake = () => { clearTimeout(t); res(); }; });
    try {
      for (; !p.stopped && (!times || p.round <= times); p.round++) {
        for (p.i = 0; p.i < steps.length && !p.stopped; p.i++) {
          drawButtons(); markRow();
          if (steps[p.i].wait) await sleep(steps[p.i].wait * 1000);
          if (p.stopped) break;
          if (!canSend()) { stopPlay('連線中斷，播放已停止'); break; }
          await send(steps[p.i].cmd);
        }
      }
    } finally {
      if (play === p) { play = null; if (!p.stopped) sys(`「${m.name}」播放完畢。`); drawButtons(); markRow(); }
    }
  }
  function stopPlay(why) {
    if (!play) return;
    const p = play; play = null; p.stop();
    sys(why || `「${p.m.name}」已停止播放。`);
    drawButtons(); markRow();
  }

  function drawButtons() {
    recBtn.textContent = rec ? `■ 停止錄製（${rec.steps.length}）` : '● 錄製';
    recBtn.classList.toggle('rec', !!rec);
    playBtn.textContent = play ? `■ 停止播放 ${play.i + 1}/${play.steps.length}${play.times === 1 ? '' : ` ×${play.round}`}` : '▶ 播放';
    playBtn.classList.toggle('rec', !!play);
    playBtn.title = play ? '停止播放' : '開啟錄製清單：播放、調整指令與時間';
    if (dlg.open) $('mcPlay').textContent = play ? '■ 停止' : '▶ 播放';
  }
  playBtn.onclick = () => { play ? stopPlay() : openEditor(); };

  // ---------------------------------------------------------------- editor
  function openEditor() { drawEditor(); if (!dlg.open) dlg.showModal(); }
  function drawEditor() {
    const sel = $('mcList');
    sel.textContent = '';
    macros.forEach((m, i) => sel.add(new Option(`${m.name}（${m.steps.length}）`, i)));
    const has = macros.length > 0;
    if (cur >= macros.length) cur = macros.length - 1;
    if (cur < 0) cur = 0;
    sel.value = cur;
    for (const id of ['mcName', 'mcPlay', 'mcTimes', 'mcDel', 'mcAdd', 'mcScale', 'mcScaleGo', 'mcCopy']) $(id).disabled = !has;
    $('mcEmpty').hidden = has;
    const rows = $('mcRows'); rows.textContent = '';
    if (!has) { $('mcName').value = ''; $('mcTotal').textContent = ''; drawButtons(); return; }
    const m = macros[cur];
    $('mcName').value = m.name;
    let at = 0;
    m.steps.forEach((s, i) => {
      at += +s.wait || 0;
      const row = document.createElement('div'); row.className = 'item-row mc'; row.dataset.i = i;
      const no = document.createElement('span'); no.className = 'key'; no.textContent = i + 1;
      const w = document.createElement('input'); w.type = 'number'; w.min = 0; w.step = 0.1; w.className = 'w-s'; w.value = fmt(+s.wait || 0);
      w.title = '等待秒數：上一個指令送出後（第一列：開始播放後）等多久再送出這一個';
      w.oninput = () => { const v = parseFloat(w.value); s.wait = isFinite(v) && v >= 0 ? Math.round(v * 10) / 10 : 0; save(); drawTimes(); };
      const at_ = document.createElement('span'); at_.className = 'key at'; at_.textContent = `@${fmt(at)}s`; at_.title = '從開始播放算起的時間';
      const c = document.createElement('input'); c.className = 'w-l'; c.value = s.cmd; c.maxLength = 500; c.placeholder = '指令（可用 ; 分隔、#1 代表 ID 列表）';
      c.oninput = () => { s.cmd = c.value; save(); };
      const up = document.createElement('button'); up.type = 'button'; up.textContent = '↑'; up.title = '往上移';
      up.onclick = () => { if (i) { [m.steps[i - 1], m.steps[i]] = [m.steps[i], m.steps[i - 1]]; save(); drawEditor(); } };
      const ins = document.createElement('button'); ins.type = 'button'; ins.textContent = '＋'; ins.title = '在下面插入一列';
      ins.onclick = () => { m.steps.splice(i + 1, 0, { wait: 1, cmd: '' }); save(); drawEditor(); rows.children[i + 1]?.querySelector('.w-l')?.focus(); };
      const del = document.createElement('button'); del.type = 'button'; del.textContent = '✕'; del.title = '刪除這一列';
      del.onclick = () => { m.steps.splice(i, 1); save(); drawEditor(); };
      row.append(no, w, at_, c, up, ins, del);
      rows.append(row);
    });
    drawTimes(); markRow(); drawButtons();
  }
  function drawTimes() {
    const m = macros[cur]; if (!m) return;
    let at = 0;
    [...$('mcRows').children].forEach((row, i) => { at += +m.steps[i]?.wait || 0; row.querySelector('.at').textContent = `@${fmt(at)}s`; });
    $('mcTotal').textContent = `${m.steps.length} 個指令，共 ${fmt(total(m.steps))} 秒`;
    const o = $('mcList').options[cur]; if (o) o.textContent = `${m.name}（${m.steps.length}）`;
  }
  function markRow() {
    if (!dlg.open) return;
    const on = play && play.m === macros[cur] ? play.i : -1;
    // played steps skip blank commands, so find the row by its position among the non-blank ones
    let k = -1;
    [...$('mcRows').children].forEach((row, i) => {
      if (macros[cur].steps[i]?.cmd?.trim()) k++;
      row.classList.toggle('now', on >= 0 && k === on && !!macros[cur].steps[i]?.cmd?.trim());
    });
  }
  $('mcList').onchange = () => { cur = +$('mcList').value; drawEditor(); };
  $('mcName').oninput = () => { const m = macros[cur]; if (!m) return; m.name = $('mcName').value.slice(0, 40) || '未命名'; save(); drawTimes(); };
  $('mcAdd').onclick = () => { const m = macros[cur]; if (!m) return; m.steps.push({ wait: 1, cmd: '' }); save(); drawEditor(); $('mcRows').lastElementChild?.querySelector('.w-l')?.focus(); };
  $('mcNew').onclick = () => { macros.push({ name: '新的錄製', steps: [{ wait: 0, cmd: '' }] }); cur = macros.length - 1; save(); drawEditor(); $('mcName').select(); };
  $('mcCopy').onclick = () => { const m = macros[cur]; if (!m) return; macros.push({ name: m.name + ' 複本', steps: m.steps.map(s => ({ ...s })) }); cur = macros.length - 1; save(); drawEditor(); };
  $('mcDel').onclick = () => {
    const m = macros[cur]; if (!m) return;
    if (!confirm(`刪除「${m.name}」？`)) return;
    if (play?.m === m) stopPlay();
    macros.splice(cur, 1); save(); drawEditor();
  };
  $('mcScaleGo').onclick = () => {           // e.g. 0.5 = twice as fast
    const m = macros[cur], k = parseFloat($('mcScale').value);
    if (!m || !(k > 0)) return;
    m.steps.forEach(s => { s.wait = Math.round((+s.wait || 0) * k * 10) / 10; }); save(); drawEditor();
  };
  $('mcPlay').onclick = () => {
    if (play) { stopPlay(); return; }
    const m = macros[cur]; if (!m) return;
    const t = Math.max(0, Math.min(9999, parseInt($('mcTimes').value, 10) || 0));
    startPlay(m, t);
  };
  $('mcClose').onclick = () => dlg.close();
  dlg.addEventListener('close', () => $('cmd').focus());

  drawButtons();
  return { note, recording: () => !!rec, playing: () => !!play, stop: () => stopPlay() };
}
