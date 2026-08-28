# TurboWarp-HTTP-Server

[English](README.md) | [日本語](README.ja.md)

A companion package with both a CLI HTTP bridge server and a TurboWarp extension that connects Scratch-style block programs to that server over WebSocket.

**User guide:** [English](https://kubohiroya.github.io/turbowarp-http-server/)

## What it does

- Starts a local HTTP/WebSocket bridge server from the command line.
- Provides a TurboWarp custom extension bundle with blocks for configuring and using the bridge connection.
- Sends text messages between TurboWarp and the bridge while the full HTTP request/response protocol is being defined.

## Requirements and safety

- TurboWarp Desktop, TurboWarp Web, or TurboWarp Packager with custom extensions enabled.
- Node.js 22 or newer for the CLI bridge server.
- The extension requires unsandboxed mode so incoming HTTP requests can start TurboWarp hat threads.

## Installation

### CLI bridge server

From this repository:

```bash
corepack pnpm install
corepack pnpm run build
corepack pnpm start -- --host 127.0.0.1 --port 8787
```

From an installed package:

```bash
turbowarp-http-server --host 127.0.0.1 --port 8787
```

For an offline venue LAN, enable HTTP Digest authentication with an htdigest file:

```bash
turbowarp-http-digest init ./users.htdigest --realm turbowarp-lan
turbowarp-http-digest add ./users.htdigest alice --realm turbowarp-lan

turbowarp-http-server \
  --host 0.0.0.0 \
  --port 8787 \
  --auth-digest ./users.htdigest \
  --auth-realm turbowarp-lan
```

Digest authentication is intended for simple user identification on a trusted LAN where certificates and external identity providers are not available. It is disabled by default. The authenticated username is forwarded to TurboWarp handlers as the runtime-owned `x-turbowarp-http-auth-user` request header; an incoming client-supplied header with the same name is overwritten. The `/ws` endpoint is only accepted from localhost peers.

TurboWarp handlers can read authentication context with reporter blocks: `current auth type`, `current authenticated user`, `current auth provider`, `current auth profile JSON`, and `auth profile field [NAME]`. Digest authentication provides the username. OAuth-capable deployments can forward provider profile data as request auth context, and handlers can read fields such as `email`, `name`, or dotted paths like `organization.name`.

If a certificate and private key are already available, the server can run HTTPS directly:

```bash
turbowarp-http-server \
  --host 0.0.0.0 \
  --port 8787 \
  --tls-cert ./certs/server.crt \
  --tls-key ./certs/server.key
```

Certificate issuance, renewal, distribution, and OS/browser trust configuration are outside this package. For Internet-facing deployments, terminate TLS at a reverse proxy and use the Cloudflare/OAuth deployment path for authentication.

The server exposes:

| Route | Purpose |
|---|---|
| `GET /health` | Health check |
| `GET /ws` | WebSocket endpoint used by the TurboWarp extension |
| `GET /@assets/<name>` | Serve a named Asset Manager resource when a resource capability is attached |
| `HEAD /@assets/<name>` | Return the same resource metadata without a body |
| `PUT /@assets/<name>` | Create or atomically replace a named resource when supported |
| `DELETE /@assets/<name>` | Remove a named resource when supported |
| `GET /@assets/` | Return resource metadata without embedding binary payloads when supported |
| Any other HTTP route | Temporary `503 not_connected` placeholder until HTTP forwarding is implemented |

Sprite routes are a separate TurboWarp-facing layer. A Sprite named `camera` can publish `/camera`, and hiding that Sprite can disable the route. Those Sprite handlers may serve HTML, JSON, redirects, or friendly aliases such as `/camera/image.jpg`; they should call into the Asset Manager capability instead of making `@assets` a child namespace of the Sprite.

### Learning-only community server

Issue #10 adds an optional Scratch-like project sharing app for local learning examples. It is disabled by default so the existing bridge and `@assets` routes keep their current behavior.

Enable it from the CLI:

```bash
COMMUNITY=1 corepack pnpm start -- --host 127.0.0.1 --port 8787
# or
corepack pnpm start -- --host 127.0.0.1 --port 8787 --community
```

When enabled, the community app provides:

| Route | Purpose |
|---|---|
| `GET /` | Project listing HTML and an upload form for logged-in users |
| `GET /signup` / `POST /signup` | Demo password registration |
| `GET /login` / `POST /login` | Demo password login |
| `POST /logout` | Session logout |
| `GET /auth/:provider/start` | Start a configured OAuth demo flow |
| `GET /auth/:provider/callback` | Complete the OAuth demo flow |
| `POST /projects` | Upload an SB3 project and optional thumbnail |
| `GET /projects/:id` | Project detail HTML |
| `GET /projects/:id.sb3` | SB3 download |
| `POST /projects/:id/remix` | Create a remix linked to the source project |
| `POST /projects/:id/update` | Owner-only metadata edit |
| `POST /projects/:id/replace` | Owner-only SB3 and thumbnail replacement |
| `POST /projects/:id/delete` | Owner-only project deletion |

The demo hashes passwords with Node's standard `crypto.scrypt`, stores sessions in an HTTP-only `SameSite=Lax` cookie, issues CSRF tokens for HTML form posts, enforces multipart body limits before form parsing, applies per-file SB3 and thumbnail size limits, checks MIME types and file signatures, and rejects owner-only changes from other users. OAuth providers are enabled only when environment variables are present:

```bash
COMMUNITY_OAUTH_DEMO_CLIENT_ID=demo-client
COMMUNITY_OAUTH_DEMO_AUTHORIZATION_URL=https://example.test/oauth/authorize
COMMUNITY_OAUTH_DEMO_REDIRECT_URI=http://127.0.0.1:8787/auth/demo/callback
COMMUNITY_OAUTH_DEMO_SCOPE=profile
```

This community server is a local educational implementation, not a public production service. Before exposing it on the internet, replace the in-memory storage with durable storage, add rate limiting and abuse moderation, use HTTPS with secure cookies, implement a complete OAuth token/userinfo exchange, add email or external identity verification as needed, scan uploads, add audit logging, and document backup, retention, takedown, and incident-response procedures.

### TurboWarp extension bundle

1. Download [`dist/turbowarp-http-server.js`](dist/turbowarp-http-server.js?raw=1).
2. Open **Extensions** in TurboWarp.
3. Choose **Custom Extension** and load the file.

The reviewed JavaScript build is committed to this repository, so users do not need Node.js to install the extension.

### npm package

Install an exact version that you have reviewed:

```bash
pnpm add --save-exact @kubohiroya/turbowarp-http-server@0.0.0
```

Load the standalone bundle from:

```text
node_modules/@kubohiroya/turbowarp-http-server/dist/turbowarp-http-server.js
```

A version-pinned CDN URL is:

```text
https://cdn.jsdelivr.net/npm/@kubohiroya/turbowarp-http-server@0.0.0/dist/turbowarp-http-server.js
```

## Quick start

1. Start the CLI bridge server.
2. Set the bridge URL in TurboWarp, for example `ws://127.0.0.1:8787/ws`.
3. Connect, send a text payload, and read the latest bridge message.

```text
set HTTP bridge URL to [ws://127.0.0.1:8787/ws]
connect to HTTP bridge
send [{"type":"ping"}] to HTTP bridge
last HTTP bridge message
```

## Asset Manager Resource Serving

The HTTP server is camera-agnostic. It serves generic named resources supplied by an external capability, such as `turbowarp-asset-manager`, without reading private extension fields or duplicating Asset Manager storage.

The generic Asset Manager namespace is rooted at `/@assets/`. It is not owned by a Sprite route; it is managed by the background/server-side resource capability. Sprite routes can still expose friendly aliases, but the generic resource route stays global.

| Resource | HTTP route |
|---|---|
| Resource `live-camera` | `/@assets/live-camera` |
| Resource `logo` | `/@assets/logo` |

The resource capability boundary provides:

- logical resource name
- MIME type
- binary bytes for a consistent snapshot
- byte length when known
- replacement identity for ETag generation when available
- optional last-modified timestamp
- optional namespace publication policy

Resource responses include `Content-Type`, `Content-Length`, `ETag` when identity is available, `Last-Modified` when supplied, and `Cache-Control`. The default cache policy is `no-cache` when ETag or last-modified metadata is available, and `no-store` when no validation metadata exists. `HEAD` returns the same metadata as `GET` with no body.

`PUT` uses the request body bytes and `Content-Type` to create or replace a resource through the capability. The server enforces a configurable body-size limit before handing bytes to the capability, rejects unsupported MIME types when the capability reports them, and makes replacements visible atomically to subsequent requests. A `GET` already in progress receives the snapshot it started with.

The management namespace `/_tw-http/` is reserved and is not treated as an asset route. Paths such as `/camera/@assets/live-camera` are not generic Asset Manager routes; use a Scratch/TurboWarp handler to alias friendly Sprite URLs to `/@assets/<name>` when needed. Resource authorization hooks, when configured, are applied to `GET`, `HEAD`, `PUT`, `DELETE`, and listing requests. Structured resource logs include metadata such as route, resource name, MIME type, byte count, and status; they do not include binary request or response bodies.

## Sprite Route Model

TurboWarp-facing routes should map naturally to visible project objects:

| TurboWarp object | Public route |
|---|---|
| Stage/background script | `/` |
| Sprite `camera` while visible | `/camera` |
| Sprite `camera` while hidden | route disabled |

This keeps Scratch interaction tangible: showing a Sprite publishes its route, and hiding it withdraws that route. Asset Manager resources remain global at `/@assets/<name>` so the same resource can be reused by multiple Sprite routes without duplicating storage.

A live camera page can therefore be modeled as:

```text
Sprite: camera
    visible -> /camera is enabled
    hidden  -> /camera is disabled

GET /camera
    -> returns an HTML page built by the Sprite handler

GET /camera/image.jpg
    -> friendly handler/alias that serves /@assets/live-camera
```

In other words, `/camera/image.jpg` is a Sprite route decision, while `/@assets/live-camera` is the generic Asset Manager resource endpoint.

## Response Content Builders

The extension includes small builder-style blocks for response body construction. They are intentionally local to this package and do not introduce runtime dependencies on `turbowarp-html` or `turbowarp-markdown`.

Markdown builders return opaque handles such as `md:1`, allowing block chains to append content and render the final Markdown text:

```text
new markdown document
markdown [md:1] with heading level [1] [Status]
markdown [md:1] with paragraph [OK]
render markdown [md:1]
```

HTML builders use opaque handles such as `html:1`. Text and attributes are escaped, event-handler attributes such as `onclick` are ignored, URL attributes only accept conservative safe schemes, and unknown tags fall back to `div`.

```text
new HTML element [section]
HTML text [Live camera]
HTML [section] with child [text]
render HTML document title [Camera] body [section]
```

For server diagnostics, `HTTP log viewer HTML` returns a self-contained HTML document with a virtual-scroll log viewport. Scripts can append structured log JSON with `record HTTP log [ENTRY]`, clear it with `clear HTTP logs`, or render a viewer from an explicit JSON array with `HTTP log viewer HTML from [LOGS]`.

## Request Protocol And Blocks

For ordinary HTTP routes that are not handled by `/@assets`, the CLI server forwards the request to the connected TurboWarp extension over WebSocket. Each forwarded request receives a unique request ID and an isolated context.

Protocol v1 request messages preserve multi-valued query parameters and headers:

```json
{
  "type": "request",
  "protocol": "turbowarp-http-server",
  "version": 1,
  "id": "req-1",
  "method": "GET",
  "url": "http://127.0.0.1:8787/users/42?tag=a&tag=b",
  "path": "/users/42",
  "route": "/users/:id",
  "pathParams": {"id": "42"},
  "query": {"tag": ["a", "b"]},
  "headers": {"accept": ["text/html"]},
  "body": {"kind": "empty"},
  "clientAddress": ""
}
```

TurboWarp blocks can read the selected current request:

```text
current HTTP method
current request path
current request URL
request header [name]
query parameter [name]
path parameter [name]
current request body
current request content type
current request ID
```

The simple query/header reporters return the first value. The protocol keeps all values so future list-oriented blocks can expose repeated headers or query parameters without changing the wire format.

Response blocks mutate the response builder for the current request and complete it with a response message:

```text
set HTTP status [200]
set response header [name] to [value]
remove response header [name]
set response body [body]
send response [body]
respond with text [body]
respond with HTML [body]
respond with JSON [body]
```

Response status defaults to `200`. Status values outside `100` through `599`, unsafe response headers, CR/LF header injection values, and runtime-owned headers such as `Content-Length` are ignored or rejected before they can reach Node's HTTP response API. The server suppresses response bodies for `HEAD`, `204`, `205`, and `304` responses.

If no bridge is connected, ordinary HTTP routes return `503`. If a connected bridge does not respond before the configured timeout, the server returns `504`. If the WebSocket disconnects with requests pending, they return `502`.

## Live-Camera Pattern

For low-frequency camera publishing, compose three independent pieces:

```text
TurboWarp Camera Source
    -> capture current frame every 10 seconds
    -> replace Asset Manager resource "live-camera"
    -> HTTP Server serves /@assets/live-camera
    -> browser loads the stable URL
```

The HTTP server does not depend on `turbowarp-camera-source` or `turbowarp-html`. Camera Source only produces snapshots; Asset Manager owns the named resource; HTTP Server serves the generic resource URL.

Example block-level flow:

```text
forever
  capture current camera frame
  replace asset [live-camera] with captured JPEG bytes
  wait 10 seconds
end
```

External consumers can use the stable URL:

```text
/@assets/live-camera
```

If a friendlier URL is desired, a Scratch/TurboWarp route handler can alias:

```text
/camera/image.jpg -> /@assets/live-camera
```

An HTML page generated by `turbowarp-html` can refresh an `<img>` every 10 seconds, but cache correctness should come from HTTP validation headers, not timestamp query strings. With replacement identities from Asset Manager, clients can revalidate the stable URL using ETag and receive the newest snapshot without stale browser cache behavior.

## Block reference

The block reference is generated from [`src/block-definitions.json`](src/block-definitions.json). Do not edit the generated section manually.

<!-- BEGIN GENERATED BLOCKS -->

### `set HTTP bridge URL to [URL]`

Sets the WebSocket URL used to reach the HTTP bridge server.

| Property | Value |
|---|---|
| Type | Command |
| Opcode | `setServerUrl` |
| `URL` | String, default: `ws://127.0.0.1:8787/ws` |

### `connect to HTTP bridge`

Opens a WebSocket connection to the configured HTTP bridge server.

| Property | Value |
|---|---|
| Type | Command |
| Opcode | `connect` |

### `disconnect from HTTP bridge`

Closes the current bridge connection.

| Property | Value |
|---|---|
| Type | Command |
| Opcode | `disconnect` |

### `HTTP bridge connected?`

Reports whether the bridge WebSocket is currently open.

| Property | Value |
|---|---|
| Type | Boolean |
| Opcode | `isConnected` |

### `send [MESSAGE] to HTTP bridge`

Sends a text message to the connected HTTP bridge server.

| Property | Value |
|---|---|
| Type | Command |
| Opcode | `sendText` |
| `MESSAGE` | String, default: `{"type":"ping"}` |

### `last HTTP bridge message`

Returns the most recent text message received from the bridge.

| Property | Value |
|---|---|
| Type | Reporter |
| Opcode | `lastMessage` |

### `when HTTP request received`

Starts a TurboWarp handler thread when the bridge receives an HTTP request.

| Property | Value |
|---|---|
| Type | Hat |
| Opcode | `whenHttpRequestReceived` |

### `use HTTP request [ID]`

Selects a pending request context by request ID.

| Property | Value |
|---|---|
| Type | Command |
| Opcode | `useHttpRequest` |
| `ID` | String, default: `req-1` |

### `current request ID`

Returns the current HTTP request ID.

| Property | Value |
|---|---|
| Type | Reporter |
| Opcode | `currentRequestId` |

### `current HTTP method`

Returns the current HTTP request method.

| Property | Value |
|---|---|
| Type | Reporter |
| Opcode | `currentHttpMethod` |

### `current request path`

Returns the current HTTP request path.

| Property | Value |
|---|---|
| Type | Reporter |
| Opcode | `currentRequestPath` |

### `current request URL`

Returns the current HTTP request URL.

| Property | Value |
|---|---|
| Type | Reporter |
| Opcode | `currentRequestUrl` |

### `request header [NAME]`

Returns the first value of a request header using case-insensitive lookup.

| Property | Value |
|---|---|
| Type | Reporter |
| Opcode | `requestHeader` |
| `NAME` | String, default: `accept` |

### `query parameter [NAME]`

Returns the first query parameter value.

| Property | Value |
|---|---|
| Type | Reporter |
| Opcode | `queryParameter` |
| `NAME` | String, default: `q` |

### `path parameter [NAME]`

Returns a route path parameter value.

| Property | Value |
|---|---|
| Type | Reporter |
| Opcode | `pathParameter` |
| `NAME` | String, default: `id` |

### `current request body`

Returns the current textual request body, or an empty string for non-text bodies.

| Property | Value |
|---|---|
| Type | Reporter |
| Opcode | `currentRequestBody` |

### `current request content type`

Returns the current request Content-Type header.

| Property | Value |
|---|---|
| Type | Reporter |
| Opcode | `currentRequestContentType` |

### `current request client address`

Returns the current request client address when available.

| Property | Value |
|---|---|
| Type | Reporter |
| Opcode | `currentRequestClientAddress` |

### `current auth type`

Returns the current authentication type, such as digest or oauth.

| Property | Value |
|---|---|
| Type | Reporter |
| Opcode | `currentAuthType` |

### `current authenticated user`

Returns the authenticated username or a stable user-like profile field when available.

| Property | Value |
|---|---|
| Type | Reporter |
| Opcode | `currentAuthenticatedUser` |

### `current auth provider`

Returns the authentication provider name when available.

| Property | Value |
|---|---|
| Type | Reporter |
| Opcode | `currentAuthProvider` |

### `current auth profile JSON`

Returns the provider profile object as JSON when available.

| Property | Value |
|---|---|
| Type | Reporter |
| Opcode | `currentAuthProfileJson` |

### `auth profile field [NAME]`

Returns a top-level or dotted field from the provider profile object.

| Property | Value |
|---|---|
| Type | Reporter |
| Opcode | `authProfileField` |
| `NAME` | String, default: `email` |

### `current response status`

Returns the response status currently being built.

| Property | Value |
|---|---|
| Type | Reporter |
| Opcode | `currentResponseStatus` |

### `set HTTP status [STATUS]`

Sets the current response status.

| Property | Value |
|---|---|
| Type | Command |
| Opcode | `setHttpStatus` |
| `STATUS` | Number, default: `200` |

### `set response header [NAME] to [VALUE]`

Sets a response header for the current request.

| Property | Value |
|---|---|
| Type | Command |
| Opcode | `setResponseHeader` |
| `NAME` | String, default: `content-type` |
| `VALUE` | String, default: `text/plain; charset=utf-8` |

### `remove response header [NAME]`

Removes a response header for the current request.

| Property | Value |
|---|---|
| Type | Command |
| Opcode | `removeResponseHeader` |
| `NAME` | String, default: `content-type` |

### `response header [NAME]`

Returns the first configured response header value.

| Property | Value |
|---|---|
| Type | Reporter |
| Opcode | `responseHeader` |
| `NAME` | String, default: `content-type` |

### `set response body [BODY]`

Sets the current response body without completing the response.

| Property | Value |
|---|---|
| Type | Command |
| Opcode | `setResponseBody` |
| `BODY` | String, default: `Hello` |

### `send response [BODY]`

Sets the response body and completes the current request.

| Property | Value |
|---|---|
| Type | Command |
| Opcode | `sendResponse` |
| `BODY` | String, default: `Hello` |

### `respond with text [BODY]`

Responds with plain text.

| Property | Value |
|---|---|
| Type | Command |
| Opcode | `respondWithText` |
| `BODY` | String, default: `Hello` |

### `respond with HTML [BODY]`

Responds with HTML.

| Property | Value |
|---|---|
| Type | Command |
| Opcode | `respondWithHtml` |
| `BODY` | String, default: `<p>Hello</p>` |

### `respond with JSON [BODY]`

Responds with JSON.

| Property | Value |
|---|---|
| Type | Command |
| Opcode | `respondWithJson` |
| `BODY` | String, default: `{"ok":true}` |

### `record HTTP log [ENTRY]`

Adds a structured HTTP log entry JSON string to the extension log buffer.

| Property | Value |
|---|---|
| Type | Command |
| Opcode | `recordHttpLog` |
| `ENTRY` | String, default: `{"method":"GET","path":"/","status":200}` |

### `clear HTTP logs`

Clears the extension log buffer.

| Property | Value |
|---|---|
| Type | Command |
| Opcode | `clearHttpLogs` |

### `HTTP log viewer HTML`

Returns a self-contained virtual-scroll HTML log viewer for buffered HTTP logs.

| Property | Value |
|---|---|
| Type | Reporter |
| Opcode | `httpLogViewerHtml` |

### `HTTP log viewer HTML from [LOGS]`

Returns a self-contained virtual-scroll HTML log viewer from a JSON array of log entries.

| Property | Value |
|---|---|
| Type | Reporter |
| Opcode | `httpLogViewerHtmlFromJson` |
| `LOGS` | String, default: `[{"method":"GET","path":"/","status":200}]` |

### `new markdown document`

Creates an empty Markdown builder handle.

| Property | Value |
|---|---|
| Type | Reporter |
| Opcode | `newMarkdownDocument` |

### `markdown [DOC] with heading level [LEVEL] [TEXT]`

Appends a Markdown heading and returns the same builder handle.

| Property | Value |
|---|---|
| Type | Reporter |
| Opcode | `markdownHeading` |
| `DOC` | String, default: `md:1` |
| `LEVEL` | Number, default: `1` |
| `TEXT` | String, default: `Title` |

### `markdown [DOC] with paragraph [TEXT]`

Appends a Markdown paragraph and returns the same builder handle.

| Property | Value |
|---|---|
| Type | Reporter |
| Opcode | `markdownParagraph` |
| `DOC` | String, default: `md:1` |
| `TEXT` | String, default: `Hello` |

### `markdown [DOC] with bullet [TEXT]`

Appends a Markdown bullet and returns the same builder handle.

| Property | Value |
|---|---|
| Type | Reporter |
| Opcode | `markdownBullet` |
| `DOC` | String, default: `md:1` |
| `TEXT` | String, default: `Item` |

### `markdown [DOC] with code [CODE] language [LANG]`

Appends a fenced Markdown code block and returns the same builder handle.

| Property | Value |
|---|---|
| Type | Reporter |
| Opcode | `markdownCodeBlock` |
| `DOC` | String, default: `md:1` |
| `CODE` | String, default: `console.log('hello')` |
| `LANG` | String, default: `js` |

### `render markdown [DOC]`

Renders a Markdown builder handle to Markdown text.

| Property | Value |
|---|---|
| Type | Reporter |
| Opcode | `renderMarkdown` |
| `DOC` | String, default: `md:1` |

### `new HTML element [TAG]`

Creates an HTML element builder handle.

| Property | Value |
|---|---|
| Type | Reporter |
| Opcode | `newHtmlElement` |
| `TAG` | String, default: `div` |

### `HTML text [TEXT]`

Creates an escaped HTML text node handle.

| Property | Value |
|---|---|
| Type | Reporter |
| Opcode | `htmlText` |
| `TEXT` | String, default: `Hello` |

### `HTML [NODE] with attribute [NAME] [VALUE]`

Sets an escaped attribute on an HTML element and returns the same handle.

| Property | Value |
|---|---|
| Type | Reporter |
| Opcode | `htmlSetAttribute` |
| `NODE` | String, default: `html:1` |
| `NAME` | String, default: `class` |
| `VALUE` | String, default: `content` |

### `HTML [PARENT] with child [CHILD]`

Appends a child node to an HTML element and returns the parent handle.

| Property | Value |
|---|---|
| Type | Reporter |
| Opcode | `htmlAppendChild` |
| `PARENT` | String, default: `html:1` |
| `CHILD` | String, default: `html:2` |

### `render HTML [NODE]`

Renders an HTML node handle to an HTML fragment.

| Property | Value |
|---|---|
| Type | Reporter |
| Opcode | `renderHtml` |
| `NODE` | String, default: `html:1` |

### `render HTML document title [TITLE] body [BODY]`

Renders a full HTML document from an HTML body node handle.

| Property | Value |
|---|---|
| Type | Reporter |
| Opcode | `renderHtmlDocument` |
| `TITLE` | String, default: `Page` |
| `BODY` | String, default: `html:1` |

<!-- END GENERATED BLOCKS -->

## Important behavior

| Situation | Behavior |
|---|---|
| Empty bridge URL | Falls back to `ws://127.0.0.1:8787/ws`. |
| CLI `--host` omitted | Uses `HOST`, or `127.0.0.1` when unset. |
| CLI `--port` omitted | Uses `PORT`, or `8787` when unset. |
| Already connected | The connect block leaves the current open connection in place. |
| Sending while disconnected | The message is ignored. |
| Bridge close or error | The extension clears its active connection state. |
| Project stop or reload | TurboWarp unloads the extension runtime and any browser-owned WebSocket is closed by the page lifecycle. |

## Compatibility

| Identifier | Value | Stability |
|---|---|---|
| Product name | `TurboWarp-HTTP-Server` | Human-facing |
| Repository | `kubohiroya/turbowarp-http-server` | Current source location |
| npm package | `@kubohiroya/turbowarp-http-server` | Public package contract |
| CLI bin | `turbowarp-http-server` | Starts the bridge server |
| Extension ID | `kubohiroyaturbowarphttpserver` | Stored in SB3; migration required to change |

## Development

Use Node.js 22 or newer and the pnpm version declared by `packageManager`.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm check
```

Useful commands:

| Command | Purpose |
|---|---|
| `pnpm dev` | Rebuild the TurboWarp extension bundle while source files change |
| `pnpm run dev:server` | Run the CLI bridge server in watch mode |
| `pnpm start` | Start the built CLI bridge server |
| `pnpm run test` | Run tests |
| `pnpm run docs` | Regenerate block documentation |
| `pnpm run check:dist` | Verify committed build artifacts |
| `pnpm run pack:check` | Inspect the npm package |

## License

[Mozilla Public License 2.0](LICENSE) (SPDX: `MPL-2.0`).
