import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {TurboWarpHttpServerExtension} from '../src/extension.js';

const sockets: FakeWebSocket[] = [];

class FakeWebSocket extends EventTarget {
  public static readonly OPEN = 1;
  public readonly sent: string[] = [];
  public readyState = FakeWebSocket.OPEN;

  public constructor(public readonly url: string) {
    super();
    sockets.push(this);
  }

  public send(message: string): void {
    this.sent.push(message);
  }

  public close(): void {
    this.readyState = 3;
    this.dispatchEvent(new Event('close'));
  }

  public receive(data: string): void {
    this.dispatchEvent(new MessageEvent('message', {data}));
  }
}

beforeEach(() => {
  sockets.length = 0;
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal('Scratch', {
    BlockType: {COMMAND: 'command', REPORTER: 'reporter', BOOLEAN: 'boolean'},
    ArgumentType: {STRING: 'string'},
    Cast: {
      toString: (value: unknown) => String(value),
      toNumber: (value: unknown) => Number(value),
      toBoolean: (value: unknown) => Boolean(value)
    },
    translate: (
      message: string | {default: string},
      placeholders: Record<string, string | number> = {}
    ) => {
      const text = typeof message === 'string' ? message : message.default;
      return Object.entries(placeholders).reduce(
        (result, [name, value]) => result.replace(`{${name}}`, String(value)),
        text
      );
    }
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('TurboWarpHttpServerExtension', () => {
  it('publishes TurboWarp block metadata from the definitions file', () => {
    const info = new TurboWarpHttpServerExtension().getInfo() as {
      id: string;
      name: string;
      blocks: Array<{opcode: string; blockType: string; text: string}>;
      docsURI: string;
      blockIconURI: string;
    };

    expect(info.id).toBe('kubohiroyaturbowarphttpserver');
    expect(info.name).toBe('TurboWarp-HTTP-Server');
    expect(info.docsURI).toBe('https://kubohiroya.github.io/turbowarp-http-server/');
    expect(info.blockIconURI).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(info.blocks.map((block) => block.opcode)).toEqual([
      'setServerUrl',
      'connect',
      'disconnect',
      'isConnected',
      'sendText',
      'lastMessage'
    ]);
  });

  it('connects to the configured bridge URL and sends text', () => {
    const extension = new TurboWarpHttpServerExtension();

    extension.setServerUrl({URL: 'ws://localhost:9000/ws'});
    extension.connect();
    extension.sendText({MESSAGE: '{"type":"ping"}'});

    expect(sockets).toHaveLength(1);
    expect(sockets[0]?.url).toBe('ws://localhost:9000/ws');
    expect(sockets[0]?.sent).toEqual(['{"type":"ping"}']);
    expect(extension.isConnected()).toBe(true);
  });

  it('stores the latest bridge message and clears connection state on close', () => {
    const extension = new TurboWarpHttpServerExtension();

    extension.connect();
    sockets[0]?.receive('{"type":"pong"}');
    sockets[0]?.close();

    expect(extension.lastMessage()).toBe('{"type":"pong"}');
    expect(extension.isConnected()).toBe(false);
  });
});
