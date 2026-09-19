// Name: TurboWarp-HTTP-Server
// ID: kubohiroyaturbowarphttpserver
// Description: Connect TurboWarp blocks to an HTTP bridge server over WebSocket.
// By: Hiroya Kubo
// License: MPL-2.0

(function (Scratch) {
  'use strict';

  const extensionConfig = {
    id: "kubohiroyaturbowarphttpserver",
    name: "TurboWarp-HTTP-Server",
    docsURI: "https://kubohiroya.github.io/turbowarp-http-server/",
    blockIconURI: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMDAvc3ZnIiB2aWV3Qm94PSIwIDAgNDggNDgiPjxyZWN0IHg9IjYiIHk9IjEwIiB3aWR0aD0iMzYiIGhlaWdodD0iMjgiIHJ4PSI0IiBmaWxsPSIjMjU2M0VCIi8+PHBhdGggZD0iTTEyIDE4aDI0TTExIDI0aDE0TTExIDMwaDIwIiBzdHJva2U9IiNGRkYiIHN0cm9rZS13aWR0aD0iMyIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIi8+PGNpcmNsZSBjeD0iMzQiIGN5PSIzMCIgcj0iMyIgZmlsbD0iIzIyQzU1RSIvPjwvc3ZnPg=="
  };
  const extensionName = "TurboWarp-HTTP-Server";
  const blocks = /* @__PURE__ */ JSON.parse(`[{"opcode":"setServerUrl","blockType":"COMMAND","text":"set HTTP bridge URL to [URL]","description":"Sets the WebSocket URL used to reach the HTTP bridge server.","arguments":{"URL":{"type":"STRING","defaultValue":"ws://127.0.0.1:8787/ws"}}},{"opcode":"connect","blockType":"COMMAND","text":"connect to HTTP bridge","description":"Opens a WebSocket connection to the configured HTTP bridge server.","arguments":{}},{"opcode":"disconnect","blockType":"COMMAND","text":"disconnect from HTTP bridge","description":"Closes the current bridge connection.","arguments":{}},{"opcode":"isConnected","blockType":"BOOLEAN","text":"HTTP bridge connected?","description":"Reports whether the bridge WebSocket is currently open.","arguments":{}},{"opcode":"sendText","blockType":"COMMAND","text":"send [MESSAGE] to HTTP bridge","description":"Sends a text message to the connected HTTP bridge server.","arguments":{"MESSAGE":{"type":"STRING","defaultValue":"{\\"type\\":\\"ping\\"}"}}},{"opcode":"lastMessage","blockType":"REPORTER","text":"last HTTP bridge message","description":"Returns the most recent text message received from the bridge.","arguments":{}},{"opcode":"whenHttpRequestReceived","blockType":"HAT","text":"when HTTP request received","description":"Starts a TurboWarp handler thread when the bridge receives an HTTP request.","arguments":{}},{"opcode":"useHttpRequest","blockType":"COMMAND","text":"use HTTP request [ID]","description":"Selects a pending request context by request ID.","arguments":{"ID":{"type":"STRING","defaultValue":"req-1"}}},{"opcode":"currentRequestId","blockType":"REPORTER","text":"current request ID","description":"Returns the current HTTP request ID.","arguments":{}},{"opcode":"currentHttpMethod","blockType":"REPORTER","text":"current HTTP method","description":"Returns the current HTTP request method.","arguments":{}},{"opcode":"currentRequestPath","blockType":"REPORTER","text":"current request path","description":"Returns the current HTTP request path.","arguments":{}},{"opcode":"currentRequestUrl","blockType":"REPORTER","text":"current request URL","description":"Returns the current HTTP request URL.","arguments":{}},{"opcode":"requestHeader","blockType":"REPORTER","text":"request header [NAME]","description":"Returns the first value of a request header using case-insensitive lookup.","arguments":{"NAME":{"type":"STRING","defaultValue":"accept"}}},{"opcode":"queryParameter","blockType":"REPORTER","text":"query parameter [NAME]","description":"Returns the first query parameter value.","arguments":{"NAME":{"type":"STRING","defaultValue":"q"}}},{"opcode":"pathParameter","blockType":"REPORTER","text":"path parameter [NAME]","description":"Returns a route path parameter value.","arguments":{"NAME":{"type":"STRING","defaultValue":"id"}}},{"opcode":"currentRequestBody","blockType":"REPORTER","text":"current request body","description":"Returns the current textual request body, or an empty string for non-text bodies.","arguments":{}},{"opcode":"currentRequestContentType","blockType":"REPORTER","text":"current request content type","description":"Returns the current request Content-Type header.","arguments":{}},{"opcode":"currentRequestClientAddress","blockType":"REPORTER","text":"current request client address","description":"Returns the current request client address when available.","arguments":{}},{"opcode":"setHandlerVariable","blockType":"COMMAND","text":"set handler variable [NAME] to [VALUE]","description":"Sets a request-local variable that is discarded when the current HTTP response completes.","arguments":{"NAME":{"type":"STRING","defaultValue":"value"},"VALUE":{"type":"STRING","defaultValue":"0"}}},{"opcode":"changeHandlerVariable","blockType":"COMMAND","text":"change handler variable [NAME] by [AMOUNT]","description":"Changes a request-local numeric variable using Scratch number conversion rules.","arguments":{"NAME":{"type":"STRING","defaultValue":"value"},"AMOUNT":{"type":"NUMBER","defaultValue":1}}},{"opcode":"handlerVariable","blockType":"REPORTER","text":"handler variable [NAME]","description":"Returns a request-local handler variable, or an empty string when it does not exist.","arguments":{"NAME":{"type":"STRING","defaultValue":"value"}}},{"opcode":"handlerVariableExists","blockType":"BOOLEAN","text":"handler variable [NAME] exists?","description":"Reports whether a request-local handler variable exists.","arguments":{"NAME":{"type":"STRING","defaultValue":"value"}}},{"opcode":"deleteHandlerVariable","blockType":"COMMAND","text":"delete handler variable [NAME]","description":"Deletes a request-local handler variable.","arguments":{"NAME":{"type":"STRING","defaultValue":"value"}}},{"opcode":"clearHandlerVariables","blockType":"COMMAND","text":"delete all handler variables","description":"Deletes all request-local handler variables for the current HTTP handler.","arguments":{}},{"opcode":"listHandlerVariables","blockType":"REPORTER","text":"active handler variables","description":"Returns comma-separated names of request-local handler variables.","arguments":{}},{"opcode":"currentResponseStatus","blockType":"REPORTER","text":"current response status","description":"Returns the response status currently being built.","arguments":{}},{"opcode":"setHttpStatus","blockType":"COMMAND","text":"set HTTP status [STATUS]","description":"Sets the current response status.","arguments":{"STATUS":{"type":"NUMBER","defaultValue":200}}},{"opcode":"setResponseHeader","blockType":"COMMAND","text":"set response header [NAME] to [VALUE]","description":"Sets a response header for the current request.","arguments":{"NAME":{"type":"STRING","defaultValue":"content-type"},"VALUE":{"type":"STRING","defaultValue":"text/plain; charset=utf-8"}}},{"opcode":"removeResponseHeader","blockType":"COMMAND","text":"remove response header [NAME]","description":"Removes a response header for the current request.","arguments":{"NAME":{"type":"STRING","defaultValue":"content-type"}}},{"opcode":"responseHeader","blockType":"REPORTER","text":"response header [NAME]","description":"Returns the first configured response header value.","arguments":{"NAME":{"type":"STRING","defaultValue":"content-type"}}},{"opcode":"setResponseBody","blockType":"COMMAND","text":"set response body [BODY]","description":"Sets the current response body without completing the response.","arguments":{"BODY":{"type":"STRING","defaultValue":"Hello"}}},{"opcode":"sendResponse","blockType":"COMMAND","text":"send response [BODY]","description":"Sets the response body and completes the current request.","arguments":{"BODY":{"type":"STRING","defaultValue":"Hello"}}},{"opcode":"respondWithText","blockType":"COMMAND","text":"respond with text [BODY]","description":"Responds with plain text.","arguments":{"BODY":{"type":"STRING","defaultValue":"Hello"}}},{"opcode":"respondWithHtml","blockType":"COMMAND","text":"respond with HTML [BODY]","description":"Responds with HTML.","arguments":{"BODY":{"type":"STRING","defaultValue":"<p>Hello</p>"}}},{"opcode":"respondWithJson","blockType":"COMMAND","text":"respond with JSON [BODY]","description":"Responds with JSON.","arguments":{"BODY":{"type":"STRING","defaultValue":"{\\"ok\\":true}"}}},{"opcode":"respondWithNamedBody","blockType":"COMMAND","text":"respond with named [NAMESPACE] [NAME] kind [KIND] scope [SCOPE] target [TARGET_ID] as [REPRESENTATION] max bytes [MAX_BYTES]","description":"Completes the response with a named structured, document, binary, or asset snapshot resolved by the server.","arguments":{"NAMESPACE":{"type":"STRING","defaultValue":"asset"},"NAME":{"type":"STRING","defaultValue":"avatar"},"KIND":{"type":"STRING","defaultValue":"asset"},"SCOPE":{"type":"STRING","defaultValue":"project"},"TARGET_ID":{"type":"STRING","defaultValue":"Stage:1"},"REPRESENTATION":{"type":"STRING","defaultValue":"raw"},"MAX_BYTES":{"type":"NUMBER","defaultValue":10485760}}},{"opcode":"recordHttpLog","blockType":"COMMAND","text":"record HTTP log [ENTRY]","description":"Adds a structured HTTP log entry JSON string to the extension log buffer.","arguments":{"ENTRY":{"type":"STRING","defaultValue":"{\\"method\\":\\"GET\\",\\"path\\":\\"/\\",\\"status\\":200}"}}},{"opcode":"clearHttpLogs","blockType":"COMMAND","text":"clear HTTP logs","description":"Clears the extension log buffer.","arguments":{}},{"opcode":"httpLogViewerHtml","blockType":"REPORTER","text":"HTTP log viewer HTML","description":"Returns a self-contained virtual-scroll HTML log viewer for buffered HTTP logs.","arguments":{}},{"opcode":"httpLogViewerHtmlFromJson","blockType":"REPORTER","text":"HTTP log viewer HTML from [LOGS]","description":"Returns a self-contained virtual-scroll HTML log viewer from a JSON array of log entries.","arguments":{"LOGS":{"type":"STRING","defaultValue":"[{\\"method\\":\\"GET\\",\\"path\\":\\"/\\",\\"status\\":200}]"}}},{"opcode":"newMarkdownDocument","blockType":"REPORTER","text":"new markdown document","description":"Creates an empty Markdown builder handle.","arguments":{}},{"opcode":"markdownHeading","blockType":"REPORTER","text":"markdown [DOC] with heading level [LEVEL] [TEXT]","description":"Appends a Markdown heading and returns the same builder handle.","arguments":{"DOC":{"type":"STRING","defaultValue":"md:1"},"LEVEL":{"type":"NUMBER","defaultValue":1},"TEXT":{"type":"STRING","defaultValue":"Title"}}},{"opcode":"markdownParagraph","blockType":"REPORTER","text":"markdown [DOC] with paragraph [TEXT]","description":"Appends a Markdown paragraph and returns the same builder handle.","arguments":{"DOC":{"type":"STRING","defaultValue":"md:1"},"TEXT":{"type":"STRING","defaultValue":"Hello"}}},{"opcode":"markdownBullet","blockType":"REPORTER","text":"markdown [DOC] with bullet [TEXT]","description":"Appends a Markdown bullet and returns the same builder handle.","arguments":{"DOC":{"type":"STRING","defaultValue":"md:1"},"TEXT":{"type":"STRING","defaultValue":"Item"}}},{"opcode":"markdownCodeBlock","blockType":"REPORTER","text":"markdown [DOC] with code [CODE] language [LANG]","description":"Appends a fenced Markdown code block and returns the same builder handle.","arguments":{"DOC":{"type":"STRING","defaultValue":"md:1"},"CODE":{"type":"STRING","defaultValue":"console.log('hello')"},"LANG":{"type":"STRING","defaultValue":"js"}}},{"opcode":"renderMarkdown","blockType":"REPORTER","text":"render markdown [DOC]","description":"Renders a Markdown builder handle to Markdown text.","arguments":{"DOC":{"type":"STRING","defaultValue":"md:1"}}},{"opcode":"newHtmlElement","blockType":"REPORTER","text":"new HTML element [TAG]","description":"Creates an HTML element builder handle.","arguments":{"TAG":{"type":"STRING","defaultValue":"div"}}},{"opcode":"htmlText","blockType":"REPORTER","text":"HTML text [TEXT]","description":"Creates an escaped HTML text node handle.","arguments":{"TEXT":{"type":"STRING","defaultValue":"Hello"}}},{"opcode":"htmlSetAttribute","blockType":"REPORTER","text":"HTML [NODE] with attribute [NAME] [VALUE]","description":"Sets an escaped attribute on an HTML element and returns the same handle.","arguments":{"NODE":{"type":"STRING","defaultValue":"html:1"},"NAME":{"type":"STRING","defaultValue":"class"},"VALUE":{"type":"STRING","defaultValue":"content"}}},{"opcode":"htmlAppendChild","blockType":"REPORTER","text":"HTML [PARENT] with child [CHILD]","description":"Appends a child node to an HTML element and returns the parent handle.","arguments":{"PARENT":{"type":"STRING","defaultValue":"html:1"},"CHILD":{"type":"STRING","defaultValue":"html:2"}}},{"opcode":"renderHtml","blockType":"REPORTER","text":"render HTML [NODE]","description":"Renders an HTML node handle to an HTML fragment.","arguments":{"NODE":{"type":"STRING","defaultValue":"html:1"}}},{"opcode":"renderHtmlDocument","blockType":"REPORTER","text":"render HTML document title [TITLE] body [BODY]","description":"Renders a full HTML document from an HTML body node handle.","arguments":{"TITLE":{"type":"STRING","defaultValue":"Page"},"BODY":{"type":"STRING","defaultValue":"html:1"}}}]`);
  const definitions = {
    extensionName,
    blocks
  };
  function normalizeHeaderName(name) {
    return name.trim().toLowerCase();
  }
  function isValidHttpStatus(status) {
    return Number.isInteger(status) && status >= 100 && status <= 599;
  }
  function isForbiddenResponseHeader(name) {
    return ["connection", "content-length", "transfer-encoding", "upgrade"].includes(
      normalizeHeaderName(name)
    );
  }
  function validateHeaderName(name) {
    return /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name);
  }
  function validateHeaderValue(value) {
    return !/[\r\n]/.test(value);
  }
  function firstValue(values) {
    return values?.[0] ?? "";
  }
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
  const HTTP_REQUEST_HAT_OPCODE = `${extensionConfig.id}_whenHttpRequestReceived`;
  const URL_ATTRIBUTES = /* @__PURE__ */ new Set(["action", "cite", "formaction", "href", "poster", "src", "xlink:href"]);
  const URL_LIST_ATTRIBUTES = /* @__PURE__ */ new Set(["srcset"]);
  const SAFE_URL_SCHEMES = /* @__PURE__ */ new Set(["http", "https", "mailto", "tel"]);
  const NAMED_BODY_KINDS = /* @__PURE__ */ new Set(["structured", "document", "binary", "asset"]);
  const NAMED_BODY_SCOPES = /* @__PURE__ */ new Set(["target", "project"]);
  const NAMED_BODY_REPRESENTATIONS = /* @__PURE__ */ new Set(["json", "yaml", "html", "markdown", "raw"]);
  class TurboWarpHttpServerExtension {
    constructor() {
      this.serverUrl = DEFAULT_SERVER_URL;
      this.socket = null;
      this.lastReceivedMessage = "";
      this.nextHandleId = 1;
      this.httpLogs = [];
      this.markdownBuilders = /* @__PURE__ */ new Map();
      this.htmlNodes = /* @__PURE__ */ new Map();
      this.requestContexts = /* @__PURE__ */ new Map();
      this.currentRequestContextId = "";
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
        this.receiveBridgeMessage(this.lastReceivedMessage);
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
    whenHttpRequestReceived() {
      return false;
    }
    useHttpRequest(args) {
      const id = Scratch.Cast.toString(args.ID);
      if (this.requestContexts.has(id)) this.currentRequestContextId = id;
    }
    currentRequestId() {
      return this.currentContext()?.request.id ?? "";
    }
    currentHttpMethod() {
      return this.currentContext()?.request.method ?? "";
    }
    currentRequestPath() {
      return this.currentContext()?.request.path ?? "";
    }
    currentRequestUrl() {
      return this.currentContext()?.request.url ?? "";
    }
    requestHeader(args) {
      const name = normalizeHeaderName(Scratch.Cast.toString(args.NAME));
      return firstValue(this.currentContext()?.request.headers[name]);
    }
    queryParameter(args) {
      return firstValue(this.currentContext()?.request.query[Scratch.Cast.toString(args.NAME)]);
    }
    pathParameter(args) {
      return this.currentContext()?.request.pathParams[Scratch.Cast.toString(args.NAME)] ?? "";
    }
    currentRequestBody() {
      const body = this.currentContext()?.request.body;
      return body?.kind === "text" ? body.text : "";
    }
    currentRequestContentType() {
      return this.requestHeader({ NAME: "content-type" });
    }
    currentRequestClientAddress() {
      return this.currentContext()?.request.clientAddress ?? "";
    }
    setHandlerVariable(args) {
      const context = this.mutableCurrentContext();
      if (!context) return;
      context.handlerVariables.set(Scratch.Cast.toString(args.NAME), Scratch.Cast.toString(args.VALUE));
    }
    changeHandlerVariable(args) {
      const context = this.mutableCurrentContext();
      if (!context) return;
      const name = Scratch.Cast.toString(args.NAME);
      const current = Scratch.Cast.toNumber(context.handlerVariables.get(name) ?? "");
      context.handlerVariables.set(name, current + Scratch.Cast.toNumber(args.AMOUNT));
    }
    handlerVariable(args) {
      return this.currentContext()?.handlerVariables.get(Scratch.Cast.toString(args.NAME)) ?? "";
    }
    handlerVariableExists(args) {
      return this.currentContext()?.handlerVariables.has(Scratch.Cast.toString(args.NAME)) ?? false;
    }
    deleteHandlerVariable(args) {
      this.mutableCurrentContext()?.handlerVariables.delete(Scratch.Cast.toString(args.NAME));
    }
    clearHandlerVariables() {
      this.mutableCurrentContext()?.handlerVariables.clear();
    }
    listHandlerVariables() {
      return Array.from(this.currentContext()?.handlerVariables.keys() ?? []).join(",");
    }
    currentResponseStatus() {
      return this.currentContext()?.response.status ?? 200;
    }
    setHttpStatus(args) {
      const context = this.mutableCurrentContext();
      if (!context) return;
      const status = Math.trunc(Scratch.Cast.toNumber(args.STATUS));
      if (isValidHttpStatus(status)) context.response.status = status;
    }
    setResponseHeader(args) {
      const context = this.mutableCurrentContext();
      if (!context) return;
      const name = normalizeHeaderName(Scratch.Cast.toString(args.NAME));
      const value = Scratch.Cast.toString(args.VALUE);
      if (validateHeaderName(name) && validateHeaderValue(value) && !isForbiddenResponseHeader(name)) {
        context.response.headers[name] = [value];
      }
    }
    removeResponseHeader(args) {
      const context = this.mutableCurrentContext();
      if (!context) return;
      delete context.response.headers[normalizeHeaderName(Scratch.Cast.toString(args.NAME))];
    }
    responseHeader(args) {
      const name = normalizeHeaderName(Scratch.Cast.toString(args.NAME));
      return firstValue(this.currentContext()?.response.headers[name]);
    }
    setResponseBody(args) {
      const context = this.mutableCurrentContext();
      if (!context) return;
      context.response.body = { kind: "text", text: Scratch.Cast.toString(args.BODY) };
    }
    sendResponse(args) {
      const context = this.mutableCurrentContext();
      if (!context) return;
      context.response.body = { kind: "text", text: Scratch.Cast.toString(args.BODY) };
      this.completeResponse(context);
    }
    respondWithText(args) {
      this.setResponseHeader({ NAME: "content-type", VALUE: "text/plain; charset=utf-8" });
      this.sendResponse({ BODY: args.BODY });
    }
    respondWithHtml(args) {
      this.setResponseHeader({ NAME: "content-type", VALUE: "text/html; charset=utf-8" });
      this.sendResponse({ BODY: args.BODY });
    }
    respondWithJson(args) {
      this.setResponseHeader({ NAME: "content-type", VALUE: "application/json; charset=utf-8" });
      this.sendResponse({ BODY: args.BODY });
    }
    respondWithNamedBody(args) {
      const context = this.mutableCurrentContext();
      if (!context) return;
      const kind = Scratch.Cast.toString(args.KIND).toLowerCase();
      const scope = Scratch.Cast.toString(args.SCOPE).toLowerCase();
      const representation = Scratch.Cast.toString(args.REPRESENTATION).toLowerCase();
      const maxBytes = Math.trunc(Scratch.Cast.toNumber(args.MAX_BYTES));
      if (!NAMED_BODY_KINDS.has(kind) || !NAMED_BODY_SCOPES.has(scope) || !NAMED_BODY_REPRESENTATIONS.has(representation) || !Number.isSafeInteger(maxBytes) || maxBytes < 1) {
        context.response.body = { kind: "unsupported", reason: "invalid_named_body" };
        this.completeResponse(context);
        return;
      }
      context.response.body = {
        kind: "named",
        reference: {
          namespace: Scratch.Cast.toString(args.NAMESPACE),
          name: Scratch.Cast.toString(args.NAME),
          kind,
          scope
        },
        representation,
        ...scope === "target" ? { targetId: Scratch.Cast.toString(args.TARGET_ID) } : {},
        maxBytes
      };
      this.completeResponse(context);
    }
    receiveBridgeRequestForTest(request) {
      this.acceptBridgeRequest(request);
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
      const normalizedName = name.toLowerCase();
      const value = Scratch.Cast.toString(args.VALUE);
      if (node?.kind === "element" && VALID_ATTRIBUTE.test(name) && !normalizedName.startsWith("on") && isSafeAttributeValue(normalizedName, value)) {
        node.attributes[name] = value;
      }
      return handle;
    }
    htmlAppendChild(args) {
      const parentHandle = this.ensureHtmlElementHandle(args.PARENT);
      const childHandle = Scratch.Cast.toString(args.CHILD);
      const parent = this.htmlNodes.get(parentHandle);
      if (parent?.kind === "element" && this.htmlNodes.has(childHandle) && parentHandle !== childHandle && !this.hasHtmlDescendant(childHandle, parentHandle, /* @__PURE__ */ new Set())) {
        parent.children.push(childHandle);
      }
      return parentHandle;
    }
    renderHtml(args) {
      return this.renderHtmlNode(Scratch.Cast.toString(args.NODE), /* @__PURE__ */ new Set());
    }
    renderHtmlDocument(args) {
      const title = escapeHtml(Scratch.Cast.toString(args.TITLE));
      return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head><body>${this.renderHtmlNode(
        Scratch.Cast.toString(args.BODY),
        /* @__PURE__ */ new Set()
      )}</body></html>`;
    }
    stringifyMessage(message) {
      if (typeof message === "string") return message;
      if (message instanceof ArrayBuffer) return new TextDecoder().decode(message);
      return String(message);
    }
    receiveBridgeMessage(message) {
      try {
        const parsed = JSON.parse(message);
        if (parsed.type === "request" && typeof parsed.id === "string") {
          this.acceptBridgeRequest(parsed);
        }
      } catch {
        return;
      }
    }
    acceptBridgeRequest(request) {
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
          body: { kind: "empty" },
          completed: false
        },
        handlerVariables: /* @__PURE__ */ new Map()
      });
      this.currentRequestContextId = request.id;
      this.startRequestHat();
    }
    currentContext() {
      return this.requestContexts.get(this.currentRequestContextId);
    }
    mutableCurrentContext() {
      const context = this.currentContext();
      return context && !context.response.completed ? context : void 0;
    }
    completeResponse(context) {
      if (context.response.completed) return;
      context.response.completed = true;
      const message = {
        type: "response",
        id: context.request.id,
        status: context.response.status,
        headers: context.response.headers,
        body: context.response.body
      };
      this.socket?.send(JSON.stringify(message));
      this.requestContexts.delete(context.request.id);
      if (this.currentRequestContextId === context.request.id) this.currentRequestContextId = "";
    }
    recordLogMessage(message) {
      const parsed = this.parseLogEntry(message);
      if (isLogLike(parsed)) this.httpLogs.push(parsed);
    }
    startRequestHat() {
      Scratch.vm?.runtime?.startHats?.(HTTP_REQUEST_HAT_OPCODE);
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
    renderHtmlNode(handle, visiting) {
      if (visiting.has(handle)) return "";
      const node = this.htmlNodes.get(handle);
      if (!node) return "";
      if (node.kind === "text") return escapeHtml(node.text);
      visiting.add(handle);
      const attributes = Object.entries(node.attributes).map(([name, value]) => ` ${name}="${escapeHtml(value)}"`).join("");
      if (VOID_HTML_TAGS.has(node.tag)) {
        visiting.delete(handle);
        return `<${node.tag}${attributes}>`;
      }
      const children = node.children.map((child) => this.renderHtmlNode(child, visiting)).join("");
      visiting.delete(handle);
      return `<${node.tag}${attributes}>${children}</${node.tag}>`;
    }
    hasHtmlDescendant(handle, targetHandle, visited) {
      if (visited.has(handle)) return false;
      visited.add(handle);
      const node = this.htmlNodes.get(handle);
      if (node?.kind !== "element") return false;
      return node.children.some(
        (child) => child === targetHandle || this.hasHtmlDescendant(child, targetHandle, visited)
      );
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
  function normalizeHeaderRecord(headers) {
    const normalized = {};
    for (const [name, values] of Object.entries(headers ?? {})) {
      normalized[normalizeHeaderName(name)] = values.map((value) => String(value));
    }
    return normalized;
  }
  function normalizeValueRecord(values) {
    const normalized = {};
    for (const [name, items] of Object.entries(values ?? {})) {
      normalized[name] = items.map((value) => String(value));
    }
    return normalized;
  }
  function normalizePathParams(values) {
    const normalized = {};
    for (const [name, value] of Object.entries(values ?? {})) {
      normalized[name] = String(value);
    }
    return normalized;
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
  function isSafeAttributeValue(name, value) {
    if (URL_LIST_ATTRIBUTES.has(name)) return isSafeUrlList(value);
    if (URL_ATTRIBUTES.has(name)) return isSafeUrl(value);
    return true;
  }
  function isSafeUrlList(value) {
    return value.split(",").map((candidate) => candidate.trim().split(/\s+/, 1)[0] ?? "").every((url) => isSafeUrl(url));
  }
  function isSafeUrl(value) {
    const trimmed = value.trim();
    if (!trimmed) return true;
    const normalized = stripUrlSchemeSeparators(trimmed);
    const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(normalized)?.[1]?.toLowerCase();
    return scheme === void 0 || SAFE_URL_SCHEMES.has(scheme);
  }
  function stripUrlSchemeSeparators(value) {
    let result = "";
    for (const character of value) {
      const code = character.charCodeAt(0);
      if (code <= 31 || code === 127 || /\s/.test(character)) continue;
      result += character;
    }
    return result;
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
  if (!Scratch.extensions.unsandboxed) {
    throw new Error(`${extensionConfig.name} must run unsandboxed.`);
  }
  Scratch.extensions.register(new TurboWarpHttpServerExtension());

})(Scratch);
