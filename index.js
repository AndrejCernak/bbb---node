require('dotenv').config();
const WebSocket = require('ws');
const { GoogleAuth } = require('google-auth-library');

const PORT = process.env.PORT || 3000;
const wss = new WebSocket.Server({ port: PORT });

const serviceAccount = {
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\\\n/g, '\n'), // opravené
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
};

const auth = new GoogleAuth({
  credentials: serviceAccount,
  scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
});

const clients = new Map();

wss.on('connection', (ws) => {
  const id = Math.random().toString(36).substr(2, 9);
  clients.set(ws, { id, role: null, fcmToken: null, peer: null });

  ws.on('message', async (message) => {
    const data = JSON.parse(message.toString());
    const clientInfo = clients.get(ws);

    if (data.type === 'register') {
      clientInfo.role = data.role;
      console.log(`👤 ${clientInfo.role} registered as ${id}`);
      return;
    }

    if (data.type === 'fcm-token') {
      clientInfo.fcmToken = data.token;
      console.log(`💾 Saved FCM token for ${clientInfo.role}`);
      return;
    }

    if (data.type === 'offer' && clientInfo.role === 'client') {
      const admin = [...clients.entries()].find(([_, info]) => info.role === 'admin');
      if (admin) {
        clientInfo.peer = admin[1].id;
        admin[1].peer = clientInfo.id;

        admin[0].send(JSON.stringify({ type: 'offer', offer: data.offer, from: clientInfo.id }));

        if (admin[1].fcmToken) {
          await sendPushNotification(admin[1].fcmToken);
        }
      }
      return;
    }

    if (data.type === 'answer' && clientInfo.role === 'admin') {
      const target = [...clients.entries()].find(([_, info]) => info.id === data.to);
      if (target) {
        target[0].send(JSON.stringify({ type: 'answer', answer: data.answer }));
      }
      return;
    }

    if (data.type === 'ice') {
      const target = [...clients.entries()].find(([_, info]) => info.id === data.to);
      if (target) {
        target[0].send(JSON.stringify({ type: 'ice', candidate: data.candidate }));
      }
      return;
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`❌ Client ${id} disconnected`);
  });
});

console.log(`🚀 WebSocket server running on port ${PORT}`);

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
                link: 'https://aaa-poll.vercel.app',
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
      console.log('✅ FCM push sent:', json);
    }
  } catch (err) {
    console.error('🔥 Error sending FCM push:', err);
  }
}
