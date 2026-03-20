declare module "ws" {
  interface WebSocketOptions {
    maxPayload?: number;
  }

  type MessageData = string | Buffer;
  type CloseData = string | Buffer;

  class WebSocket {
    static readonly OPEN: number;

    constructor(url: string, options?: WebSocketOptions);

    readonly readyState: number;

    on(event: "open", listener: () => void): this;
    on(event: "message", listener: (data: MessageData) => void): this;
    on(
      event: "close",
      listener: (code: number, reason: CloseData) => void,
    ): this;
    on(event: "error", listener: (error: Error) => void): this;

    send(data: string): void;
    close(code?: number, reason?: string): void;
  }

  export default WebSocket;
}
