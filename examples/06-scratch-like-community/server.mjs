import {serve} from '@hono/node-server';
import {createCommunityApp} from '../../src/community.ts';

const port = Number.parseInt(process.env.PORT ?? '9106', 10);
const hostname = process.env.HOST ?? '127.0.0.1';

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`Invalid port: ${process.env.PORT}`);
}

serve({
  fetch: createCommunityApp().fetch,
  hostname,
  port
});

console.log(`scratch-like community example listening on http://${hostname}:${port}`);
