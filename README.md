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
- The current extension is sandbox-compatible and does not require unsandboxed mode.

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

The server exposes:

| Route | Purpose |
|---|---|
| `GET /health` | Health check |
| `GET /ws` | WebSocket endpoint used by the TurboWarp extension |
| Any other HTTP route | Temporary `503 not_connected` placeholder until HTTP forwarding is implemented |

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
