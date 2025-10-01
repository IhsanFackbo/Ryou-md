const fs = require('fs-extra');
const path = require('path');
const chalk = require('chalk');
const config = require('./config');

const PREFIXES = Array.isArray(config.prefixes) && config.prefixes.length
  ? config.prefixes.map(String)
  : ['.', '!'];

let jidNormalizedUser = (j) => j;
try { ({ jidNormalizedUser } = require('@whiskeysockets/baileys')); } catch {}

let logMessageStatus;
try {
  const m = require('./logs/messageStatus');
  if (m && typeof m.logMessageStatus === 'function') logMessageStatus = m.logMessageStatus;
} catch { /* ignore */ }

function unwrap(msg) {
  if (!msg) return {};
  if (msg.ephemeralMessage) return unwrap(msg.ephemeralMessage.message);
  if (msg.viewOnceMessage) return unwrap(msg.viewOnceMessage.message);
  if (msg.viewOnceMessageV2) return unwrap(msg.viewOnceMessageV2.message);
  if (msg.viewOnceMessageV2Extension) return unwrap(msg.viewOnceMessageV2Extension.message);
  if (msg.documentWithCaptionMessage) return unwrap(msg.documentWithCaptionMessage.message);
  return msg;
}
function getBody(m) {
  const msg = unwrap(m?.message || {});
  return (
    msg.conversation ||
    msg.extendedTextMessage?.text ||
    msg.imageMessage?.caption ||
    msg.videoMessage?.caption ||
    msg.documentMessage?.caption ||
    ''
  ).trim();
}

function getSenderJid(m) {
  let j = m?.key?.participant;
  if (!j) {
    const raw = unwrap(m?.message || {});
    const ci =
      raw?.extendedTextMessage?.contextInfo ||
      raw?.imageMessage?.contextInfo ||
      raw?.videoMessage?.contextInfo ||
      raw?.buttonsMessage?.contextInfo ||
      raw?.listResponseMessage?.contextInfo ||
      raw?.templateButtonReplyMessage?.contextInfo ||
      raw?.interactiveResponseMessage?.contextInfo ||
      raw?.templateMessage?.contextInfo ||
      raw?.messageContextInfo;
    j = ci?.participant || m?.key?.remoteJid;
  }
  if (j && j.endsWith('@lid')) j = jidNormalizedUser ? jidNormalizedUser(j) : j.replace(/@lid$/, '@s.whatsapp.net');
  return j;
}

function isGroup(jid) { return typeof jid === 'string' && jid.endsWith('@g.us'); }
function normNum(x) {                       
  if (!x) return '';
  const left = String(x).split('@')[0].split(':')[0];
  return left.replace(/\D/g, '');
}

// Owner set (nomor & LID)
function getOwnerPhones() {
  const list = [];
  if (config.ownerNumber) list.push(config.ownerNumber);
  if (Array.isArray(config.ownerNumbers)) list.push(...config.ownerNumbers);
  return list.filter(Boolean).map(normNum).filter(Boolean);
}
function getOwnerLids() {
  const list = [];
  if (config.ownerLid) list.push(config.ownerLid);
  if (Array.isArray(config.ownerLids)) list.push(...config.ownerLids);
  return list.filter(Boolean).map(n => String(n).replace(/\D/g,'')).filter(Boolean);
}
function getAllOwnerKeys() { return [...new Set([...getOwnerPhones(), ...getOwnerLids()])]; }

function isOwner(jidOrNumber) { return getAllOwnerKeys().includes(normNum(jidOrNumber)); }

async function isAdmin(client, chatJid, userJid) {
  try {
    if (!isGroup(chatJid)) return false;
    const md = await client.groupMetadata(chatJid);
    const admins = (md.participants || []).filter(p => p.admin).map(p => p.id);
    return admins.includes(userJid);
  } catch { return false; }
}

// ===== DB hooks (optional) =====
let DB = null;
try { DB = require('./lib/db'); } catch {}

// ===== In-memory fallbacks =====
const memUsage = new Map();     // per-feature: Map<user, {key:{used,lastAt}} >
const memTotal = new Map();     // GLOBAL usage: Map<user, totalUsed>
const memRegistered = new Set();// Set<userKey>
const memPremiumPhones = new Set();
const memPremiumLids   = new Set();

