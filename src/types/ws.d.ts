declare module 'ws' {
  import type { EventEmitter } from 'events';
  import type { IncomingMessage } from 'http';

  export type RawData = string | Buffer | ArrayBuffer | Buffer[];

  export class WebSocket extends EventEmitter {
    constructor(address: string);
    static readonly OPEN: number;
    static readonly CLOSED: number;
    readonly readyState: number;

    close(code?: number, data?: string): void;
    terminate(): void;
    once(event: 'open', listener: () => void): this;
    once(event: 'error', listener: (error: Error) => void): this;
    once(event: 'message', listener: (data: RawData) => void): this;
    once(event: 'close', listener: () => void): this;
    send(data: string, cb?: (error?: Error) => void): void;

    on(event: 'message', listener: (data: RawData) => void): this;
    on(event: 'close', listener: () => void): this;
    on(event: 'error', listener: (error: Error) => void): this;
  }

  export class WebSocketServer extends EventEmitter {
    constructor(options: { host?: string; port: number });

    address(): { port: number } | string | null;
    close(cb?: () => void): void;

    on(
      event: 'connection',
      listener: (socket: WebSocket, request: IncomingMessage) => void,
    ): this;
    on(event: 'error', listener: (error: Error) => void): this;
    once(event: 'listening', listener: () => void): this;
    once(event: 'error', listener: (error: Error) => void): this;
  }

  export default WebSocket;
}
