const WebSocket = require('ws');
const { readFileSync } = require('fs');
const { GoogleAuth } = require('google-auth-library');
const fetch = require('node-fetch');

const PORT = process.env.PORT || 3000;
const wss = new WebSocket.Server({ port: PORT });

/**
 * Uchováme info o pripojených klientoch:
 * key = ws objekt, value = { role: 'client' | 'admin', fcmToken?: string }
 */
const clients = new Map();

// 🔐 Načítanie Firebase Service Account
const serviceAccount = JSON.parse(readFileSync('./firebase-service-account.json', 'utf8'));

const auth = new GoogleAuth({
  credentials: serviceAccount,
  scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
});

wss.on('connection', (ws) => {
  console.log('✅ Client connected');

  // Keď sa pripojí, ešte nepoznáme jeho rolu ani token
  clients.set(ws, { role: null, fcmToken: null });

  ws.on('message', async (message) => {
    const data = JSON.parse(message.toString());
    const clientInfo = clients.get(ws) || {};

    // 1️⃣ Registrácia role (klient/admin) + uloženie FCM tokenu
    if (data.type === 'register') {
      clients.set(ws, { role: data.role, fcmToken: clientInfo.fcmToken });
      console.log(`👤 Client registered as ${data.role}`);
      return;
    }

    if (data.type === 'fcm-token') {
      clients.set(ws, { ...clientInfo, fcmToken: data.token });
      console.log('💾 Saved FCM token for', clientInfo.role || 'unknown');
      return;
    }

    // 2️⃣ Posielanie signaling dát
    if (data.type === 'offer') {
      // Nájdeme pripojeného admina (poradcu)
      for (const [conn, info] of clients.entries()) {
        if (info.role === 'admin' && conn.readyState === WebSocket.OPEN) {
          conn.send(JSON.stringify({ type: 'offer', offer: data.offer }));

          // Pošli push notifikáciu adminovi
          if (info.fcmToken) {
            await sendPushNotification(info.fcmToken);
          }
        }
      }
      return;
    }

    if (data.type === 'answer') {
      // Nájdeme pripojeného klienta
      for (const [conn, info] of clients.entries()) {
        if (info.role === 'client' && conn.readyState === WebSocket.OPEN) {
          conn.send(JSON.stringify({ type: 'answer', answer: data.answer }));
        }
      }
      return;
    }

    if (data.type === 'ice') {
      // Posielaj ICE kandidáta všetkým okrem odosielateľa
      for (const [conn] of clients.entries()) {
        if (conn !== ws && conn.readyState === WebSocket.OPEN) {
          conn.send(JSON.stringify({ type: 'ice', candidate: data.candidate }));
        }
      }
      return;
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log('❌ Client disconnected');
  });
});

console.log(`🚀 WebSocket server running on port ${PORT}`);

// 📨 Odoslanie notifikácie cez FCM HTTP v1
async function sendPushNotification(fcmToken) {
  const accessToken = await auth.getAccessToken();

  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          token: fcmToken,
          notification: {
            title: '📞 Prichádzajúci hovor',
            body: 'Klikni pre prijatie videohovoru',
          },
          webpush: {
            fcmOptions: {
              link: 'https://aaa-poll.vercel.app', // URL tvojej PWA
            },
          },
        },
      }),
    }
  );

  const json = await res.json();
  console.log('🔔 Notifikácia odoslaná:', json);
}
