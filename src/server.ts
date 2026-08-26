import {serve} from '@hono/node-server';
import type {ServerType} from '@hono/node-server';
import {Hono} from 'hono';
import {secureHeaders} from 'hono/secure-headers';
import {WebSocketServer} from 'ws';

export interface ServerOptions {
  hostname: string;
  port: number;
}

export interface RunningServer {
  hostname: string;
  port: number;
  close(): Promise<void>;
}

export function createApp(): Hono {
  const app = new Hono();

  app.use('*', secureHeaders());

  app.get('/health', (c) =>
    c.json({
      ok: true,
      service: 'turbowarp-http-server'
    })
  );

  app.get('/ws', (c) =>
    c.json(
      {
        error: 'upgrade_required',
        message: 'Connect to this endpoint with WebSocket.'
      },
      426
    )
  );

  app.all('*', (c) =>
    c.json(
      {
        error: 'not_connected',
        message: 'HTTP-to-TurboWarp request forwarding has not been implemented yet.'
      },
      503
    )
  );

  return app;
}

export function startServer(options: ServerOptions): RunningServer {
  const app = createApp();
  const wss = new WebSocketServer({noServer: true});
  const server: ServerType = serve({
    fetch: app.fetch,
    hostname: options.hostname,
    port: options.port
  });

  server.on('upgrade', (request, socket, head) => {
    if (request.url !== '/ws') {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      ws.send(
        JSON.stringify({
          type: 'hello',
          protocol: 'turbowarp-http-server',
          version: 1
        })
      );
      ws.on('message', (message) => {
        ws.send(message);
      });
    });
  });

  return {
    hostname: options.hostname,
    port: options.port,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      })
  };
}