// ==== Usage (per-feature) ====
function getUsage(user, key) {
  if (DB?.getUsage) return DB.getUsage(user, key);
  const u = memUsage.get(user) || {};
  return u[key] || { used: 0, lastAt: 0 };
}
function incUsageBy(user, key, count) {
  count = Math.max(1, Number(count || 1));
  if (DB?.incUsageBy) return DB.incUsageBy(user, key, count);
  const u = memUsage.get(user) || {};
  const cur = u[key] || { used: 0, lastAt: 0 };
  cur.used += count; cur.lastAt = Date.now();
  u[key] = cur; memUsage.set(user, u);
  return cur;
}
function getAllUsage(user) {
  if (DB?.getAllUsage) return DB.getAllUsage(user);
  return memUsage.get(user) || {};
}

// ==== GLOBAL usage ====
function getTotalUsage(user) {
  if (DB?.getTotalUsage) return DB.getTotalUsage(user);
  return { used: Number(memTotal.get(user) || 0) };
}
function incTotalBy(user, count) {
  count = Math.max(1, Number(count || 1));
  if (DB?.incTotalBy) return DB.incTotalBy(user, count);
  const cur = Number(memTotal.get(user) || 0) + count;
  memTotal.set(user, cur);
  return { used: cur };
}

function isRegistered(user) {
  if (DB?.isRegistered) return DB.isRegistered(user);
  return memRegistered.has(normNum(user));
}
function registerUser(user) {
  if (DB?.registerUser) return DB.registerUser(user);
  memRegistered.add(normNum(user));
  return true;
    }
// >>>> TAMBAHAN <<<<
function unregisterUser(user) {
  if (DB?.unregisterUser) return DB.unregisterUser(user);
  const key = normNum(user);
  memRegistered.delete(key);
  memTotal.delete(user);     
  memUsage.delete(user);      
  return true;
}
function isPremium(userJid) {
  // DB first
  try {
    if (DB?.isPremiumUser) return !!DB.isPremiumUser(userJid);
    if (DB?.isPremiumByNumber) return !!DB.isPremiumByNumber(normNum(userJid));
    if (DB?.isPremiumByLid) return !!DB.isPremiumByLid(normNum(userJid));
  } catch {}
  // memory
  const key = normNum(userJid);
  return memPremiumPhones.has(key) || memPremiumLids.has(key);
}
function addPremiumByPhone(numberDigits) {
  numberDigits = normNum(numberDigits);
  if (!numberDigits) return false;
  if (DB?.addPremiumByNumber) return DB.addPremiumByNumber(numberDigits);
  memPremiumPhones.add(numberDigits); return true;
}
function addPremiumByLid(lidDigits) {
  lidDigits = String(lidDigits || '').replace(/\D/g,'');
  if (!lidDigits) return false;
  if (DB?.addPremiumByLid) return DB.addPremiumByLid(lidDigits);
  memPremiumLids.add(lidDigits); return true;
}

function logEvent(ev) { try { DB?.logEvent?.(ev); } catch {} }

// ==== Expose to plugins ====
global.USAGE = {
  get: getUsage,
  all: getAllUsage,
  total: { get: getTotalUsage, incBy: incTotalBy },
  quota: () => Number(config.defaultLimitQuota ?? 50)
};
global.USERDB = {
  isRegistered,
  register: registerUser,
  unregister: unregisterUser,
  keyOf: normNum
};
global.PREMIUM = {
  addByPhone: addPremiumByPhone,
  addByLid: addPremiumByLid
};

// ===== Visual helpers =====
function box(title, lines = [], width = 58) {
  const TL='┌', TR='┐', BL='└', BR='┘', H='─', V='│', L='├', R='┤';
  const head = `${TL}${H.repeat(width)}${TR}`;
  const foot = `${BL}${H.repeat(width)}${BR}`;
  const t    = `${V} ${title.padEnd(width - 2)} ${V}`;
  const sep  = `${L}${H.repeat(width)}${R}`;
  const body = lines.length
    ? lines.map(l => `${V} ${String(l).slice(0,width-2).padEnd(width-2)} ${V}`).join('\n')
    : `${V} ${'(kosong)'.padEnd(width-2)} ${V}`;
  return [head, t, sep, body, foot].join('\n');
}

async function replyText(client, jid, text) {
  try {
    const sent = await client.sendMessage(jid, { text });
    if (typeof logMessageStatus === 'function') logMessageStatus(sent.key.id, 'sent');
    return sent;
  } catch (err) {
    if (typeof logMessageStatus === 'function') logMessageStatus('unknown', 'failed');
    console.error('Gagal kirim text:', err);
  }
}
const DEFAULT_IMAGE_URL = 'https://i.imgur.com/0Z8FQhK.png';
async function replyImage(client, jid, caption, imageBufferOrUrl) {
  try {
    const sent = await client.sendMessage(jid, {
      image: imageBufferOrUrl || { url: (config.images?.denied || config.defaultReplyImage || DEFAULT_IMAGE_URL) },
      caption: caption || '',
    });
    if (typeof logMessageStatus === 'function') logMessageStatus(sent.key.id, 'sent');
    return sent;
  } catch (err) {
    if (typeof logMessageStatus === 'function') logMessageStatus('unknown', 'failed');
    console.error('Gagal kirim image:', err);
  }
}

