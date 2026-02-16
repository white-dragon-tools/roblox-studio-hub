import { WebSocketServer, type WebSocket } from "ws";
import type http from "http";
import type { StudioManager } from "../hub/StudioManager.js";
import {
  parseUpstreamMessage,
  serializeDownstreamMessage,
  type HelloMessage,
  type ResultMessage,
  type StateMessage,
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
}

export function createWsServer(deps: WsServerDeps): WebSocketServer {
  const { studioManager, pendingResults } = deps;

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
          // Phase 后续实现
          break;
      }
    });

    ws.on("close", () => {
      if (studioId) {
        studioManager.unregisterById(studioId);
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
