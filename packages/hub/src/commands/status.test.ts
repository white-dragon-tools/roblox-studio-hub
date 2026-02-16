import { describe, it, expect } from "vitest";
import { parseLogsLimit } from "./status.js";

describe("parseLogsLimit", () => {
  it("无 -n 参数时返回默认值 100", () => {
    expect(parseLogsLimit(["node", "hub", "logs", "local:Test"])).toBe(100);
  });

  it("-n 短参数解析 limit", () => {
    expect(
      parseLogsLimit(["node", "hub", "logs", "local:Test", "-n", "50"]),
    ).toBe(50);
  });

  it("--limit 长参数解析 limit", () => {
    expect(
      parseLogsLimit(["node", "hub", "logs", "local:Test", "--limit", "200"]),
    ).toBe(200);
  });

  it("非数字值时返回默认值 100", () => {
    expect(
      parseLogsLimit(["node", "hub", "logs", "local:Test", "-n", "abc"]),
    ).toBe(100);
  });

  it("负数时返回默认值 100", () => {
    expect(
      parseLogsLimit(["node", "hub", "logs", "local:Test", "-n", "-1"]),
    ).toBe(100);
  });
});
