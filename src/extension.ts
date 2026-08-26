import {extensionConfig} from './config';
import definitions from './block-definitions.json';
import {
  firstValue,
  isForbiddenResponseHeader,
  isValidHttpStatus,
  normalizeHeaderName,
  validateHeaderName,
  validateHeaderValue
} from './protocol';
import type {BridgeBody, BridgeRequestMessage, BridgeResponseMessage} from './protocol';

type BlockTypeName = 'COMMAND' | 'REPORTER' | 'BOOLEAN' | 'HAT';
type ArgumentTypeName = 'STRING' | 'NUMBER';

interface DefinitionArgument {
  type: ArgumentTypeName;
  defaultValue: string | number;
}

interface BlockDefinition {
  opcode: string;
  blockType: BlockTypeName;
  text: string;
  description: string;
  arguments: Record<string, DefinitionArgument>;
}

const blockDefinitions = definitions.blocks as readonly BlockDefinition[];
const DEFAULT_SERVER_URL = 'ws://127.0.0.1:8787/ws';
const ALLOWED_HTML_TAGS = new Set([
  'a',
  'article',
  'body',
  'button',
  'code',
  'dd',
  'div',
  'dl',
  'dt',
  'em',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'img',
  'input',
  'label',
  'li',
  'main',
  'ol',
  'p',
  'pre',
  'section',
  'span',
  'strong',
  'table',
  'tbody',
  'td',
  'textarea',
  'th',
  'thead',
  'tr',
  'ul'
]);
const VOID_HTML_TAGS = new Set(['img', 'input']);
const VALID_ATTRIBUTE = /^[a-zA-Z_:][a-zA-Z0-9:_.-]*$/;
const VALID_MARKDOWN_LANGUAGE = /^[a-zA-Z0-9_+.-]*$/;
const HTTP_REQUEST_HAT_OPCODE = `${extensionConfig.id}_whenHttpRequestReceived`;
const URL_ATTRIBUTES = new Set(['action', 'cite', 'formaction', 'href', 'poster', 'src', 'xlink:href']);
const URL_LIST_ATTRIBUTES = new Set(['srcset']);
const SAFE_URL_SCHEMES = new Set(['http', 'https', 'mailto', 'tel']);

type HtmlNode = HtmlElementNode | HtmlTextNode;

interface HtmlElementNode {
  kind: 'element';
  tag: string;
  attributes: Record<string, string>;
  children: string[];
}

interface HtmlTextNode {
  kind: 'text';
  text: string;
}

interface ResponseBuilder {
  status: number;
  headers: Record<string, string[]>;
  body: BridgeBody;
  completed: boolean;
}

interface RequestContext {
  request: BridgeRequestMessage;
  response: ResponseBuilder;
}

export class TurboWarpHttpServerExtension implements TurboWarpExtension {
  private serverUrl = DEFAULT_SERVER_URL;
  private socket: WebSocket | null = null;
  private lastReceivedMessage = '';
  private nextHandleId = 1;
  private readonly httpLogs: unknown[] = [];
  private readonly markdownBuilders = new Map<string, string[]>();
  private readonly htmlNodes = new Map<string, HtmlNode>();
  private readonly requestContexts = new Map<string, RequestContext>();
  private currentRequestContextId = '';

  public getInfo(): Record<string, unknown> {
    return {
      id: extensionConfig.id,
      name: Scratch.translate(definitions.extensionName),
      docsURI: extensionConfig.docsURI,
      blockIconURI: extensionConfig.blockIconURI,
      blocks: blockDefinitions.map((block) => this.toScratchBlock(block))
    };
  }

  public setServerUrl(args: {URL: unknown}): void {
    this.serverUrl = Scratch.Cast.toString(args.URL).trim() || DEFAULT_SERVER_URL;
  }

  public connect(): void {
    if (this.isConnected()) return;

    this.socket?.close();
    const socket = new WebSocket(this.serverUrl);
    this.socket = socket;

    socket.addEventListener('message', (event) => {
      this.lastReceivedMessage = this.stringifyMessage(event.data);
      this.recordLogMessage(this.lastReceivedMessage);
      this.receiveBridgeMessage(this.lastReceivedMessage);
    });
    socket.addEventListener('close', () => {
      if (this.socket === socket) this.socket = null;
    });
    socket.addEventListener('error', () => {
      if (this.socket === socket) this.socket = null;
    });
  }

  public disconnect(): void {
    this.socket?.close();
    this.socket = null;
  }

  public isConnected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  public sendText(args: {MESSAGE: unknown}): void {
    if (!this.isConnected() || this.socket === null) return;
    this.socket.send(Scratch.Cast.toString(args.MESSAGE));
  }

