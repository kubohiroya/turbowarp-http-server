import { serve, upgradeWebSocket } from '@hono/node-server'
import { Hono } from 'hono'
import { secureHeaders } from 'hono/secure-headers'
import { WebSocketServer } from 'ws'

const app = new Hono()

app.use('*', secureHeaders())

app.get('/health', (c) =>
  c.json({
    ok: true,
    service: 'turbowarp-http-server',
  }),
)

app.get(
  '/ws',
  upgradeWebSocket(() => ({
    onOpen(_event, ws) {
      ws.send(
        JSON.stringify({
          type: 'hello',
          protocol: 'turbowarp-http-server',
          version: 1,
        }),
      )
    },
    onMessage(event, ws) {
      // Temporary echo behavior while the bridge protocol is being defined.
      ws.send(event.data)
    },
  })),
)

app.all('*', (c) =>
  c.json(
    {
      error: 'not_connected',
      message:
        'HTTP-to-TurboWarp request forwarding has not been implemented yet.',
    },
    503,
  ),
)

const port = Number.parseInt(process.env.PORT ?? '8787', 10)
const hostname = process.env.HOST ?? '127.0.0.1'
const wss = new WebSocketServer({ noServer: true })

const server = serve(
  {
    fetch: app.fetch,
    hostname,
    port,
    websocket: { server: wss },
  },
  (info) => {
    console.log(`turbowarp-http-server listening on http://${hostname}:${info.port}`)
  },
)

function shutdown(signal: string): void {
  console.log(`Received ${signal}; shutting down.`)
  server.close((error) => {
    if (error) {
      console.error(error)
      process.exitCode = 1
    }
  })
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
