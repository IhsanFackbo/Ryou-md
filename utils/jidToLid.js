/**
 * Konversi JID ke LID (WhatsApp ID format baru)
 * Contoh JID: 6281234567890@s.whatsapp.net
 * LID: 6281234567890-xxxxxxxxxx@g.us (untuk grup)
 * 
 * Fungsi ini menyesuaikan format LID untuk grup dan personal
 */

function jidToLid(jid) {
  if (!jid) return null;
  // Jika grup (biasanya berakhiran @g.us)
  if (jid.endsWith('@g.us')) {
    // Contoh konversi sederhana: ganti @g.us ke -xxxx@g.us
    // Biasanya LID adalah format baru, tapi untuk contoh kita return jid apa adanya
    return jid.replace('@g.us', '-1234567890@g.us'); // contoh suffix
  }
  // Jika personal
  if (jid.endsWith('@s.whatsapp.net')) {
    // LID personal biasanya sama dengan jid
    return jid;
  }
  return jid;
}

module.exports = { jidToLid };