// ===== Pretty inbound log =====
function prettyInboundLog(ctx) {
  const role = ctx.role.toUpperCase();
  const scope = ctx.isGroup ? (ctx.groupName || 'Group') : 'Private';
  const sep = chalk.gray('────────────────────────────────────────────────────────');
  console.log(sep);
  console.log(
    chalk.cyan('[IN]'),
    chalk.yellow('from:'), chalk.white(ctx.from),
    chalk.yellow('sender:'), chalk.white(ctx.sender)
  );
  console.log(
    chalk.yellow('scope:'), chalk.magenta(scope),
    chalk.yellow('role:'), chalk.blue(role)
  );
  console.log(chalk.yellow('text:'), chalk.white(JSON.stringify(ctx.text)));
  console.log(sep);
}

// ===== Context builder =====
async function getGroupNameSafe(client, jid) {
  try { if (!isGroup(jid)) return null; const md = await client.groupMetadata(jid); return md?.subject || null; }
  catch { return null; }
}
async function buildContext(client, message) {
  const from   = message?.key?.remoteJid;
  const sender = getSenderJid(message);
  const text   = getBody(message);
  const role   = isOwner(sender) ? 'owner' : (await isAdmin(client, from, sender)) ? 'admin' : 'user';
  const groupName = await getGroupNameSafe(client, from);
  const unlimited = isOwner(sender) || isPremium(sender);

  return {
    client, message, from, sender, text, role, groupName,
    isGroup: isGroup(from), unlimited, config,
    reply: (t) => replyText(client, from, t),
    replyImage: (cap, img) => replyImage(client, from, cap, img),
  };
}

// ===== Gates =====
function roleAllowed(required, userRole) {
  if (!required || required === 'all' || required === 'user') return true;
  if (required === 'admin') return userRole === 'admin' || userRole === 'owner';
  if (required === 'owner') return userRole === 'owner';
  if (Array.isArray(required)) return required.includes(userRole);
  return false;
}
async function denyFancy(ctx, key, reason) {
  const quota = Number(ctx.config.defaultLimitQuota ?? 50);
  const total = global.USAGE.total.get(ctx.sender);
  const remaining = Math.max(0, quota - Number(total.used || 0));

  let subtitle = 'Akses ditolak.';
  if (reason === 'owner') subtitle = 'Khusus Owner';
  else if (reason === 'admin') subtitle = 'Khusus Admin/Owner';
  else if (reason === 'premium') subtitle = 'Khusus Premium';
  else if (reason === 'group-only') subtitle = 'Hanya untuk Group';
  else if (reason === 'private-only') subtitle = 'Hanya untuk Private Chat';
  else if (reason === 'limit') subtitle = 'Limit Habis';

  const caption = `ACCESS DENIED\n${subtitle}`;

  await replyImage(
    ctx.client,
    ctx.from,
    caption,
    { url: (config.images?.denied || config.defaultReplyImage || DEFAULT_IMAGE_URL) }
  );

  logEvent({
    type: 'denied', user: ctx.sender, cmd: key, reason,
    role: ctx.role, remaining, scope: ctx.isGroup ? 'group' : 'private',
    groupName: ctx.groupName || undefined,
  });
}

// ===== Plugin loader (hot-reload + interval fallback) =====
const pluginsPath = path.join(__dirname, 'plugins');
let PLUGINS = [];

