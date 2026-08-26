import {describe, expect, it} from 'vitest';
import {createApp} from '../src/server.js';

describe('HTTP bridge server app', () => {
  it('reports health', async () => {
    const response = await createApp().request('/health');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      service: 'turbowarp-http-server'
    });
  });

  it('returns a bridge placeholder for ordinary HTTP requests', async () => {
    const response = await createApp().request('/anything', {method: 'POST'});

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: 'not_connected'
    });
  });
});
