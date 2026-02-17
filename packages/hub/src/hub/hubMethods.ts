import { execFile } from "child_process";
import { promisify } from "util";
import type { StudioInstance } from "../types.js";

const execFileAsync = promisify(execFile);

/**
 * Hub-side 方法执行结果
 */
export interface HubMethodResult {
  readonly success: boolean;
  readonly result?: unknown;
  readonly error?: string;
}

/**
 * Hub-side 方法定义：不转发到 Studio，由 Hub 直接处理
 */
const HUB_METHODS = new Set(["startGame", "stopGame"]);

/**
 * 检查方法是否为 Hub-side 方法
 */
export function isHubMethod(methodName: string): boolean {
  return HUB_METHODS.has(methodName);
}

/**
 * 执行 Hub-side 方法
 * 通过 rspo CLI 物理操作控制 Studio
 */
export async function executeHubMethod(
  methodName: string,
  _params: Record<string, unknown>,
  studio: StudioInstance,
): Promise<HubMethodResult> {
  if (!studio.localPath) {
    return {
      success: false,
      error: "Studio has no localPath, cannot perform physical operations",
    };
  }

  switch (methodName) {
    case "startGame":
      return rspoGameControl(studio.localPath, "start");
    case "stopGame":
      return rspoGameControl(studio.localPath, "stop");
    default:
      return { success: false, error: `Unknown hub method: ${methodName}` };
  }
}

/**
 * 通过 rspo CLI 控制游戏 start/stop
 */
async function rspoGameControl(
  placePath: string,
  action: "start" | "stop",
): Promise<HubMethodResult> {
  try {
    const { stdout } = await execFileAsync(
      "npx",
      ["rspo", "game", action, placePath],
      { timeout: 90_000 },
    );

    const result = JSON.parse(stdout) as {
      success: boolean;
      message: string;
    };
    return {
      success: result.success,
      result: result.message,
      error: result.success ? undefined : result.message,
    };
  } catch (err) {
    return {
      success: false,
      error: `${action}Game failed: ${(err as Error).message}`,
    };
  }
}