function loadPlugins() {
  fs.ensureDirSync(pluginsPath);
  const files = fs.readdirSync(pluginsPath).filter(f => f.endsWith('.js'));
  const loaded = [];
  for (const file of files) {
    const full = path.join(pluginsPath, file);
    try {
      delete require.cache[require.resolve(full)];
      const mod = require(full);
      if (typeof mod !== 'function') { console.error(`[plugin] SKIP '${file}': module.exports bukan function`); continue; }
      const cmd = mod.command;
      if (!(cmd instanceof RegExp) && typeof cmd !== 'function') {
        console.error(`[plugin] SKIP '${file}': handler.command harus RegExp atau function(ctx)`); continue;
      }
      mod.__file = file;
      loaded.push(mod);
    } catch (e) {
      console.error(`[plugin] GAGAL load '${file}': ${e.message}`);
    }
  }
  PLUGINS = loaded;
  global.PLUGIN_REGISTRY = PLUGINS;
  console.log(`[plugin] Loaded ${PLUGINS.length} plugin: ${PLUGINS.map(p => p.key || p.help?.[0] || p.__file).join(', ')}`);
}
loadPlugins();
try {
  fs.watch(pluginsPath, { recursive: false }, (evt, filename) => {
    if (!filename || !filename.endsWith('.js')) return;
    console.log(`[plugin] Detected ${evt} on ${filename}, reloading...`);
    loadPlugins();
  });
} catch (e) {
  console.error('[plugin] fs.watch tidak tersedia, skip hot-reload:', e.message);
}
setInterval(() => { try { loadPlugins(); } catch {} }, 10_000);

// ===== Prefix helper =====
function isBarePrefix(text) {
  if (!text) return false;
  const t = text.trim();
  return PREFIXES.includes(t);
}
function startsWithAnyPrefix(text) {
  if (!text) return null;
  for (const p of PREFIXES) if (text.startsWith(p)) return p;
  return null;
}

// ===== Main handler =====
async function handleMessage(client, message) {
  try {
    if (!message?.message) return;

    const ctx = await buildContext(client, message);
    prettyInboundLog(ctx);

    let handled = false;
    for (const plugin of PLUGINS) {
      if (plugin.enabled === false) continue;

      // match
      let matched = false;
      if (plugin.command instanceof RegExp) matched = plugin.command.test(ctx.text);
      else if (typeof plugin.command === 'function') matched = await plugin.command(ctx);
      if (!matched) continue;

      const key = plugin.key || plugin.__file || 'default';

      // scope
      const scope = plugin.scope || 'all';
      if (scope === 'group' && !ctx.isGroup) { await denyFancy(ctx, key, 'group-only'); handled = true; break; }
      if (scope === 'private' && ctx.isGroup) { await denyFancy(ctx, key, 'private-only'); handled = true; break; }

      // role
      const needRole = plugin.role || 'all';
      if (!roleAllowed(needRole, ctx.role)) {
        await denyFancy(ctx, key, needRole === 'owner' ? 'owner' : 'admin'); handled = true; break;
      }

      // === REGISTRATION gate (default: wajib) ===
      const requireRegister = (plugin.register !== false); // true by default
      if (requireRegister && !isRegistered(ctx.sender) && !ctx.unlimited) {
        await ctx.reply('❌ Kamu belum terdaftar.\nSilakan daftar dengan *.daftar*');
        handled = true; break;
      }

      // premium
      if (plugin.premium === true && !isPremium(ctx.sender)) {
        await denyFancy(ctx, key, 'premium'); handled = true; break;
      }

      // === GLOBAL LIMIT (FREE only) ===
      const skipLimit = (plugin.nolimit === true) || ctx.unlimited;
      const quota = Number(config.defaultLimitQuota ?? 50);
      const cost  = Math.max(1, Number(plugin.cost ?? 1));
      let totalUsedAfter = 0, totalLeftAfter = quota;

      if (!skipLimit) {
        const total = global.USAGE.total.get(ctx.sender); // { used }
        const remaining = Math.max(0, quota - Number(total.used || 0));
        if (remaining < cost) { await denyFancy(ctx, key, 'limit'); handled = true; break; }

        // catat GLOBAL + per-fitur
        const t = global.USAGE.total.incBy(ctx.sender, cost);
        incUsageBy(ctx.sender, key, cost);

        totalUsedAfter = Number(t.used || 0);
        totalLeftAfter = Math.max(0, quota - totalUsedAfter);
      }

      // run plugin
      try {
        await plugin({
          ...ctx,
          registry: PLUGINS,
          limit: { key, quota, used: totalUsedAfter, remaining: totalLeftAfter, cost }
        });
        handled = true;

        if (!skipLimit) {
          await ctx.reply(`${totalUsedAfter} use limit sisa limit ${totalLeftAfter}`);
        }

        logEvent({
          type: 'run', user: ctx.sender, cmd: key, role: ctx.role,
          totalUsed: totalUsedAfter, totalRemaining: totalLeftAfter,
          unlimited: ctx.unlimited === true, scope: ctx.isGroup ? 'group' : 'private',
          groupName: ctx.groupName || undefined, file: plugin.__file,
        });

        break; // stop di plugin pertama yg match
      } catch (e) {
        console.error(`Plugin error [${key}] (${plugin.__file}):`, e);
        const totalNow = global.USAGE.total.get(ctx.sender);
        const msg = [
          '❌ Terjadi kesalahan saat menjalankan fitur.',
          ctx.groupName ? `Group: ${ctx.groupName}` : null,
          ctx.unlimited ? 'Mode: Unlimited'
                        : `Used: ${totalNow.used || 0} • Quota: ${config.defaultLimitQuota ?? 50}`
        ].filter(Boolean).join('\n');
        await replyText(client, ctx.from, msg);
        logEvent({
          type: 'error', user: ctx.sender, cmd: key, role: ctx.role,
          error: String(e?.message || e),
          unlimited: ctx.unlimited === true, scope: ctx.isGroup ? 'group' : 'private',
          groupName: ctx.groupName || undefined, file: plugin.__file,
        });
        handled = true;
        break;
      }
    }

    if (!handled) {
      if (isBarePrefix(ctx.text)) {
        await ctx.reply('Lanjutkan dengan perintah.');
      } else if (startsWithAnyPrefix(ctx.text)) {
        // optional: unknown command
      }
    }
  } catch (err) {
    console.error('Error di handler:', err);
  }
}

