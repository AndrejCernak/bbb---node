const WebSocket = require('ws')
const { readFileSync } = require('fs')
const { GoogleAuth } = require('google-auth-library')
const fetch = require('node-fetch')

const PORT = process.env.PORT || 3000
const wss = new WebSocket.Server({ port: PORT })

const clients = new Set()
const fcmTokens = new Map()

// 🔐 Service Account načítanie
const serviceAccount = JSON.parse(readFileSync('./firebase-service-account.json', 'utf8'))

const auth = new GoogleAuth({
  credentials: serviceAccount,
  scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
})

wss.on('connection', (ws) => {
  clients.add(ws)
  console.log('✅ Client connected')

  ws.on('message', async (message) => {
    const data = JSON.parse(message.toString())

    // Ulož FCM token
    if (data.type === 'fcm-token') {
      fcmTokens.set(ws, data.token)
      console.log('💾 Saved FCM token')
      return
    }

    // Posielanie signaling dát + notifikácie
    for (const client of clients) {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(data))

        if (data.type === 'offer') {
          const token = fcmTokens.get(client)
          if (token) {
            await sendPushNotification(token)
          }
        }
      }
    }
  })

  ws.on('close', () => {
    clients.delete(ws)
    fcmTokens.delete(ws)
    console.log('❌ Client disconnected')
  })
})

console.log(`🚀 WebSocket server running on port ${PORT}`)

// 📨 Funkcia na odoslanie notifikácie cez FCM HTTP v1
async function sendPushNotification(fcmToken) {
  const accessToken = await auth.getAccessToken()

  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`, {
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
            link: 'https://aaa-poll.vercel.app', // uprav na tvoju PWA URL
          },
        },
      },
    }),
  })

  const json = await res.json()
  console.log('🔔 Notifikácia odoslaná:', json)
}
