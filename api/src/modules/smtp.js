const net = require('net');

// Timeout réduit de 10000ms à 300ms — les tests de charge ont montré que le
// timeout initial de 10s, cumulé avec celui de domainAge.js, dégradait le P95
// de latence de façon catastrophique sous charge (voir chapitre 6, tests k6).
const SMTP_TIMEOUT_MS = 300;

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
      clearTimeout(overallTimer);
      socket.destroy();
      resolve(result);
    };

    // Délai global sur l'échange SMTP complet — socket.setTimeout() ci-dessous
    // ne détecte que l'INACTIVITÉ (pas de données reçues pendant X ms) : un
    // serveur qui répond juste avant chaque expiration (ex : délai de bannière
    // volontaire chez Gmail/Outlook, technique anti-spam) peut faire durer tout
    // l'échange (4 allers-retours) bien au-delà de SMTP_TIMEOUT_MS sans jamais
    // déclencher l'event 'timeout'. Ce minuteur borne la durée totale, quelle
    // que soit l'activité du socket.
    const overallTimer = setTimeout(
      () => done({ exists: null, score: 0, status: 'UNKNOWN', reasons: ['Timeout SMTP (délai global dépassé)'] }),
      SMTP_TIMEOUT_MS
    );

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