// ===== Send with status =====
async function sendMessageWithStatus(client, jid, message) {
  try {
    const sent = await client.sendMessage(jid, message);
    if (typeof logMessageStatus === 'function') logMessageStatus(sent.key.id, 'sent');
    return sent;
  } catch (error) {
    if (typeof logMessageStatus === 'function') logMessageStatus('unknown', 'failed');
    console.error('Gagal mengirim pesan:', error);
  }
}

// ===== Midnight reset (00:00) =====
function millisToNextMidnight(offsetMinutes = 420) {
  const now = Date.now();
  const localMs = now + offsetMinutes * 60000;
  const d = new Date(localMs);
  const nextLocal = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0));
  const curLocal = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds());
  return nextLocal.getTime() - curLocal;
}
function fmtUptime(ms) {
  const s = Math.floor(ms/1000);
  const h = String(Math.floor(s/3600)).padStart(2,'0');
  const m = String(Math.floor((s%3600)/60)).padStart(2,'0');
  const ss= String(s%60).padStart(2,'0');
  return `${h}:${m}:${ss}`;
}
function localDateParts(offsetMinutes=420){
  const now = new Date(Date.now() + offsetMinutes*60000);
  const y = now.getUTCFullYear();
  const mo = String(now.getUTCMonth()+1).padStart(2,'0');
  const d = String(now.getUTCDate()).padStart(2,'0');
  const hh = String(now.getUTCHours()).padStart(2,'0');
  const mi = String(now.getUTCMinutes()).padStart(2,'0');
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const offh = String(Math.floor(Math.abs(offsetMinutes)/60)).padStart(2,'0');
  return { date:`${y}-${mo}-${d}`, time:`${hh}:${mi} (UTC${sign}${offh})` };
}

async function initScheduler(client) {
  const offset = Number(config.timezoneOffsetMinutes ?? 420);
  const ownerJids = getOwnerPhones().map(n => `${n}@s.whatsapp.net`);
  const dbOK = !!(DB && DB.resetAllUsage && DB.makeSummary && DB.formatResetReport);

  async function doResetAndNotify() {
    // reset usage
    let summaryText = '';
    if (dbOK) {
      const snapshot = DB.resetAllUsage();
      const summary  = DB.makeSummary(snapshot);
      summaryText = `\n\nReset limit selesai.\nTotal User: ${summary.totalUsers} • Total Hits: ${summary.totalHits}`;
    } else {
      memUsage.clear();
      memTotal.clear(); // reset GLOBAL juga
      summaryText = `\n\nReset limit selesai (memori).`;
    }

    const { date, time } = localDateParts(offset);
    const head =
`┌  ◦ Uptime : ${fmtUptime(process.uptime()*1000)}
│  ◦ Tanggal : ${date}
│  ◦ Waktu : ${time}
└  ◦ Prefix Used : ${PREFIXES.join(' ')}`;

    const msg = head + summaryText;
    for (const jid of ownerJids) { try { await client.sendMessage(jid, { text: msg }); } catch {} }
  }

  const firstDelay = millisToNextMidnight(offset);
  setTimeout(async () => {
    try { await doResetAndNotify(); }
    finally { setInterval(doResetAndNotify, 24 * 60 * 60 * 1000); }
  }, firstDelay);
}

module.exports = { handleMessage, sendMessageWithStatus, initScheduler };