// Which account this page shows (?s=<profile id>) and small helpers for the local server API.
export const sid = new URLSearchParams(location.search).get('s') || 'default';
export const q = `?s=${encodeURIComponent(sid)}`;
export const post = (path, data = {}) => fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ s: sid, ...data }) }).then(r => r.json());
export const get = path => fetch(path).then(r => r.json());
