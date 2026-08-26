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
  const blocks = [{ "opcode": "setServerUrl", "blockType": "COMMAND", "text": "set HTTP bridge URL to [URL]", "description": "Sets the WebSocket URL used to reach the HTTP bridge server.", "arguments": { "URL": { "type": "STRING", "defaultValue": "ws://127.0.0.1:8787/ws" } } }, { "opcode": "connect", "blockType": "COMMAND", "text": "connect to HTTP bridge", "description": "Opens a WebSocket connection to the configured HTTP bridge server.", "arguments": {} }, { "opcode": "disconnect", "blockType": "COMMAND", "text": "disconnect from HTTP bridge", "description": "Closes the current bridge connection.", "arguments": {} }, { "opcode": "isConnected", "blockType": "BOOLEAN", "text": "HTTP bridge connected?", "description": "Reports whether the bridge WebSocket is currently open.", "arguments": {} }, { "opcode": "sendText", "blockType": "COMMAND", "text": "send [MESSAGE] to HTTP bridge", "description": "Sends a text message to the connected HTTP bridge server.", "arguments": { "MESSAGE": { "type": "STRING", "defaultValue": '{"type":"ping"}' } } }, { "opcode": "lastMessage", "blockType": "REPORTER", "text": "last HTTP bridge message", "description": "Returns the most recent text message received from the bridge.", "arguments": {} }];
  const definitions = {
    extensionName,
    blocks
  };
  const blockDefinitions = definitions.blocks;
  const DEFAULT_SERVER_URL = "ws://127.0.0.1:8787/ws";
  class TurboWarpHttpServerExtension {
    constructor() {
      this.serverUrl = DEFAULT_SERVER_URL;
      this.socket = null;
      this.lastReceivedMessage = "";
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
    stringifyMessage(message) {
      if (typeof message === "string") return message;
      if (message instanceof ArrayBuffer) return new TextDecoder().decode(message);
      return String(message);
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
  Scratch.extensions.register(new TurboWarpHttpServerExtension());

})(Scratch);
