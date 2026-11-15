// Big5 encoder built from the platform decoder (Node has no Big5 TextEncoder).
const table = new Map();
{
  const dec = new TextDecoder('big5', { fatal: true });
  const pair = Buffer.alloc(2);
  for (let a = 0x81; a <= 0xFE; a++) for (let b = 0x40; b <= 0xFE; b++) {
    if (b > 0x7E && b < 0xA1) continue;
    pair[0] = a; pair[1] = b;
    try { const ch = dec.decode(pair); if (ch.length && !table.has(ch)) table.set(ch, (a << 8) | b); } catch { /* unmapped */ }
  }
}

exports.encodeBig5 = function encodeBig5(str) {
  const out = [];
  for (const ch of str) {
    const c = ch.codePointAt(0);
    if (c < 0x80) out.push(c);
    else { const v = table.get(ch); if (v) out.push(v >> 8, v & 255); else out.push(0x3F); }
  }
  return Buffer.from(out);
};
