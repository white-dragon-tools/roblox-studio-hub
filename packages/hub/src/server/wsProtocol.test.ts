import { describe, it, expect } from "vitest";
import {
  parseUpstreamMessage,
  serializeDownstreamMessage,
  isMethodAllowedForState,
  type UpstreamMessage,
  type DownstreamMessage,
} from "./wsProtocol.js";
import type { MethodDescriptor } from "../types.js";

// ==================== parseUpstreamMessage ====================

describe("parseUpstreamMessage", () => {
  it("应解析 hello 消息", () => {
    const raw = JSON.stringify({
      type: "hello",
      studioInfo: {
        placeId: 0,
        placeName: "TestPlace",
        gameId: 0,
        userId: 0,
      },
      methods: [
        {
          name: "execute",
          description: "Execute code",
          inputSchema: { type: "object", properties: {} },
          context: "both",
        },
      ],
      gameState: "edit",
    });

    const msg = parseUpstreamMessage(raw);
    expect(msg.type).toBe("hello");
    if (msg.type === "hello") {
      expect(msg.studioInfo.placeName).toBe("TestPlace");
      expect(msg.methods).toHaveLength(1);
      expect(msg.methods[0].context).toBe("both");
      expect(msg.gameState).toBe("edit");
    }
  });

  it("应解析 result 消息", () => {
    const raw = JSON.stringify({
      type: "result",
      id: "cmd-123",
      payload: { success: true, result: 42 },
    });

    const msg = parseUpstreamMessage(raw);
    expect(msg.type).toBe("result");
    if (msg.type === "result") {
      expect(msg.id).toBe("cmd-123");
      expect(msg.payload.success).toBe(true);
      expect(msg.payload.result).toBe(42);
    }
  });

  it("应解析 state 消息", () => {
    const raw = JSON.stringify({
      type: "state",
      gameState: "play",
    });

    const msg = parseUpstreamMessage(raw);
    expect(msg.type).toBe("state");
    if (msg.type === "state") {
      expect(msg.gameState).toBe("play");
    }
  });

  it("应解析 notify 消息", () => {
    const raw = JSON.stringify({
      type: "notify",
      event: "selection-changed",
      data: { count: 3 },
    });

    const msg = parseUpstreamMessage(raw);
    expect(msg.type).toBe("notify");
    if (msg.type === "notify") {
      expect(msg.event).toBe("selection-changed");
      expect(msg.data).toEqual({ count: 3 });
    }
  });

  it("应解析 pong 消息", () => {
    const raw = JSON.stringify({ type: "pong" });

    const msg = parseUpstreamMessage(raw);
    expect(msg.type).toBe("pong");
  });

  it("无效 JSON 应抛错", () => {
    expect(() => parseUpstreamMessage("not json")).toThrow();
  });

  it("缺少 type 字段应抛错", () => {
    expect(() => parseUpstreamMessage(JSON.stringify({}))).toThrow(
      "missing type",
    );
  });

  it("未知 type 应抛错", () => {
    expect(() =>
      parseUpstreamMessage(JSON.stringify({ type: "unknown" })),
    ).toThrow("unknown type");
  });
});

// ==================== serializeDownstreamMessage ====================

describe("serializeDownstreamMessage", () => {
  it("应序列化 welcome 消息", () => {
    const msg: DownstreamMessage = {
      type: "welcome",
      studioId: "local:TestPlace",
    };

    const raw = serializeDownstreamMessage(msg);
    const parsed = JSON.parse(raw);
    expect(parsed.type).toBe("welcome");
    expect(parsed.studioId).toBe("local:TestPlace");
  });

  it("应序列化 command 消息", () => {
    const msg: DownstreamMessage = {
      type: "command",
      id: "cmd-1",
      method: "execute",
      params: { code: "print('hi')" },
    };

    const raw = serializeDownstreamMessage(msg);
    const parsed = JSON.parse(raw);
    expect(parsed.type).toBe("command");
    expect(parsed.id).toBe("cmd-1");
    expect(parsed.method).toBe("execute");
    expect(parsed.params).toEqual({ code: "print('hi')" });
  });

  it("应序列化 subscribe 消息", () => {
    const msg: DownstreamMessage = {
      type: "subscribe",
      event: "selection-changed",
    };

    const raw = serializeDownstreamMessage(msg);
    const parsed = JSON.parse(raw);
    expect(parsed.type).toBe("subscribe");
    expect(parsed.event).toBe("selection-changed");
  });

  it("应序列化 unsubscribe 消息", () => {
    const msg: DownstreamMessage = {
      type: "unsubscribe",
      event: "selection-changed",
    };

    const raw = serializeDownstreamMessage(msg);
    const parsed = JSON.parse(raw);
    expect(parsed.type).toBe("unsubscribe");
  });

  it("应序列化 ping 消息", () => {
    const msg: DownstreamMessage = { type: "ping" };

    const raw = serializeDownstreamMessage(msg);
    const parsed = JSON.parse(raw);
    expect(parsed.type).toBe("ping");
  });
});

// ==================== isMethodAllowedForState ====================

describe("isMethodAllowedForState", () => {
  const makeMethod = (
    context?: "edit" | "play" | "both",
  ): MethodDescriptor => ({
    name: "test",
    description: "test",
    inputSchema: { type: "object", properties: {} },
    context,
  });

  it("context=both 应在 edit 和 play 状态都允许", () => {
    const method = makeMethod("both");
    expect(isMethodAllowedForState(method, "edit")).toBe(true);
    expect(isMethodAllowedForState(method, "play")).toBe(true);
  });

  it("context=edit 应只在 edit 状态允许", () => {
    const method = makeMethod("edit");
    expect(isMethodAllowedForState(method, "edit")).toBe(true);
    expect(isMethodAllowedForState(method, "play")).toBe(false);
  });

  it("context=play 应只在 play 状态允许", () => {
    const method = makeMethod("play");
    expect(isMethodAllowedForState(method, "edit")).toBe(false);
    expect(isMethodAllowedForState(method, "play")).toBe(true);
  });

  it("context 未定义时默认为 both", () => {
    const method = makeMethod(undefined);
    expect(isMethodAllowedForState(method, "edit")).toBe(true);
    expect(isMethodAllowedForState(method, "play")).toBe(true);
  });
});
