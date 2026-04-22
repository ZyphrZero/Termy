declare module 'ws' {
  import type { EventEmitter } from 'events';
  import type { IncomingMessage } from 'http';

  export type RawData = string | Buffer | ArrayBuffer | Buffer[];

  export class WebSocket extends EventEmitter {
    static readonly OPEN: number;
    readonly readyState: number;

    close(code?: number, data?: string): void;
    send(data: string, cb?: (error?: Error) => void): void;

    on(event: 'message', listener: (data: RawData) => void): this;
    on(event: 'close', listener: () => void): this;
    on(event: 'error', listener: (error: Error) => void): this;
  }

  export class WebSocketServer extends EventEmitter {
    constructor(options: { port: number });

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
