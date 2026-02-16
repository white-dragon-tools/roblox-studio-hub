import { describe, it, expect } from "vitest";
import { formatDuration } from "./formatDuration.js";

describe("formatDuration", () => {
  it("0 ms 返回 '0 秒'", () => {
    expect(formatDuration(0)).toBe("0 秒");
  });

  it("5000 ms 返回 '5 秒'", () => {
    expect(formatDuration(5000)).toBe("5 秒");
  });

  it("60000 ms 返回 '1 分钟'", () => {
    expect(formatDuration(60000)).toBe("1 分钟");
  });

  it("90000 ms (90秒) floor 到 '1 分钟'", () => {
    expect(formatDuration(90000)).toBe("1 分钟");
  });

  it("3600000 ms 返回 '1 小时 0 分钟'", () => {
    expect(formatDuration(3600000)).toBe("1 小时 0 分钟");
  });

  it("3660000 ms 返回 '1 小时 1 分钟'", () => {
    expect(formatDuration(3660000)).toBe("1 小时 1 分钟");
  });

  it("86400000 ms 返回 '1 天 0 小时'", () => {
    expect(formatDuration(86400000)).toBe("1 天 0 小时");
  });

  it("90000000 ms 返回 '1 天 1 小时'", () => {
    expect(formatDuration(90000000)).toBe("1 天 1 小时");
  });
});
