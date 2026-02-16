import { WebSocketServer, type WebSocket } from "ws";
import type http from "http";
import type { StudioManager } from "../hub/StudioManager.js";
import type { SubscriptionManager } from "../hub/subscriptionManager.js";
import {
  parseUpstreamMessage,
  serializeDownstreamMessage,
  type HelloMessage,
  type ResultMessage,
  type StateMessage,
  type NotifyMessage,
} from "./wsProtocol.js";

export interface WsServerDeps {
  httpServer: http.Server;
  studioManager: StudioManager;
  pendingResults: Map<
    string,
    {
      resolve: (result: unknown) => void;
      timer: ReturnType<typeof setTimeout>;
      runtimeLogs: unknown[];
    }
  >;
  subscriptionManager?: SubscriptionManager;
}

export function createWsServer(deps: WsServerDeps): WebSocketServer {
  const { studioManager, pendingResults, subscriptionManager } = deps;

  const wss = new WebSocketServer({ server: deps.httpServer });

  wss.on("connection", (ws: WebSocket) => {
    let studioId: string | null = null;

    ws.on("message", (data) => {
      let msg;
      try {
        msg = parseUpstreamMessage(data.toString());
      } catch {
        // 无效消息，忽略
        return;
      }

      if (msg.type === "hello") {
        studioId = handleHello(ws, msg, studioManager);
        return;
      }

      // 未完成握手，忽略其他消息
      if (!studioId) return;

      switch (msg.type) {
        case "result":
          handleResult(msg, pendingResults);
          break;
        case "state":
          handleState(studioId, msg, studioManager);
          break;
        case "pong":
          studioManager.heartbeat(studioId);
          break;
        case "notify":
          handleNotify(studioId, msg, subscriptionManager);
          break;
      }
    });

    ws.on("close", () => {
      if (studioId) {
        studioManager.unregisterById(studioId);
        subscriptionManager?.removeStudio(studioId);
        console.log(`[WS] Studio disconnected: ${studioId}`);
      }
    });
  });

  return wss;
}

function handleHello(
  ws: WebSocket,
  msg: HelloMessage,
  studioManager: StudioManager,
): string {
  const info = {
    ...msg.studioInfo,
    methods: msg.methods,
  };

  const instance = studioManager.register(info);
  const studioId = instance!.id;

  studioManager.updateGameState(studioId, msg.gameState);
  studioManager.setWs(studioId, ws);

  const welcome = serializeDownstreamMessage({
    type: "welcome",
    studioId,
  });
  ws.send(welcome);

  console.log(`[WS] Studio connected: ${studioId}`);
  return studioId;
}

function handleResult(
  msg: ResultMessage,
  pendingResults: Map<
    string,
    {
      resolve: (result: unknown) => void;
      timer: ReturnType<typeof setTimeout>;
      runtimeLogs: unknown[];
    }
  >,
): void {
  const pending = pendingResults.get(msg.id);
  if (!pending) return;

  clearTimeout(pending.timer);
  pending.resolve({
    ...msg.payload,
    runtimeLogs: pending.runtimeLogs,
  });
  pendingResults.delete(msg.id);
}

function handleState(
  studioId: string,
  msg: StateMessage,
  studioManager: StudioManager,
): void {
  studioManager.updateGameState(studioId, msg.gameState);
  console.log(`[WS] Studio ${studioId} gameState → ${msg.gameState}`);
}

function handleNotify(
  studioId: string,
  msg: NotifyMessage,
  subscriptionManager?: SubscriptionManager,
): void {
  if (!subscriptionManager) return;
  const count = subscriptionManager.dispatch(studioId, msg.event, msg.data);
  if (count > 0) {
    console.log(
      `[WS] Notification ${msg.event} from ${studioId} → ${count} subscriber(s)`,
    );
  }
}
