const net = require('net');

const SMTP_TIMEOUT_MS = 10000;

/**
 * Module 3 — SMTP Mailbox Check
 * Tente une connexion SMTP pour vérifier que la boîte mail existe,
 * sans envoyer de message (séquence EHLO → MAIL FROM → RCPT TO → QUIT)
 * @param {string} email
 * @param {string|null} mx  - serveur MX issu du module 2
 * @returns {{ exists: boolean|null, score: number, status: string, reasons: string[] }}
 */
async function analyze(email, mx) {
  if (!mx) {
    return { exists: null, score: 0, status: 'UNKNOWN', reasons: ['Pas de serveur MX disponible'] };
  }

  return new Promise((resolve) => {
    const socket = new net.Socket();
    let buffer = '';
    let step = 0;
    let settled = false;

    const done = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(SMTP_TIMEOUT_MS);

    socket.on('timeout', () =>
      done({ exists: null, score: 0, status: 'UNKNOWN', reasons: ['Timeout SMTP'] })
    );

    socket.on('error', (err) =>
      done({ exists: null, score: 0, status: 'UNKNOWN', reasons: [`Erreur connexion SMTP : ${err.message}`] })
    );

    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\r\n');
      buffer = lines.pop(); // garde la ligne incomplète pour la prochaine lecture

      for (const line of lines) {
        if (!line) continue;
        const code = parseInt(line.substring(0, 3), 10);

        if (step === 0 && code === 220) {
          socket.write('EHLO mailguard.check\r\n');
          step = 1;
        } else if (step === 1 && (code === 250 || code === 220)) {
          socket.write('MAIL FROM:<check@mailguard.io>\r\n');
          step = 2;
        } else if (step === 2 && code === 250) {
          socket.write(`RCPT TO:<${email}>\r\n`);
          step = 3;
        } else if (step === 3) {
          socket.write('QUIT\r\n');
          if (code === 250 || code === 251) {
            done({ exists: true, score: 0, status: 'EXISTS', reasons: [] });
          } else if (code === 550 || code === 551 || code === 553 || code === 554) {
            done({ exists: false, score: 15, status: 'NOT_EXISTS', reasons: [`Boîte mail inexistante (code SMTP ${code})`] });
          } else {
            // 450, 451, 452 = erreur temporaire ou catch-all → résultat inconnu
            done({ exists: null, score: 0, status: 'UNKNOWN', reasons: [`Code SMTP inattendu : ${code}`] });
          }
        } else if (step > 0 && code >= 500) {
          // Rejet ferme à une étape inattendue (ex: serveur anti-spam)
          socket.write('QUIT\r\n');
          done({ exists: null, score: 0, status: 'UNKNOWN', reasons: [`Serveur SMTP a rejeté la session (${code})`] });
        }
      }
    });

    socket.connect(25, mx);
  });
}

module.exports = { analyze };
