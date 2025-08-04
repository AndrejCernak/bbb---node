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

  // Inicializuj prázdny záznam
  clients.set(ws, { role: null, fcmToken: null });

  ws.on('message', async (message) => {
    const data = JSON.parse(message.toString());
    const clientInfo = clients.get(ws) || {};

    // 1️⃣ Registrácia role
    if (data.type === 'register') {
      clients.set(ws, { ...clientInfo, role: data.role });
      console.log(`👤 Client registered as ${data.role}`);
      return;
    }

    // 2️⃣ Uloženie FCM tokenu
    if (data.type === 'fcm-token') {
      clients.set(ws, { ...clientInfo, fcmToken: data.token });
      console.log(`💾 Saved FCM token for role: ${clientInfo.role || 'unknown'}`);
      return;
    }

    // 3️⃣ Signaling: offer → admin
    if (data.type === 'offer') {
      console.log('📨 Offer received from client. Looking for admin...');
      for (const [conn, info] of clients.entries()) {
        if (info.role === 'admin' && conn.readyState === WebSocket.OPEN) {
          console.log('➡️ Sending offer to admin');
          conn.send(JSON.stringify({ type: 'offer', offer: data.offer }));

          // Push notifikácia adminovi
          if (info.fcmToken) {
            console.log('🔔 Sending push to admin:', info.fcmToken);
            await sendPushNotification(info.fcmToken);
          } else {
            console.log('⚠️ Admin has no FCM token registered.');
          }
        }
      }
      return;
    }

    // 4️⃣ Signaling: answer → client
    if (data.type === 'answer') {
      console.log('📨 Answer received from admin. Sending to client...');
      for (const [conn, info] of clients.entries()) {
        if (info.role === 'client' && conn.readyState === WebSocket.OPEN) {
          conn.send(JSON.stringify({ type: 'answer', answer: data.answer }));
        }
      }
      return;
    }

    // 5️⃣ ICE candidates
    if (data.type === 'ice') {
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
  try {
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

    if (!res.ok) {
      console.error('❌ FCM push failed:', json);
    } else {
      console.log('✅ FCM push sent successfully:', json);
    }
  } catch (err) {
    console.error('🔥 Error sending FCM push:', err);
  }
}
