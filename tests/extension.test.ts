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
    ArgumentType: {STRING: 'string', NUMBER: 'number'},
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
      'lastMessage',
      'recordHttpLog',
      'clearHttpLogs',
      'httpLogViewerHtml',
      'httpLogViewerHtmlFromJson',
      'newMarkdownDocument',
      'markdownHeading',
      'markdownParagraph',
      'markdownBullet',
      'markdownCodeBlock',
      'renderMarkdown',
      'newHtmlElement',
      'htmlText',
      'htmlSetAttribute',
      'htmlAppendChild',
      'renderHtml',
      'renderHtmlDocument'
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

  it('builds Markdown text with chainable handles', () => {
    const extension = new TurboWarpHttpServerExtension();
    const doc = extension.newMarkdownDocument();

    extension.markdownHeading({DOC: doc, LEVEL: 2, TEXT: 'HTTP *Logs*'});
    extension.markdownParagraph({DOC: doc, TEXT: 'Use <stable> response text.'});
    extension.markdownBullet({DOC: doc, TEXT: 'GET /@assets/live-camera'});
    extension.markdownCodeBlock({DOC: doc, CODE: 'status = 200', LANG: 'js'});

    expect(extension.renderMarkdown({DOC: doc})).toBe(
      '## HTTP \\*Logs\\*\n\nUse <stable> response text.\n\n- GET /@assets/live-camera\n\n```js\nstatus = 200\n```'
    );
  });

  it('builds escaped HTML fragments and documents with element handles', () => {
    const extension = new TurboWarpHttpServerExtension();
    const section = extension.newHtmlElement({TAG: 'section'});
    const heading = extension.newHtmlElement({TAG: 'h1'});
    const text = extension.htmlText({TEXT: '<Live & Logs>'});

    extension.htmlAppendChild({PARENT: heading, CHILD: text});
    extension.htmlSetAttribute({NODE: section, NAME: 'class', VALUE: 'panel'});
    extension.htmlSetAttribute({NODE: section, NAME: 'onclick', VALUE: 'alert(1)'});
    extension.htmlAppendChild({PARENT: section, CHILD: heading});

    expect(extension.renderHtml({NODE: section})).toBe(
      '<section class="panel"><h1>&lt;Live &amp; Logs&gt;</h1></section>'
    );
    expect(extension.renderHtmlDocument({TITLE: '<Dashboard>', BODY: section})).toContain(
      '<title>&lt;Dashboard&gt;</title>'
    );
  });

  it('prevents cyclic HTML builder trees', () => {
    const extension = new TurboWarpHttpServerExtension();
    const parent = extension.newHtmlElement({TAG: 'div'});
    const child = extension.newHtmlElement({TAG: 'span'});

    extension.htmlAppendChild({PARENT: parent, CHILD: child});
    extension.htmlAppendChild({PARENT: child, CHILD: parent});
    extension.htmlAppendChild({PARENT: parent, CHILD: parent});

    expect(extension.renderHtml({NODE: parent})).toBe('<div><span></span></div>');
  });

  it('rejects unsafe URL attributes in HTML builder output', () => {
    const extension = new TurboWarpHttpServerExtension();
    const link = extension.newHtmlElement({TAG: 'a'});
    const image = extension.newHtmlElement({TAG: 'img'});

    extension.htmlSetAttribute({NODE: link, NAME: 'href', VALUE: 'javascript:alert(1)'});
    extension.htmlSetAttribute({NODE: link, NAME: 'data-id', VALUE: '42'});
    extension.htmlSetAttribute({NODE: image, NAME: 'src', VALUE: 'https://example.com/image.jpg'});

    expect(extension.renderHtml({NODE: link})).toBe('<a data-id="42"></a>');
    expect(extension.renderHtml({NODE: image})).toBe('<img src="https://example.com/image.jpg">');
  });

  it('renders a self-contained virtual-scroll HTTP log viewer', () => {
    const extension = new TurboWarpHttpServerExtension();

    extension.recordHttpLog({ENTRY: '{"method":"GET","path":"/camera","status":200}'});
    const html = extension.httpLogViewerHtml();
    const htmlFromJson = extension.httpLogViewerHtmlFromJson({
      LOGS: '[{"method":"PUT","path":"/@assets/live-camera","status":204}]'
    });

    expect(html).toContain('HTTP logs');
    expect(html).toContain('viewport');
    expect(html).toContain('translateY');
    expect(html).toContain('/camera');
    expect(htmlFromJson).toContain('/@assets/live-camera');

    extension.clearHttpLogs();
    expect(extension.httpLogViewerHtml()).toContain('logs.length');
  });
});
