/**
 * Konversi JID ke LID (WhatsApp ID format baru)
 * Fungsi ini menyesuaikan format LID untuk grup dan personal
  lu hapus ini, erorr*/

function jidToLid(jid) {
  if (!jid) return null;
  if (jid.endsWith('@g.us')) {
    return jid.replace('@g.us', '-1234567890@g.us'); // 
  }
  if (jid.endsWith('@s.whatsapp.net')) {
    return jid;
  }
  return jid;
}
module.exports = { jidToLid };
