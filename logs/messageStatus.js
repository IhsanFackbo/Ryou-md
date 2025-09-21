// logs/messageLogger.js

const chalk = require('chalk');
const { jidToLid } = require('../utils/jidToLid');

function pickText(m) {
  const msg = m.message || {};
  return (
    msg.conversation ||
    msg.extendedTextMessage?.text ||
    msg.imageMessage?.caption ||
    msg.videoMessage?.caption ||
    msg.documentMessage?.caption || // lebih umum di Baileys
    msg.documentWithCaptionMessage?.message?.caption || // kalau tipe ini memang ada di build kamu
    ''
  );
}

function logIncomingMessage(m) {
  try {
    const from   = m.key?.remoteJid;
    const sender = m.key?.participant || from;

    const text  = pickText(m);
    const now   = new Date();
    const time  = now.toLocaleTimeString('id-ID', { hour12: false });
    const date  = now.toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' });

    const shortFrom   = jidToLid(from);
    const shortSender = jidToLid(sender);

    // tipe pesan
    const type = Object.keys(m.message || {})[0] || 'unknown';

    // log rapi dengan garis
    const topLine    = '';
    const bottomLine = '';

    console.log(chalk.gray(topLine));
    console.log(
      chalk.cyan(`[${date} ${time}]`) +
      chalk.yellow(` [Chat: ${shortFrom}]`) +
      chalk.green(` [From: ${shortSender}]`) +
      chalk.magenta(` [Type: ${type}]`)
    );
    console.log(chalk.white(`» ${text || chalk.gray('(no text)')}`));
    console.log(chalk.gray(`${bottomLine}\n`));

  } catch (e) {
    console.error(chalk.red('Logger error:'), e);
  }
}

module.exports = { logIncomingMessage };