import type { StudioInfo, MethodDescriptor, GameState } from "../types.js";

// ==================== 上行消息（Studio → Hub）====================

export interface HelloMessage {
  type: "hello";
  studioInfo: StudioInfo;
  methods: MethodDescriptor[];
  gameState: GameState;
}

export interface ResultMessage {
  type: "result";
  id: string;
  payload: {
    success: boolean;
    result?: unknown;
    error?: string;
    runtimeLogs?: Array<{ level: string; message: string }>;
  };
}

export interface StateMessage {
  type: "state";
  gameState: GameState;
}

export interface NotifyMessage {
  type: "notify";
  event: string;
  data: unknown;
}

export interface PongMessage {
  type: "pong";
}

export type UpstreamMessage =
  | HelloMessage
  | ResultMessage
  | StateMessage
  | NotifyMessage
  | PongMessage;

// ==================== 下行消息（Hub → Studio）====================

export interface WelcomeMessage {
  type: "welcome";
  studioId: string;
}

export interface CommandMessage {
  type: "command";
  id: string;
  method: string;
  params: Record<string, unknown>;
}

export interface SubscribeMessage {
  type: "subscribe";
  event: string;
}

export interface UnsubscribeMessage {
  type: "unsubscribe";
  event: string;
}

export interface PingMessage {
  type: "ping";
}

export type DownstreamMessage =
  | WelcomeMessage
  | CommandMessage
  | SubscribeMessage
  | UnsubscribeMessage
  | PingMessage;

// ==================== 工具函数 ====================

const VALID_UPSTREAM_TYPES = new Set([
  "hello",
  "result",
  "state",
  "notify",
  "pong",
]);

/** 解析上行消息（Studio → Hub） */
export function parseUpstreamMessage(raw: string): UpstreamMessage {
  const parsed = JSON.parse(raw);

  if (!parsed.type) {
    throw new Error("missing type");
  }

  if (!VALID_UPSTREAM_TYPES.has(parsed.type)) {
    throw new Error(`unknown type: ${parsed.type}`);
  }

  return parsed as UpstreamMessage;
}

/** 序列化下行消息（Hub → Studio） */
export function serializeDownstreamMessage(msg: DownstreamMessage): string {
  return JSON.stringify(msg);
}

/** 检查方法在当前 gameState 下是否可用 */
export function isMethodAllowedForState(
  method: MethodDescriptor,
  gameState: GameState,
): boolean {
  const context = method.context ?? "both";
  if (context === "both") return true;
  return context === gameState;
}