  public lastMessage(): string {
    return this.lastReceivedMessage;
  }

  public whenHttpRequestReceived(): boolean {
    return false;
  }

  public useHttpRequest(args: {ID: unknown}): void {
    const id = Scratch.Cast.toString(args.ID);
    if (this.requestContexts.has(id)) this.currentRequestContextId = id;
  }

  public currentRequestId(): string {
    return this.currentContext()?.request.id ?? '';
  }

  public currentHttpMethod(): string {
    return this.currentContext()?.request.method ?? '';
  }

  public currentRequestPath(): string {
    return this.currentContext()?.request.path ?? '';
  }

  public currentRequestUrl(): string {
    return this.currentContext()?.request.url ?? '';
  }

  public requestHeader(args: {NAME: unknown}): string {
    const name = normalizeHeaderName(Scratch.Cast.toString(args.NAME));
    return firstValue(this.currentContext()?.request.headers[name]);
  }

  public queryParameter(args: {NAME: unknown}): string {
    return firstValue(this.currentContext()?.request.query[Scratch.Cast.toString(args.NAME)]);
  }

  public pathParameter(args: {NAME: unknown}): string {
    return this.currentContext()?.request.pathParams[Scratch.Cast.toString(args.NAME)] ?? '';
  }

  public currentRequestBody(): string {
    const body = this.currentContext()?.request.body;
    return body?.kind === 'text' ? body.text : '';
  }

  public currentRequestContentType(): string {
    return this.requestHeader({NAME: 'content-type'});
  }

  public currentRequestClientAddress(): string {
    return this.currentContext()?.request.clientAddress ?? '';
  }

  public currentResponseStatus(): number {
    return this.currentContext()?.response.status ?? 200;
  }

  public setHttpStatus(args: {STATUS: unknown}): void {
    const context = this.mutableCurrentContext();
    if (!context) return;
    const status = Math.trunc(Scratch.Cast.toNumber(args.STATUS));
    if (isValidHttpStatus(status)) context.response.status = status;
  }

  public setResponseHeader(args: {NAME: unknown; VALUE: unknown}): void {
    const context = this.mutableCurrentContext();
    if (!context) return;
    const name = normalizeHeaderName(Scratch.Cast.toString(args.NAME));
    const value = Scratch.Cast.toString(args.VALUE);
    if (
      validateHeaderName(name) &&
      validateHeaderValue(value) &&
      !isForbiddenResponseHeader(name)
    ) {
      context.response.headers[name] = [value];
    }
  }

  public removeResponseHeader(args: {NAME: unknown}): void {
    const context = this.mutableCurrentContext();
    if (!context) return;
    delete context.response.headers[normalizeHeaderName(Scratch.Cast.toString(args.NAME))];
  }

  public responseHeader(args: {NAME: unknown}): string {
    const name = normalizeHeaderName(Scratch.Cast.toString(args.NAME));
    return firstValue(this.currentContext()?.response.headers[name]);
  }

  public setResponseBody(args: {BODY: unknown}): void {
    const context = this.mutableCurrentContext();
    if (!context) return;
    context.response.body = {kind: 'text', text: Scratch.Cast.toString(args.BODY)};
  }

  public sendResponse(args: {BODY: unknown}): void {
    const context = this.mutableCurrentContext();
    if (!context) return;
    context.response.body = {kind: 'text', text: Scratch.Cast.toString(args.BODY)};
    this.completeResponse(context);
  }

  public respondWithText(args: {BODY: unknown}): void {
    this.setResponseHeader({NAME: 'content-type', VALUE: 'text/plain; charset=utf-8'});
    this.sendResponse({BODY: args.BODY});
  }

  public respondWithHtml(args: {BODY: unknown}): void {
    this.setResponseHeader({NAME: 'content-type', VALUE: 'text/html; charset=utf-8'});
    this.sendResponse({BODY: args.BODY});
  }

  public respondWithJson(args: {BODY: unknown}): void {
    this.setResponseHeader({NAME: 'content-type', VALUE: 'application/json; charset=utf-8'});
    this.sendResponse({BODY: args.BODY});
  }

  public receiveBridgeRequestForTest(request: BridgeRequestMessage): void {
    this.acceptBridgeRequest(request);
  }

  public recordHttpLog(args: {ENTRY: unknown}): void {
    this.httpLogs.push(this.parseLogEntry(Scratch.Cast.toString(args.ENTRY)));
  }

  public clearHttpLogs(): void {
    this.httpLogs.length = 0;
  }

  public httpLogViewerHtml(): string {
    return this.renderLogViewer(this.httpLogs);
  }

