# turbowarp-http-server

Expose HTTP requests to TurboWarp/Scratch-style block programs and let blocks define HTTP responses.

This project is intended to act as a small bridge between ordinary HTTP clients and a TurboWarp project. The server accepts HTTP requests, forwards request events to TurboWarp over WebSocket, waits for the block program to produce a response, and returns that response to the original HTTP client.

## Status

Early development.

## Proposed architecture

```text
HTTP / HTTPS client
        |
        v
+---------------------------+
| turbowarp-http-server     |
| Hono + Node.js adapter    |
| HTTP(S) / WebSocket       |
+---------------------------+
        |
        | WebSocket
        v
+---------------------------+
| TurboWarp extension       |
+---------------------------+
        |
        v
Scratch-style blocks
```

## Design goals

- Define HTTP request handlers using TurboWarp blocks.
- Support GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD, and arbitrary methods where practical.
- Expose path parameters, query parameters, headers, body, method, and client information to blocks.
- Let blocks define status, response headers, and response body.
- Support plain HTTP for local development.
- Support HTTPS/TLS directly when certificates are configured.
- Work cleanly behind a reverse proxy such as Caddy, nginx, or a cloud ingress.
- Support WebSocket communication between the bridge and TurboWarp.
- Provide sensible CORS and security-header configuration.
- Keep the protocol between the server and TurboWarp documented and implementation-independent.
- Prefer modern Web-standard request/response APIs and TypeScript.

## Technology direction

The initial server implementation uses:

- Node.js 24 LTS
- TypeScript
- Hono
- `@hono/node-server`
- `ws` for WebSocket support

Hono is intentionally used as a thin HTTP routing layer rather than as a large application framework. Platform-specific concerns such as TLS sockets remain explicit at the Node.js adapter layer.

## TLS model

Two deployment modes are planned:

1. **Direct TLS** — load a key/certificate and serve HTTPS directly from Node.js.
2. **TLS termination at a reverse proxy** — run the bridge on localhost or a private network and let Caddy/nginx/cloud ingress handle certificates and public HTTPS.

The second mode is expected to be the recommended production configuration, while direct TLS is useful for LAN, laboratory, Raspberry Pi, appliance-like, and self-contained deployments.

## License

Mozilla Public License 2.0 (MPL-2.0).
