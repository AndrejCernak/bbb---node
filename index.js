const WebSocket = require('ws')
const PORT = process.env.PORT || 3000

const wss = new WebSocket.Server({ port: PORT })
const clients = new Map() // Map<clientId, WebSocket>

wss.on('connection', (ws) => {
  let clientId = null

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString())

      // Klient sa registruje so svojim clientId
      if (data.type === 'register') {
        clientId = data.clientId
        clients.set(clientId, ws)
        console.log(`✅ Klient zaregistrovaný: ${clientId}`)
        return
      }

      // Posielame správu určenému klientovi
      const recipientSocket = clients.get(data.to)
      if (recipientSocket && recipientSocket.readyState === WebSocket.OPEN) {
        recipientSocket.send(JSON.stringify(data))
      }
    } catch (err) {
      console.error('❌ Neplatná správa:', err)
    }
  })

  ws.on('close', () => {
    if (clientId && clients.has(clientId)) {
      clients.delete(clientId)
      console.log(`❌ Klient odpojený: ${clientId}`)
    }
  })
})

console.log(`✅ WebSocket server beží na porte ${PORT}`)
