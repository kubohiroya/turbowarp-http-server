// Name: TurboWarp-HTTP-Server
// ID: kubohiroyaturbowarphttpserver
// Description: Connect TurboWarp blocks to an HTTP bridge server over WebSocket.
// By: Hiroya Kubo
// License: MPL-2.0

(function (Scratch) {
  'use strict';

  const extensionConfig = {
    id: "kubohiroyaturbowarphttpserver",
    docsURI: "https://kubohiroya.github.io/turbowarp-http-server/",
    blockIconURI: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMDAvc3ZnIiB2aWV3Qm94PSIwIDAgNDggNDgiPjxyZWN0IHg9IjYiIHk9IjEwIiB3aWR0aD0iMzYiIGhlaWdodD0iMjgiIHJ4PSI0IiBmaWxsPSIjMjU2M0VCIi8+PHBhdGggZD0iTTEyIDE4aDI0TTExIDI0aDE0TTExIDMwaDIwIiBzdHJva2U9IiNGRkYiIHN0cm9rZS13aWR0aD0iMyIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIi8+PGNpcmNsZSBjeD0iMzQiIGN5PSIzMCIgcj0iMyIgZmlsbD0iIzIyQzU1RSIvPjwvc3ZnPg=="
  };
  const extensionName = "TurboWarp-HTTP-Server";
  const blocks = [{ "opcode": "setServerUrl", "blockType": "COMMAND", "text": "set HTTP bridge URL to [URL]", "description": "Sets the WebSocket URL used to reach the HTTP bridge server.", "arguments": { "URL": { "type": "STRING", "defaultValue": "ws://127.0.0.1:8787/ws" } } }, { "opcode": "connect", "blockType": "COMMAND", "text": "connect to HTTP bridge", "description": "Opens a WebSocket connection to the configured HTTP bridge server.", "arguments": {} }, { "opcode": "disconnect", "blockType": "COMMAND", "text": "disconnect from HTTP bridge", "description": "Closes the current bridge connection.", "arguments": {} }, { "opcode": "isConnected", "blockType": "BOOLEAN", "text": "HTTP bridge connected?", "description": "Reports whether the bridge WebSocket is currently open.", "arguments": {} }, { "opcode": "sendText", "blockType": "COMMAND", "text": "send [MESSAGE] to HTTP bridge", "description": "Sends a text message to the connected HTTP bridge server.", "arguments": { "MESSAGE": { "type": "STRING", "defaultValue": '{"type":"ping"}' } } }, { "opcode": "lastMessage", "blockType": "REPORTER", "text": "last HTTP bridge message", "description": "Returns the most recent text message received from the bridge.", "arguments": {} }, { "opcode": "recordHttpLog", "blockType": "COMMAND", "text": "record HTTP log [ENTRY]", "description": "Adds a structured HTTP log entry JSON string to the extension log buffer.", "arguments": { "ENTRY": { "type": "STRING", "defaultValue": '{"method":"GET","path":"/","status":200}' } } }, { "opcode": "clearHttpLogs", "blockType": "COMMAND", "text": "clear HTTP logs", "description": "Clears the extension log buffer.", "arguments": {} }, { "opcode": "httpLogViewerHtml", "blockType": "REPORTER", "text": "HTTP log viewer HTML", "description": "Returns a self-contained virtual-scroll HTML log viewer for buffered HTTP logs.", "arguments": {} }, { "opcode": "httpLogViewerHtmlFromJson", "blockType": "REPORTER", "text": "HTTP log viewer HTML from [LOGS]", "description": "Returns a self-contained virtual-scroll HTML log viewer from a JSON array of log entries.", "arguments": { "LOGS": { "type": "STRING", "defaultValue": '[{"method":"GET","path":"/","status":200}]' } } }, { "opcode": "newMarkdownDocument", "blockType": "REPORTER", "text": "new markdown document", "description": "Creates an empty Markdown builder handle.", "arguments": {} }, { "opcode": "markdownHeading", "blockType": "REPORTER", "text": "markdown [DOC] with heading level [LEVEL] [TEXT]", "description": "Appends a Markdown heading and returns the same builder handle.", "arguments": { "DOC": { "type": "STRING", "defaultValue": "md:1" }, "LEVEL": { "type": "NUMBER", "defaultValue": 1 }, "TEXT": { "type": "STRING", "defaultValue": "Title" } } }, { "opcode": "markdownParagraph", "blockType": "REPORTER", "text": "markdown [DOC] with paragraph [TEXT]", "description": "Appends a Markdown paragraph and returns the same builder handle.", "arguments": { "DOC": { "type": "STRING", "defaultValue": "md:1" }, "TEXT": { "type": "STRING", "defaultValue": "Hello" } } }, { "opcode": "markdownBullet", "blockType": "REPORTER", "text": "markdown [DOC] with bullet [TEXT]", "description": "Appends a Markdown bullet and returns the same builder handle.", "arguments": { "DOC": { "type": "STRING", "defaultValue": "md:1" }, "TEXT": { "type": "STRING", "defaultValue": "Item" } } }, { "opcode": "markdownCodeBlock", "blockType": "REPORTER", "text": "markdown [DOC] with code [CODE] language [LANG]", "description": "Appends a fenced Markdown code block and returns the same builder handle.", "arguments": { "DOC": { "type": "STRING", "defaultValue": "md:1" }, "CODE": { "type": "STRING", "defaultValue": "console.log('hello')" }, "LANG": { "type": "STRING", "defaultValue": "js" } } }, { "opcode": "renderMarkdown", "blockType": "REPORTER", "text": "render markdown [DOC]", "description": "Renders a Markdown builder handle to Markdown text.", "arguments": { "DOC": { "type": "STRING", "defaultValue": "md:1" } } }, { "opcode": "newHtmlElement", "blockType": "REPORTER", "text": "new HTML element [TAG]", "description": "Creates an HTML element builder handle.", "arguments": { "TAG": { "type": "STRING", "defaultValue": "div" } } }, { "opcode": "htmlText", "blockType": "REPORTER", "text": "HTML text [TEXT]", "description": "Creates an escaped HTML text node handle.", "arguments": { "TEXT": { "type": "STRING", "defaultValue": "Hello" } } }, { "opcode": "htmlSetAttribute", "blockType": "REPORTER", "text": "HTML [NODE] with attribute [NAME] [VALUE]", "description": "Sets an escaped attribute on an HTML element and returns the same handle.", "arguments": { "NODE": { "type": "STRING", "defaultValue": "html:1" }, "NAME": { "type": "STRING", "defaultValue": "class" }, "VALUE": { "type": "STRING", "defaultValue": "content" } } }, { "opcode": "htmlAppendChild", "blockType": "REPORTER", "text": "HTML [PARENT] with child [CHILD]", "description": "Appends a child node to an HTML element and returns the parent handle.", "arguments": { "PARENT": { "type": "STRING", "defaultValue": "html:1" }, "CHILD": { "type": "STRING", "defaultValue": "html:2" } } }, { "opcode": "renderHtml", "blockType": "REPORTER", "text": "render HTML [NODE]", "description": "Renders an HTML node handle to an HTML fragment.", "arguments": { "NODE": { "type": "STRING", "defaultValue": "html:1" } } }, { "opcode": "renderHtmlDocument", "blockType": "REPORTER", "text": "render HTML document title [TITLE] body [BODY]", "description": "Renders a full HTML document from an HTML body node handle.", "arguments": { "TITLE": { "type": "STRING", "defaultValue": "Page" }, "BODY": { "type": "STRING", "defaultValue": "html:1" } } }];
  const definitions = {
    extensionName,
    blocks
  };
  const blockDefinitions = definitions.blocks;
  const DEFAULT_SERVER_URL = "ws://127.0.0.1:8787/ws";
  const ALLOWED_HTML_TAGS = /* @__PURE__ */ new Set([
    "a",
    "article",
    "body",
    "button",
    "code",
    "dd",
    "div",
    "dl",
    "dt",
    "em",
    "footer",
    "form",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "header",
    "img",
    "input",
    "label",
    "li",
    "main",
    "ol",
    "p",
    "pre",
    "section",
    "span",
    "strong",
    "table",
    "tbody",
    "td",
    "textarea",
    "th",
    "thead",
    "tr",
    "ul"
  ]);
  const VOID_HTML_TAGS = /* @__PURE__ */ new Set(["img", "input"]);
  const VALID_ATTRIBUTE = /^[a-zA-Z_:][a-zA-Z0-9:_.-]*$/;
  const VALID_MARKDOWN_LANGUAGE = /^[a-zA-Z0-9_+.-]*$/;
  class TurboWarpHttpServerExtension {
    constructor() {
      this.serverUrl = DEFAULT_SERVER_URL;
      this.socket = null;
      this.lastReceivedMessage = "";
      this.nextHandleId = 1;
      this.httpLogs = [];
      this.markdownBuilders = /* @__PURE__ */ new Map();
      this.htmlNodes = /* @__PURE__ */ new Map();
    }
    getInfo() {
      return {
        id: extensionConfig.id,
        name: Scratch.translate(definitions.extensionName),
        docsURI: extensionConfig.docsURI,
        blockIconURI: extensionConfig.blockIconURI,
        blocks: blockDefinitions.map((block) => this.toScratchBlock(block))
      };
    }
    setServerUrl(args) {
      this.serverUrl = Scratch.Cast.toString(args.URL).trim() || DEFAULT_SERVER_URL;
    }
    connect() {
      if (this.isConnected()) return;
      this.socket?.close();
      const socket = new WebSocket(this.serverUrl);
      this.socket = socket;
      socket.addEventListener("message", (event) => {
        this.lastReceivedMessage = this.stringifyMessage(event.data);
        this.recordLogMessage(this.lastReceivedMessage);
      });
      socket.addEventListener("close", () => {
        if (this.socket === socket) this.socket = null;
      });
      socket.addEventListener("error", () => {
        if (this.socket === socket) this.socket = null;
      });
    }
    disconnect() {
      this.socket?.close();
      this.socket = null;
    }
    isConnected() {
      return this.socket?.readyState === WebSocket.OPEN;
    }
    sendText(args) {
      if (!this.isConnected() || this.socket === null) return;
      this.socket.send(Scratch.Cast.toString(args.MESSAGE));
    }
    lastMessage() {
      return this.lastReceivedMessage;
    }
    recordHttpLog(args) {
      this.httpLogs.push(this.parseLogEntry(Scratch.Cast.toString(args.ENTRY)));
    }
    clearHttpLogs() {
      this.httpLogs.length = 0;
    }
    httpLogViewerHtml() {
      return this.renderLogViewer(this.httpLogs);
    }
    httpLogViewerHtmlFromJson(args) {
      return this.renderLogViewer(this.parseLogArray(Scratch.Cast.toString(args.LOGS)));
    }
    newMarkdownDocument() {
      const handle = this.nextHandle("md");
      this.markdownBuilders.set(handle, []);
      return handle;
    }
    markdownHeading(args) {
      const handle = this.ensureMarkdownHandle(args.DOC);
      const level = Math.min(6, Math.max(1, Math.trunc(Scratch.Cast.toNumber(args.LEVEL))));
      this.markdownBuilders.get(handle)?.push(`${"#".repeat(level)} ${escapeMarkdownLine(Scratch.Cast.toString(args.TEXT))}`);
      return handle;
    }
    markdownParagraph(args) {
      const handle = this.ensureMarkdownHandle(args.DOC);
      this.markdownBuilders.get(handle)?.push(escapeMarkdownParagraph(Scratch.Cast.toString(args.TEXT)));
      return handle;
    }
    markdownBullet(args) {
      const handle = this.ensureMarkdownHandle(args.DOC);
      this.markdownBuilders.get(handle)?.push(`- ${escapeMarkdownLine(Scratch.Cast.toString(args.TEXT))}`);
      return handle;
    }
    markdownCodeBlock(args) {
      const handle = this.ensureMarkdownHandle(args.DOC);
      const language = Scratch.Cast.toString(args.LANG).trim();
      const safeLanguage = VALID_MARKDOWN_LANGUAGE.test(language) ? language : "";
      const code = Scratch.Cast.toString(args.CODE).replace(/```/g, "`\\`\\`");
      this.markdownBuilders.get(handle)?.push(`\`\`\`${safeLanguage}
  ${code}
  \`\`\``);
      return handle;
    }
    renderMarkdown(args) {
      return this.markdownBuilders.get(Scratch.Cast.toString(args.DOC))?.join("\n\n") ?? "";
    }
    newHtmlElement(args) {
      const tag = normalizeHtmlTag(Scratch.Cast.toString(args.TAG));
      const handle = this.nextHandle("html");
      this.htmlNodes.set(handle, { kind: "element", tag, attributes: {}, children: [] });
      return handle;
    }
    htmlText(args) {
      const handle = this.nextHandle("html");
      this.htmlNodes.set(handle, { kind: "text", text: Scratch.Cast.toString(args.TEXT) });
      return handle;
    }
    htmlSetAttribute(args) {
      const handle = this.ensureHtmlElementHandle(args.NODE);
      const node = this.htmlNodes.get(handle);
      const name = Scratch.Cast.toString(args.NAME).trim();
      if (node?.kind === "element" && VALID_ATTRIBUTE.test(name) && !name.toLowerCase().startsWith("on")) {
        node.attributes[name] = Scratch.Cast.toString(args.VALUE);
      }
      return handle;
    }
    htmlAppendChild(args) {
      const parentHandle = this.ensureHtmlElementHandle(args.PARENT);
      const childHandle = Scratch.Cast.toString(args.CHILD);
      const parent = this.htmlNodes.get(parentHandle);
      if (parent?.kind === "element" && this.htmlNodes.has(childHandle)) {
        parent.children.push(childHandle);
      }
      return parentHandle;
    }
    renderHtml(args) {
      return this.renderHtmlNode(Scratch.Cast.toString(args.NODE));
    }
    renderHtmlDocument(args) {
      const title = escapeHtml(Scratch.Cast.toString(args.TITLE));
      return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${this.renderHtmlNode(
        Scratch.Cast.toString(args.BODY)
      )}</body></html>`;
    }
    stringifyMessage(message) {
      if (typeof message === "string") return message;
      if (message instanceof ArrayBuffer) return new TextDecoder().decode(message);
      return String(message);
    }
    recordLogMessage(message) {
      const parsed = this.parseLogEntry(message);
      if (isLogLike(parsed)) this.httpLogs.push(parsed);
    }
    parseLogEntry(value) {
      try {
        return JSON.parse(value);
      } catch {
        return { message: value };
      }
    }
    parseLogArray(value) {
      const parsed = this.parseLogEntry(value);
      return Array.isArray(parsed) ? parsed : [parsed];
    }
    renderLogViewer(logs) {
      const data = JSON.stringify(logs).replace(/</g, "\\u003c");
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
  <\/script></body></html>`;
    }
    ensureMarkdownHandle(value) {
      const handle = Scratch.Cast.toString(value);
      if (this.markdownBuilders.has(handle)) return handle;
      const next = this.newMarkdownDocument();
      return next;
    }
    ensureHtmlElementHandle(value) {
      const handle = Scratch.Cast.toString(value);
      const node = this.htmlNodes.get(handle);
      if (node?.kind === "element") return handle;
      return this.newHtmlElement({ TAG: "div" });
    }
    renderHtmlNode(handle) {
      const node = this.htmlNodes.get(handle);
      if (!node) return "";
      if (node.kind === "text") return escapeHtml(node.text);
      const attributes = Object.entries(node.attributes).map(([name, value]) => ` ${name}="${escapeHtml(value)}"`).join("");
      if (VOID_HTML_TAGS.has(node.tag)) return `<${node.tag}${attributes}>`;
      return `<${node.tag}${attributes}>${node.children.map((child) => this.renderHtmlNode(child)).join("")}</${node.tag}>`;
    }
    nextHandle(prefix) {
      const handle = `${prefix}:${this.nextHandleId}`;
      this.nextHandleId += 1;
      return handle;
    }
    toScratchBlock(block) {
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
  function isLogLike(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
  function escapeMarkdownLine(value) {
    return value.replace(/\\/g, "\\\\").replace(/([`*_#[\]])/g, "\\$1").replace(/\r?\n/g, " ");
  }
  function escapeMarkdownParagraph(value) {
    return value.replace(/\\/g, "\\\\").replace(/([`*_#[\]])/g, "\\$1");
  }
  function normalizeHtmlTag(value) {
    const tag = value.trim().toLowerCase();
    return ALLOWED_HTML_TAGS.has(tag) ? tag : "div";
  }
  function escapeHtml(value) {
    return value.replace(/[&<>"']/g, (character) => {
      if (character === "&") return "&amp;";
      if (character === "<") return "&lt;";
      if (character === ">") return "&gt;";
      if (character === '"') return "&quot;";
      return "&#39;";
    });
  }
  Scratch.extensions.register(new TurboWarpHttpServerExtension());

})(Scratch);
