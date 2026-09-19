import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {TurboWarpHttpServerExtension} from '../src/extension.js';
import type {BridgeRequestMessage} from '../src/protocol.js';

const sockets: FakeWebSocket[] = [];
const startHats = vi.fn(() => []);

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
  startHats.mockClear();
  vi.stubGlobal('WebSocket', FakeWebSocket);
  vi.stubGlobal('Scratch', {
    vm: {runtime: {startHats}},
    BlockType: {COMMAND: 'command', REPORTER: 'reporter', BOOLEAN: 'boolean', HAT: 'hat'},
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
      'whenHttpRequestReceived',
      'useHttpRequest',
      'currentRequestId',
      'currentHttpMethod',
      'currentRequestPath',
      'currentRequestUrl',
      'requestHeader',
      'queryParameter',
      'pathParameter',
      'currentRequestBody',
      'currentRequestContentType',
      'currentRequestClientAddress',
      'setHandlerVariable',
      'changeHandlerVariable',
      'handlerVariable',
      'handlerVariableExists',
      'deleteHandlerVariable',
      'clearHandlerVariables',
      'listHandlerVariables',
      'currentResponseStatus',
      'setHttpStatus',
      'setResponseHeader',
      'removeResponseHeader',
      'responseHeader',
      'setResponseBody',
      'sendResponse',
      'respondWithText',
      'respondWithHtml',
      'respondWithJson',
      'respondWithNamedBody',
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

  it('starts the HTTP request hat when a bridge request arrives', () => {
    const extension = new TurboWarpHttpServerExtension();

    extension.connect();
    sockets[0]?.receive(JSON.stringify(requestMessage({id: 'req-hat'})));

    expect(startHats).toHaveBeenCalledWith(
      'kubohiroyaturbowarphttpserver_whenHttpRequestReceived'
    );
    expect(extension.currentRequestId()).toBe('req-hat');
  });

  it('returns safe defaults outside a request context', () => {
    const extension = new TurboWarpHttpServerExtension();

    expect(extension.currentRequestId()).toBe('');
    expect(extension.currentHttpMethod()).toBe('');
    expect(extension.currentRequestPath()).toBe('');
    expect(extension.requestHeader({NAME: 'authorization'})).toBe('');
    expect(extension.queryParameter({NAME: 'q'})).toBe('');
    expect(extension.pathParameter({NAME: 'id'})).toBe('');
    expect(extension.currentRequestBody()).toBe('');
    expect(extension.currentResponseStatus()).toBe(200);
  });

  it('exposes current request reporters from the selected request context', () => {
    const extension = new TurboWarpHttpServerExtension();
    extension.receiveBridgeRequestForTest(
      requestMessage({
        id: 'req-1',
        method: 'POST',
        path: '/users/42',
        route: '/users/:id',
        pathParams: {id: '42'},
        query: {tag: ['a', 'b']},
        headers: {'Content-Type': ['application/json'], 'x-test': ['one']},
        body: {kind: 'text', text: '{"ok":true}'},
        clientAddress: '127.0.0.1'
      })
    );

    expect(extension.currentRequestId()).toBe('req-1');
    expect(extension.currentHttpMethod()).toBe('POST');
    expect(extension.currentRequestPath()).toBe('/users/42');
    expect(extension.currentRequestUrl()).toBe('http://example.test/users/42?tag=a&tag=b');
    expect(extension.requestHeader({NAME: 'content-type'})).toBe('application/json');
    expect(extension.requestHeader({NAME: 'X-Test'})).toBe('one');
    expect(extension.queryParameter({NAME: 'tag'})).toBe('a');
    expect(extension.pathParameter({NAME: 'id'})).toBe('42');
    expect(extension.currentRequestBody()).toBe('{"ok":true}');
    expect(extension.currentRequestContentType()).toBe('application/json');
    expect(extension.currentRequestClientAddress()).toBe('127.0.0.1');
  });

  it('builds and sends responses once for the current request', () => {
    const extension = new TurboWarpHttpServerExtension();

    extension.connect();
    sockets[0]?.receive(JSON.stringify(requestMessage({id: 'req-1'})));
    extension.setHttpStatus({STATUS: 201});
    extension.setResponseHeader({NAME: 'X-Reply', VALUE: 'ok'});
    extension.setResponseHeader({NAME: 'Bad', VALUE: 'line\nbreak'});
    extension.setResponseBody({BODY: 'first'});

    expect(extension.currentResponseStatus()).toBe(201);
    expect(extension.responseHeader({NAME: 'x-reply'})).toBe('ok');

    extension.sendResponse({BODY: 'done'});
    extension.setHttpStatus({STATUS: 500});
    extension.sendResponse({BODY: 'again'});

    expect(sockets[0]?.sent.slice(-1)).toEqual([
      JSON.stringify({
        type: 'response',
        id: 'req-1',
        status: 201,
        headers: {'x-reply': ['ok']},
        body: {kind: 'text', text: 'done'}
      })
    ]);
    expect(extension.currentRequestId()).toBe('');
  });

  it('keeps multiple request contexts isolated until response completion', () => {
    const extension = new TurboWarpHttpServerExtension();
    extension.receiveBridgeRequestForTest(requestMessage({id: 'req-a', pathParams: {id: 'a'}}));
    extension.receiveBridgeRequestForTest(requestMessage({id: 'req-b', pathParams: {id: 'b'}}));

    expect(extension.pathParameter({NAME: 'id'})).toBe('b');

    extension.useHttpRequest({ID: 'req-a'});
    expect(extension.pathParameter({NAME: 'id'})).toBe('a');
    extension.setHttpStatus({STATUS: 202});
    extension.setHandlerVariable({NAME: 'count', VALUE: '2'});
    extension.changeHandlerVariable({NAME: 'count', AMOUNT: 3});
    expect(extension.handlerVariable({NAME: 'count'})).toBe(5);
    expect(extension.handlerVariableExists({NAME: 'count'})).toBe(true);
    expect(extension.listHandlerVariables()).toBe('count');

    extension.useHttpRequest({ID: 'req-b'});
    expect(extension.currentResponseStatus()).toBe(200);
    expect(extension.pathParameter({NAME: 'id'})).toBe('b');
    expect(extension.handlerVariable({NAME: 'count'})).toBe('');
    expect(extension.handlerVariableExists({NAME: 'count'})).toBe(false);

    extension.useHttpRequest({ID: 'req-a'});
    extension.deleteHandlerVariable({NAME: 'count'});
    expect(extension.handlerVariableExists({NAME: 'count'})).toBe(false);
    extension.setHandlerVariable({NAME: 'one', VALUE: '1'});
    extension.clearHandlerVariables();
    expect(extension.listHandlerVariables()).toBe('');
  });

  it('sets convenience response content types', () => {
    const extension = new TurboWarpHttpServerExtension();

    extension.connect();
    sockets[0]?.receive(JSON.stringify(requestMessage({id: 'req-json'})));
    extension.respondWithJson({BODY: '{"ok":true}'});

    expect(sockets[0]?.sent.slice(-1)).toEqual([
      JSON.stringify({
        type: 'response',
        id: 'req-json',
        status: 200,
        headers: {'content-type': ['application/json; charset=utf-8']},
        body: {kind: 'text', text: '{"ok":true}'}
      })
    ]);
  });

  it('sends only a named descriptor for server-side body resolution', () => {
    const extension = new TurboWarpHttpServerExtension();
    extension.connect();
    sockets[0]?.receive(JSON.stringify(requestMessage({id: 'req-named'})));

    extension.respondWithNamedBody({
      NAMESPACE: 'asset',
      NAME: 'avatar',
      KIND: 'asset',
      SCOPE: 'project',
      TARGET_ID: 'ignored',
      REPRESENTATION: 'raw',
      MAX_BYTES: 1024
    });

    const sent = sockets[0]!.sent;
    expect(JSON.parse(sent[sent.length - 1]!)).toEqual({
      type: 'response',
      id: 'req-named',
      status: 200,
      headers: {},
      body: {
        kind: 'named',
        reference: {
          namespace: 'asset',
          name: 'avatar',
          kind: 'asset',
          scope: 'project'
        },
        representation: 'raw',
        maxBytes: 1024
      }
    });
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
    const button = extension.newHtmlElement({TAG: 'button'});

    extension.htmlSetAttribute({NODE: link, NAME: 'href', VALUE: 'javascript:alert(1)'});
    extension.htmlSetAttribute({NODE: link, NAME: 'data-id', VALUE: '42'});
    extension.htmlSetAttribute({NODE: image, NAME: 'src', VALUE: 'https://example.com/image.jpg'});
    extension.htmlSetAttribute({NODE: image, NAME: 'srcset', VALUE: 'javascript:alert(1) 1x'});
    extension.htmlSetAttribute({NODE: button, NAME: 'formaction', VALUE: 'java\nscript:alert(1)'});

    expect(extension.renderHtml({NODE: link})).toBe('<a data-id="42"></a>');
    expect(extension.renderHtml({NODE: image})).toBe('<img src="https://example.com/image.jpg">');
    expect(extension.renderHtml({NODE: button})).toBe('<button></button>');
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

function requestMessage(overrides: Partial<BridgeRequestMessage> = {}): BridgeRequestMessage {
  const path = overrides.path ?? '/users/42';
  return {
    type: 'request',
    protocol: 'turbowarp-http-server',
    version: 1,
    id: 'req-1',
    method: 'GET',
    url: `http://example.test${path}?tag=a&tag=b`,
    path,
    route: '/users/:id',
    pathParams: {id: '42'},
    query: {tag: ['a', 'b']},
    headers: {},
    body: {kind: 'empty'},
    clientAddress: '',
    ...overrides
  };
}
