import { WebSocket } from "ws";
import type { GameState, MethodDescriptor, StudioInfo } from "../types.js";

/**
 * 纯 TypeScript WebSocket 客户端，模拟 Roblox Studio 连接 Hub。
 * 用于 E2E 测试。
 */
export class MockStudioClient {
  private ws: WebSocket | null = null;
  private studioId: string | null = null;
  private messageQueue: unknown[] = [];
  private messageWaiters: Array<{
    type: string;
    resolve: (msg: unknown) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  async connect(options: {
    port: number;
    studioInfo?: Partial<StudioInfo>;
    methods?: MethodDescriptor[];
    gameState?: GameState;
  }): Promise<string> {
    const { port, studioInfo, methods = [], gameState = "edit" } = options;

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(`ws://127.0.0.1:${port}`);

      this.ws.on("open", () => {
        const hello = {
          type: "hello",
          studioInfo: {
            placeId: 0,
            placeName: "MockStudio",
            gameId: 0,
            userId: 0,
            ...studioInfo,
          },
          methods,
          gameState,
        };
        this.ws!.send(JSON.stringify(hello));
      });

      this.ws.on("message", (data) => {
        const msg = JSON.parse(data.toString()) as { type: string; studioId?: string };

        // 处理 welcome
        if (msg.type === "welcome" && msg.studioId) {
          this.studioId = msg.studioId;
          resolve(this.studioId);
          return;
        }

        // 检查是否有等待者
        const waiterIdx = this.messageWaiters.findIndex(
          (w) => w.type === msg.type,
        );
        if (waiterIdx >= 0) {
          const waiter = this.messageWaiters[waiterIdx];
          this.messageWaiters.splice(waiterIdx, 1);
          clearTimeout(waiter.timer);
          waiter.resolve(msg);
          return;
        }

        this.messageQueue.push(msg);
      });

      this.ws.on("error", reject);
    });
  }

  async waitForMessage(
    type: string,
    timeout = 2000,
  ): Promise<unknown> {
    // 先检查队列
    const idx = this.messageQueue.findIndex(
      (m) => (m as { type: string }).type === type,
    );
    if (idx >= 0) {
      const msg = this.messageQueue[idx];
      this.messageQueue.splice(idx, 1);
      return msg;
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => {
          const waiterIdx = this.messageWaiters.findIndex(
            (w) => w.type === type,
          );
          if (waiterIdx >= 0) this.messageWaiters.splice(waiterIdx, 1);
          reject(new Error(`Timeout waiting for "${type}" message`));
        },
        timeout,
      );

      this.messageWaiters.push({ type, resolve, timer });
    });
  }

  async sendResult(
    id: string,
    payload: { success: boolean; result?: unknown; error?: string },
  ): Promise<void> {
    this.ws!.send(
      JSON.stringify({ type: "result", id, payload }),
    );
  }

  async sendState(gameState: GameState): Promise<void> {
    this.ws!.send(
      JSON.stringify({ type: "state", gameState }),
    );
  }

  async disconnect(): Promise<void> {
    if (!this.ws) return;
    return new Promise((resolve) => {
      this.ws!.on("close", () => resolve());
      this.ws!.close();
      this.ws = null;
      this.studioId = null;
    });
  }

  getStudioId(): string | null {
    return this.studioId;
  }
}
