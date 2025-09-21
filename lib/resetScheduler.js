// lib/resetScheduler.js
const db = require('./db');

function millisToNextMidnight(offsetMinutes = 420) {
  // offsetMinutes: perbedaan menit dari UTC (420 = UTC+7)
  const now = Date.now();
  const local = now + offsetMinutes * 60 * 1000;
  const d = new Date(local);
  const next = new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1); // UTC-based date parts
  const nextLocalMidnight = Date.UTC(next.getUTCFullYear(), next.getUTCMonth(), next.getUTCDate(), 0, 0, 0);
  const deltaLocal = nextLocalMidnight - (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()));
  return deltaLocal; // ms until local 00:00
}

function formatDateLabel(offsetMinutes = 420) {
  const now = new Date(Date.now() + offsetMinutes * 60 * 1000);
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth()+1).padStart(2,'0');
  const d = String(now.getUTCDate()).padStart(2,'0');
  return `${y}-${m}-${d} 00:00 (UTC${offsetMinutes>=0?'+':'-'}${Math.abs(offsetMinutes/60)})`;
}

async function sendOwnerReport(client, ownerJid, caption, imageUrl) {
  try {
    await client.sendMessage(ownerJid, {
      image: { url: imageUrl },
      caption,
    });
  } catch (e) {
    console.error('Gagal kirim laporan reset ke owner:', e);
  }
}

function startMidnightResetScheduler(client, config) {
  const offset = Number(config.timezoneOffsetMinutes ?? 420);
  const image = config.resetNotifyImage || config.defaultReplyImage || 'https://i.imgur.com/0Z8FQhK.png';
  const ownerJid = (config.ownerNumber || '').replace(/\D/g, '') + '@s.whatsapp.net';

  async function doResetAndNotify() {
    // Ambil snapshot usage lama, reset usage
    const snapshot = db.resetAllUsage();
    const summary  = db.makeSummary(snapshot);
    const dateLabel = formatDateLabel(offset);
    const report = db.formatResetReport({
      snapshot, summary, dateLabel, topN: Number(config.resetIncludeTopN ?? 10)
    });
    // Kirim ke owner
    await sendOwnerReport(client, ownerJid, report, image);
  }

  async function scheduleNext() {
    const ms = millisToNextMidnight(offset);
    setTimeout(async () => {
      try {
        await doResetAndNotify();
      } finally {
        // Jadwalkan tiap 24 jam berikutnya (tepat setelah 00:00 lokal)
        setInterval(doResetAndNotify, 24 * 60 * 60 * 1000);
      }
    }, ms);
  }

  // Jalanin scheduler
  scheduleNext();
}

module.exports = { startMidnightResetScheduler };