  public httpLogViewerHtmlFromJson(args: {LOGS: unknown}): string {
    return this.renderLogViewer(this.parseLogArray(Scratch.Cast.toString(args.LOGS)));
  }

  public newMarkdownDocument(): string {
    const handle = this.nextHandle('md');
    this.markdownBuilders.set(handle, []);
    return handle;
  }

  public markdownHeading(args: {DOC: unknown; LEVEL: unknown; TEXT: unknown}): string {
    const handle = this.ensureMarkdownHandle(args.DOC);
    const level = Math.min(6, Math.max(1, Math.trunc(Scratch.Cast.toNumber(args.LEVEL))));
    this.markdownBuilders.get(handle)?.push(`${'#'.repeat(level)} ${escapeMarkdownLine(Scratch.Cast.toString(args.TEXT))}`);
    return handle;
  }

  public markdownParagraph(args: {DOC: unknown; TEXT: unknown}): string {
    const handle = this.ensureMarkdownHandle(args.DOC);
    this.markdownBuilders.get(handle)?.push(escapeMarkdownParagraph(Scratch.Cast.toString(args.TEXT)));
    return handle;
  }

  public markdownBullet(args: {DOC: unknown; TEXT: unknown}): string {
    const handle = this.ensureMarkdownHandle(args.DOC);
    this.markdownBuilders.get(handle)?.push(`- ${escapeMarkdownLine(Scratch.Cast.toString(args.TEXT))}`);
    return handle;
  }

