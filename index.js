const WebSocket = require('ws')
const fetch = require('node-fetch')

const PORT = process.env.PORT || 3000
const FCM_SERVER_KEY = 'TVOJ_FIREBASE_SERVER_KEY' // ⚠️ Nahraď skutočným FCM server key

const wss = new WebSocket.Server({ port: PORT })
const clients = new Set()
const fcmTokens = new Map() // Mapuje socket → FCM token

wss.on('connection', (ws) => {
  clients.add(ws)
  console.log('✅ Client connected')

  ws.on('message', async (message) => {
    const data = JSON.parse(message.toString())

    // Klient poslal FCM token
    if (data.type === 'fcm-token') {
      fcmTokens.set(ws, data.token)
      console.log('🔐 FCM token saved:', data.token)
      return
    }

    // WebRTC Signaling správa (offer, answer, ice)
    for (const client of clients) {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(data))

        // Ak ide o prichádzajúci hovor => push notifikácia
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

// 🔔 Push notifikácia cez FCM
async function sendPushNotification(fcmToken) {
  const response = await fetch('https://fcm.googleapis.com/fcm/send', {
    method: 'POST',
    headers: {
      Authorization: `key=${FCM_SERVER_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      to: fcmToken,
      notification: {
        title: 'Prichádzajúci hovor',
        body: 'Klikni na notifikáciu a pripoj sa',
        icon: '/icon.png',
        click_action: 'https://aaa-poll.vercel.app', // ⚠️ uprav na tvoju URL
      },
      data: {
        type: 'incoming_call',
      },
    }),
  })

  const result = await response.json()
  console.log('📨 FCM response:', result)
}
