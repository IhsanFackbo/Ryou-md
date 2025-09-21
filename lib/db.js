// lib/db.js
const fs = require('fs-extra');
const path = require('path');

const DB_DIR  = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DB_DIR, 'db.json');

function ensureDB() {
  fs.ensureDirSync(DB_DIR);
  if (!fs.existsSync(DB_FILE)) {
    fs.writeJsonSync(DB_FILE, { usage: {}, events: [], premiumUsers: [] }, { spaces: 2 });
  } else {
    const db = fs.readJsonSync(DB_FILE);
    if (!('usage' in db)) db.usage = {};
    if (!('events' in db)) db.events = [];
    if (!('premiumUsers' in db)) db.premiumUsers = [];
    fs.writeJsonSync(DB_FILE, db, { spaces: 2 });
  }
}
function readDB() { ensureDB(); return fs.readJsonSync(DB_FILE); }
function writeDB(data) { fs.writeJsonSync(DB_FILE, data, { spaces: 2 }); }

/* ===== Premium ===== */
function normalizeNumeric(str) { return (str || '').replace(/\D/g, ''); }
function toJid(input) { const n = normalizeNumeric(input); return n ? `${n}@s.whatsapp.net` : null; }
function getPremiumUsers() { return readDB().premiumUsers || []; }
function isPremiumUser(jidOrNumber) {
  const jid = toJid(jidOrNumber);
  const list = getPremiumUsers().map(s => normalizeNumeric(s));
  return list.includes(normalizeNumeric(jid));
}
function addPremiumUser(jidOrNumber) {
  const db = readDB(); const jid = toJid(jidOrNumber); if (!jid) return false;
  const norm = normalizeNumeric(jid);
  const list = (db.premiumUsers || []).map(x => normalizeNumeric(x));
  if (!list.includes(norm)) { db.premiumUsers = [...(db.premiumUsers||[]), jid]; writeDB(db); return true; }
  return false;
}
function removePremiumUser(jidOrNumber) {
  const db = readDB(); const jid = toJid(jidOrNumber); if (!jid) return false;
  const norm = normalizeNumeric(jid); const before = db.premiumUsers?.length || 0;
  db.premiumUsers = (db.premiumUsers||[]).filter(x => normalizeNumeric(x) !== norm);
  writeDB(db); return db.premiumUsers.length < before;
}

/* ===== Usage & Log ===== */
// usage[userJid][commandKey] = { used, lastAt }
function getUsage(userJid, commandKey) {
  const db = readDB();
  return db.usage[userJid]?.[commandKey] || { used: 0, lastAt: 0 };
}
function incUsage(userJid, commandKey) {
  const db = readDB();
  db.usage[userJid] = db.usage[userJid] || {};
  const cur = db.usage[userJid][commandKey] || { used: 0, lastAt: 0 };
  cur.used += 1; cur.lastAt = Date.now();
  db.usage[userJid][commandKey] = cur;
  writeDB(db);
  return cur;
}
function setUsage(userJid, commandKey, used) {
  const db = readDB();
  db.usage[userJid] = db.usage[userJid] || {};
  db.usage[userJid][commandKey] = { used, lastAt: Date.now() };
  writeDB(db);
  return db.usage[userJid][commandKey];
}
function logEvent(event) {
  const db = readDB();
  db.events.push({ at: Date.now(), ...event });
  if (db.events.length > 5000) db.events = db.events.slice(-2500);
  writeDB(db);
}

/* ===== Reset & Report ===== */
function resetAllUsage() {
  const db = readDB();
  const snapshot = db.usage;
  db.events.push({ at: Date.now(), type: 'reset_limits', snapshot });
  db.usage = {};
  writeDB(db);
  return snapshot;
}
function formatResetReport({ snapshot, summary, dateLabel, topN = 10 }) {
  const TL='┌', TR='┐', BL='└', BR='┘', H='─', V='│', L='├', R='┤';
  function box(title, lines, width = 68) {
    const head = `${TL}${H.repeat(width)}${TR}`;
    const foot = `${BL}${H.repeat(width)}${BR}`;
    const t    = `${V} ${title.padEnd(width - 2)} ${V}`;
    const sep  = `${L}${H.repeat(width)}${R}`;
    const body = (lines && lines.length)
      ? lines.map(l => `${V} ${String(l).slice(0,width-2).padEnd(width - 2)} ${V}`).join('\n')
      : `${V} ${'(kosong)'.padEnd(width - 2)} ${V}`;
    return [head, t, sep, body, foot].join('\n');
  }
  const sec1 = box(`RESET LIMIT ${dateLabel}`, [
    `Total user tercatat : ${summary.totalUsers}`,
    `Total command unik  : ${summary.totalCommands}`,
    `Total hit (snapshot): ${summary.totalHits}`,
  ]);
  const sec2 = box(`TOP ${topN} COMMAND`, (summary.topCommands||[])
    .slice(0, topN).map((x,i)=> `${String(i+1).padStart(2,'0')}. ${x.key.padEnd(22)} | hits: ${String(x.count).padStart(4)}`));
  const sec3 = box(`TOP ${topN} GROUP`, (summary.topGroups||[])
    .slice(0, topN).map((x,i)=> `${String(i+1).padStart(2,'0')}. ${x.name.slice(0,42).padEnd(42)} | hits: ${String(x.count).padStart(4)}`));
  return `${sec1}\n${sec2}\n${sec3}`;
}
function makeSummary(snapshot) {
  const users = Object.keys(snapshot || {}); const cmdCounts = {}; let hits = 0;
  for (const u of users) {
    const cmds = snapshot[u] || {};
    for (const k of Object.keys(cmds)) {
      const n = cmds[k]?.used || 0; hits += n; cmdCounts[k] = (cmdCounts[k] || 0) + n;
    }
  }
  const db = readDB(); const groupCounts = {};
  for (const ev of db.events.slice(-2500)) if (ev.type === 'run' && ev.groupName) {
    groupCounts[ev.groupName] = (groupCounts[ev.groupName] || 0) + 1;
  }
  const topCommands = Object.entries(cmdCounts).map(([key,count])=>({key,count})).sort((a,b)=>b.count-a.count);
  const topGroups   = Object.entries(groupCounts).map(([name,count])=>({name,count})).sort((a,b)=>b.count-a.count);
  return { totalUsers: users.length, totalCommands: Object.keys(cmdCounts).length, totalHits: hits, topCommands, topGroups };
}

module.exports = {
  // premium
  getPremiumUsers, isPremiumUser, addPremiumUser, removePremiumUser, toJid, normalizeNumeric,
  // usage & log
  getUsage, incUsage, setUsage, logEvent,
  // reset/report
  resetAllUsage, formatResetReport, makeSummary,
};