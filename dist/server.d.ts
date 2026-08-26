import { Hono } from 'hono';
export interface ServerOptions {
    hostname: string;
    port: number;
}
export interface RunningServer {
    hostname: string;
    port: number;
    close(): Promise<void>;
}
export declare function createApp(): Hono;
export declare function startServer(options: ServerOptions): RunningServer;
