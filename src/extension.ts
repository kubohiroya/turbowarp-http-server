import {extensionConfig} from './config';
import definitions from './block-definitions.json';

type BlockTypeName = 'COMMAND' | 'REPORTER' | 'BOOLEAN';
type ArgumentTypeName = 'STRING';

interface DefinitionArgument {
  type: ArgumentTypeName;
  defaultValue: string;
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

export class TurboWarpHttpServerExtension implements TurboWarpExtension {
  private serverUrl = DEFAULT_SERVER_URL;
  private socket: WebSocket | null = null;
  private lastReceivedMessage = '';

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

  private stringifyMessage(message: unknown): string {
    if (typeof message === 'string') return message;
    if (message instanceof ArrayBuffer) return new TextDecoder().decode(message);
    return String(message);
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
