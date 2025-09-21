const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { handleMessage, initScheduler } = require('./handler');
const qrcode = require('qrcode-terminal');
const figlet = require('figlet');
const chalk = require('chalk');
const pino = require('pino');

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('./session');

  const { version, isLatest } = await fetchLatestBaileysVersion();
  console.log(chalk.gray(`Using WA v${version.join('.')} (latest: ${isLatest ? 'yes' : 'no'})`));

  const client = makeWASocket({
    version,
    printQRInTerminal: false,
    auth: state,
    logger: pino({ level: 'silent' })
  });

  client.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.clear();
      console.log(
        chalk.cyan(
          figlet.textSync('isan', {
            font: 'Standard',
            horizontalLayout: 'default',
            verticalLayout: 'default',
            width: 80,
            whitespaceBreak: true
          })
        )
      );
      console.log(chalk.magenta('Scan QR berikut untuk login:\n'));
      qrcode.generate(qr, { small: true });
      console.log(chalk.gray('\nJika QR tidak muncul, periksa koneksi internet kamu.'));
    }

    if (connection === 'close') {
      const code = (lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = code !== DisconnectReason.loggedOut;
      console.log(chalk.red(`Koneksi terputus (code: ${code}). Reconnect: ${shouldReconnect}`));
      if (shouldReconnect) startBot();
      else console.log(chalk.yellow('Sesi logout permanen. Hapus folder /session lalu jalankan ulang untuk login baru.'));
    }

    if (connection === 'open') {
      console.log(chalk.greenBright('✅ Bot terhubung ke WhatsApp!'));
      // mulai scheduler reset 00:00
      initScheduler(client);
    }
  });

  client.ev.on('creds.update', saveCreds);

  client.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    const msg = messages?.[0];
    if (!msg?.message) return;
    try {
      await handleMessage(client, msg);
    } catch (e) {
      console.error('Fatal handleMessage:', e);
    }
  });
}

startBot();