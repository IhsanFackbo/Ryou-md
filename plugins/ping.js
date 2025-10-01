async function handler(ctx) {
  const t0 = Date.now();
  const ms = Date.now() - t0;
  const msg =
`┌───── PING ─────┐
│ Latency ~ ${ms} ms
│ Chat   : ${ctx.isGroup ? (ctx.groupName || 'Group') : 'Private'}
└──────────────┘`;
  await ctx.reply(msg);
}
handler.tag = ['test','utility'];
handler.help = ['!ping / .ping'];
handler.command = /^[.!]ping$/i; 
handler.role = 'owner';
handler.scope = 'all';
handler.premium = false;
handler.key = 'ping_work';
handler.enabled = true;
handler.nolimit = true; 
module.exports = handler;