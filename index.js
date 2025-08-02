const WebSocket = require('ws')
const PORT = process.env.PORT || 3000

const wss = new WebSocket.Server({ port: PORT })
const clients = new Set()

wss.on('connection', (ws) => {
  clients.add(ws)
  console.log('Client connected')

  ws.on('message', (message) => {
    for (const client of clients) {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(message.toString())
      }
    }
  })

  ws.on('close', () => {
    clients.delete(ws)
    console.log('Client disconnected')
  })
})

console.log(`WebSocket server running on port ${PORT}`)