  public markdownCodeBlock(args: {DOC: unknown; CODE: unknown; LANG: unknown}): string {
    const handle = this.ensureMarkdownHandle(args.DOC);
    const language = Scratch.Cast.toString(args.LANG).trim();
    const safeLanguage = VALID_MARKDOWN_LANGUAGE.test(language) ? language : '';
    const code = Scratch.Cast.toString(args.CODE).replace(/```/g, '`\\`\\`');
    this.markdownBuilders.get(handle)?.push(`\`\`\`${safeLanguage}\n${code}\n\`\`\``);
    return handle;
  }

  public renderMarkdown(args: {DOC: unknown}): string {
    return this.markdownBuilders.get(Scratch.Cast.toString(args.DOC))?.join('\n\n') ?? '';
  }

  public newHtmlElement(args: {TAG: unknown}): string {
    const tag = normalizeHtmlTag(Scratch.Cast.toString(args.TAG));
    const handle = this.nextHandle('html');
    this.htmlNodes.set(handle, {kind: 'element', tag, attributes: {}, children: []});
    return handle;
  }

  public htmlText(args: {TEXT: unknown}): string {
    const handle = this.nextHandle('html');
    this.htmlNodes.set(handle, {kind: 'text', text: Scratch.Cast.toString(args.TEXT)});
    return handle;
  }

  public htmlSetAttribute(args: {NODE: unknown; NAME: unknown; VALUE: unknown}): string {
    const handle = this.ensureHtmlElementHandle(args.NODE);
    const node = this.htmlNodes.get(handle);
    const name = Scratch.Cast.toString(args.NAME).trim();
    const normalizedName = name.toLowerCase();
    const value = Scratch.Cast.toString(args.VALUE);
    if (
      node?.kind === 'element' &&
      VALID_ATTRIBUTE.test(name) &&
      !normalizedName.startsWith('on') &&
      isSafeAttributeValue(normalizedName, value)
    ) {
      node.attributes[name] = value;
    }
    return handle;
  }

  public htmlAppendChild(args: {PARENT: unknown; CHILD: unknown}): string {
    const parentHandle = this.ensureHtmlElementHandle(args.PARENT);
    const childHandle = Scratch.Cast.toString(args.CHILD);
    const parent = this.htmlNodes.get(parentHandle);
    if (
      parent?.kind === 'element' &&
      this.htmlNodes.has(childHandle) &&
      parentHandle !== childHandle &&
      !this.hasHtmlDescendant(childHandle, parentHandle, new Set())
    ) {
      parent.children.push(childHandle);
    }
    return parentHandle;
  }

  public renderHtml(args: {NODE: unknown}): string {
    return this.renderHtmlNode(Scratch.Cast.toString(args.NODE), new Set());
  }

  public renderHtmlDocument(args: {TITLE: unknown; BODY: unknown}): string {
    const title = escapeHtml(Scratch.Cast.toString(args.TITLE));
    return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${this.renderHtmlNode(
      Scratch.Cast.toString(args.BODY),
      new Set()
    )}</body></html>`;
  }

  private stringifyMessage(message: unknown): string {
    if (typeof message === 'string') return message;
    if (message instanceof ArrayBuffer) return new TextDecoder().decode(message);
    return String(message);
  }

  private receiveBridgeMessage(message: string): void {
    try {
      const parsed = JSON.parse(message) as Partial<BridgeRequestMessage>;
      if (parsed.type === 'request' && typeof parsed.id === 'string') {
        this.acceptBridgeRequest(parsed as BridgeRequestMessage);
      }
    } catch {
      return;
    }
  }

  private acceptBridgeRequest(request: BridgeRequestMessage): void {
    this.requestContexts.set(request.id, {
      request: {
        ...request,
        headers: normalizeHeaderRecord(request.headers),
        query: normalizeValueRecord(request.query),
        pathParams: normalizePathParams(request.pathParams)
      },
      response: {
        status: 200,
        headers: {},
        body: {kind: 'empty'},
        completed: false
      }
    });
    this.currentRequestContextId = request.id;
    this.startRequestHat();
  }

  private currentContext(): RequestContext | undefined {
    return this.requestContexts.get(this.currentRequestContextId);
  }

  private mutableCurrentContext(): RequestContext | undefined {
    const context = this.currentContext();
    return context && !context.response.completed ? context : undefined;
  }

  private completeResponse(context: RequestContext): void {
    if (context.response.completed) return;
    context.response.completed = true;
    const message: BridgeResponseMessage = {
      type: 'response',
      id: context.request.id,
      status: context.response.status,
      headers: context.response.headers,
      body: context.response.body
    };
    this.socket?.send(JSON.stringify(message));
    this.requestContexts.delete(context.request.id);
    if (this.currentRequestContextId === context.request.id) this.currentRequestContextId = '';
  }

  private recordLogMessage(message: string): void {
    const parsed = this.parseLogEntry(message);
    if (isLogLike(parsed)) this.httpLogs.push(parsed);
  }

  private startRequestHat(): void {
    Scratch.vm?.runtime?.startHats?.(HTTP_REQUEST_HAT_OPCODE);
  }

  private parseLogEntry(value: string): unknown {
    try {
      return JSON.parse(value);
    } catch {
      return {message: value};
    }
  }

  private parseLogArray(value: string): unknown[] {
    const parsed = this.parseLogEntry(value);
    return Array.isArray(parsed) ? parsed : [parsed];
  }

  private renderLogViewer(logs: readonly unknown[]): string {
    const data = JSON.stringify(logs).replace(/</g, '\\u003c');
    return `<!doctype html><html><head><meta charset="utf-8"><title>HTTP Logs</title><style>
body{margin:0;font:13px ui-monospace,SFMono-Regular,Menlo,monospace;background:#0f172a;color:#e5e7eb}
header{height:44px;display:flex;align-items:center;padding:0 16px;background:#111827;border-bottom:1px solid #334155}
#viewport{height:calc(100vh - 45px);overflow:auto;position:relative}
#spacer{width:1px}.row{position:absolute;left:0;right:0;height:32px;display:grid;grid-template-columns:72px 84px 1fr;gap:10px;align-items:center;padding:0 12px;border-bottom:1px solid #1f2937;box-sizing:border-box;white-space:nowrap}
.status{color:#93c5fd}.method{color:#86efac}.path{overflow:hidden;text-overflow:ellipsis}
</style></head><body><header>HTTP logs <span id="count"></span></header><div id="viewport"><div id="spacer"></div><div id="rows"></div></div><script>
const logs=${data};const rowHeight=32;const viewport=document.getElementById('viewport');const spacer=document.getElementById('spacer');const rows=document.getElementById('rows');document.getElementById('count').textContent='('+logs.length+')';spacer.style.height=(logs.length*rowHeight)+'px';
function text(v){return v==null?'':String(v)}function render(){const top=viewport.scrollTop;const first=Math.max(0,Math.floor(top/rowHeight)-8);const visible=Math.ceil(viewport.clientHeight/rowHeight)+16;const last=Math.min(logs.length,first+visible);let html='';for(let i=first;i<last;i++){const log=logs[i]||{};const method=text(log.method||log.event||'LOG');const status=text(log.status||'');const path=text(log.path||log.resourceName||log.message||JSON.stringify(log));html+='<div class="row" style="transform:translateY('+(i*rowHeight)+'px)"><span class="method">'+escapeHtml(method)+'</span><span class="status">'+escapeHtml(status)+'</span><span class="path">'+escapeHtml(path)+'</span></div>'}rows.innerHTML=html}
function escapeHtml(value){return value.replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]))}viewport.addEventListener('scroll',render);render();
</script></body></html>`;
  }

  private ensureMarkdownHandle(value: unknown): string {
    const handle = Scratch.Cast.toString(value);
    if (this.markdownBuilders.has(handle)) return handle;
    const next = this.newMarkdownDocument();
    return next;
  }

  private ensureHtmlElementHandle(value: unknown): string {
    const handle = Scratch.Cast.toString(value);
    const node = this.htmlNodes.get(handle);
    if (node?.kind === 'element') return handle;
    return this.newHtmlElement({TAG: 'div'});
  }

  private renderHtmlNode(handle: string, visiting: Set<string>): string {
    if (visiting.has(handle)) return '';
    const node = this.htmlNodes.get(handle);
    if (!node) return '';
    if (node.kind === 'text') return escapeHtml(node.text);
    visiting.add(handle);
    const attributes = Object.entries(node.attributes)
      .map(([name, value]) => ` ${name}="${escapeHtml(value)}"`)
      .join('');
    if (VOID_HTML_TAGS.has(node.tag)) {
      visiting.delete(handle);
      return `<${node.tag}${attributes}>`;
    }
    const children = node.children.map((child) => this.renderHtmlNode(child, visiting)).join('');
    visiting.delete(handle);
    return `<${node.tag}${attributes}>${children}</${node.tag}>`;
  }

  private hasHtmlDescendant(handle: string, targetHandle: string, visited: Set<string>): boolean {
    if (visited.has(handle)) return false;
    visited.add(handle);
    const node = this.htmlNodes.get(handle);
    if (node?.kind !== 'element') return false;
    return node.children.some(
      (child) => child === targetHandle || this.hasHtmlDescendant(child, targetHandle, visited)
    );
  }

  private nextHandle(prefix: 'md' | 'html'): string {
    const handle = `${prefix}:${this.nextHandleId}`;
    this.nextHandleId += 1;
    return handle;
  }

  private toScratchBlock(block: BlockDefinition): Record<string, unknown> {
    return {
      opcode: block.opcode,
      blockType: Scratch.BlockType[block.blockType],
      text: Scratch.translate(block.text),
      arguments: Object.fromEntries(
        Object.entries(block.arguments).map(([name, argument]) => [
          name,
          {
            type: Scratch.ArgumentType[argument.type],
            defaultValue: argument.defaultValue
          }
        ])
      )
    };
  }
}

function isLogLike(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeHeaderRecord(headers: Record<string, string[]>): Record<string, string[]> {
  const normalized: Record<string, string[]> = {};
  for (const [name, values] of Object.entries(headers ?? {})) {
    normalized[normalizeHeaderName(name)] = values.map((value) => String(value));
  }
  return normalized;
}

function normalizeValueRecord(values: Record<string, string[]>): Record<string, string[]> {
  const normalized: Record<string, string[]> = {};
  for (const [name, items] of Object.entries(values ?? {})) {
    normalized[name] = items.map((value) => String(value));
  }
  return normalized;
}

function normalizePathParams(values: Record<string, string>): Record<string, string> {
  const normalized: Record<string, string> = {};
  for (const [name, value] of Object.entries(values ?? {})) {
    normalized[name] = String(value);
  }
  return normalized;
}

function escapeMarkdownLine(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/([`*_#[\]])/g, '\\$1').replace(/\r?\n/g, ' ');
}

function escapeMarkdownParagraph(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/([`*_#[\]])/g, '\\$1');
}

function normalizeHtmlTag(value: string): string {
  const tag = value.trim().toLowerCase();
  return ALLOWED_HTML_TAGS.has(tag) ? tag : 'div';
}

function isSafeAttributeValue(name: string, value: string): boolean {
  if (URL_LIST_ATTRIBUTES.has(name)) return isSafeUrlList(value);
  if (URL_ATTRIBUTES.has(name)) return isSafeUrl(value);
  return true;
}

function isSafeUrlList(value: string): boolean {
  return value
    .split(',')
    .map((candidate) => candidate.trim().split(/\s+/, 1)[0] ?? '')
    .every((url) => isSafeUrl(url));
}

function isSafeUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  const normalized = stripUrlSchemeSeparators(trimmed);
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(normalized)?.[1]?.toLowerCase();
  return scheme === undefined || SAFE_URL_SCHEMES.has(scheme);
}

function stripUrlSchemeSeparators(value: string): string {
  let result = '';
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 0x1f || code === 0x7f || /\s/.test(character)) continue;
    result += character;
  }
  return result;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    if (character === '&') return '&amp;';
    if (character === '<') return '&lt;';
    if (character === '>') return '&gt;';
    if (character === '"') return '&quot;';
    return '&#39;';
  });
}
