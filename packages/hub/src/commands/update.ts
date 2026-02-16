import { isServiceRunning, isInstalledAsService } from "../utils/serviceStatus.js";
import { handleServiceCommand } from "./service.js";

/**
 * hub update — 更新 Hub 到最新版本
 */
export async function updateHub(version: string): Promise<void> {
  const { spawn } = await import("child_process");

  console.log(`\n🔄 Roblox Studio Hub 更新\n`);
  console.log(`  当前版本: v${version}`);

  // 检查服务状态
  const wasRunning = await isServiceRunning();
  const wasInstalled = await isInstalledAsService();

  console.log(`  服务状态: ${wasRunning ? "运行中" : "未运行"}`);
  console.log("");

  try {
    // 如果服务在运行，先停止
    if (wasRunning && wasInstalled) {
      console.log("⏸️  停止服务...");
      await handleServiceCommand("stop");
      // 等待服务完全停止
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }

    // 执行 npm update
    console.log("📦 更新 npm 包...");

    const isWindows = process.platform === "win32";
    const npmCmd = isWindows ? "npm.cmd" : "npm";

    const updateProcess = spawn(
      npmCmd,
      ["update", "-g", "@white-dragon-tools/roblox-studio-hub"],
      {
        stdio: "inherit",
        shell: true,
      },
    );

    await new Promise<void>((resolve, reject) => {
      updateProcess.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`npm update 退出码: ${code}`));
        }
      });
      updateProcess.on("error", reject);
    });

    console.log("");
    console.log("✅ 更新完成！");

    // 如果之前服务在运行，重新启动
    if (wasRunning && wasInstalled) {
      console.log("");
      console.log("▶️  重新启动服务...");
      await handleServiceCommand("start");
    }

    // 提示更新插件
    console.log("");
    console.log("💡 提示: 如果插件有更新，请运行:");
    console.log("   roblox-studio-hub install-plugin");
    console.log("");
  } catch (err) {
    console.error("");
    console.error("❌ 更新失败:", (err as Error).message);

    // 尝试恢复服务
    if (wasRunning && wasInstalled) {
      console.log("");
      console.log("🔄 尝试恢复服务...");
      try {
        await handleServiceCommand("start");
      } catch {
        console.error("⚠️  服务恢复失败，请手动启动: roblox-studio-hub start");
      }
    }

    process.exit(1);
  }
}

export function showUpdateHelp(): void {
  console.log(`
Roblox Studio Hub - update 命令

用法: roblox-studio-hub update

描述:
  更新 Hub 到最新版本，自动处理服务重启

执行步骤:
  1. 检查当前服务状态
  2. 如果服务正在运行，先停止服务
  3. 执行 npm update -g @white-dragon-tools/roblox-studio-hub
  4. 如果之前服务在运行，重新启动服务
  5. 可选：更新 Studio 插件

注意:
  - Windows: 需要管理员权限运行
  - macOS/Linux: 需要使用 sudo 运行

示例:
  roblox-studio-hub update
`);
}
