import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.STUDIO_HUB_PORT || "35888", 10);

/**
 * 获取平台对应的 Service 实例
 */
async function getService(): Promise<any> {
  const platform = process.platform;
  let Service: any;

  if (platform === "win32") {
    const mod = await import("node-windows");
    Service = mod.Service;
  } else if (platform === "darwin") {
    const mod = await import("node-mac");
    Service = mod.Service;
  } else {
    const mod = await import("node-linux");
    Service = mod.Service;
  }

  return new Service({
    name: "RobloxStudioHub",
    description:
      "Roblox Studio Hub - WebSocket hub for managing multiple Roblox Studio instances",
    script: path.join(__dirname, "..", "index.js"),
    scriptOptions: "serve",
    env: [{ name: "STUDIO_HUB_PORT", value: String(PORT) }],
  });
}

/**
 * hub install / uninstall / start / stop — 管理系统服务
 */
export async function handleServiceCommand(cmd: string): Promise<void> {
  const svc = await getService();

  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      console.log("⚠️ 操作超时");
      resolve();
    }, 30000);

    const done = () => {
      clearTimeout(timeout);
      resolve();
    };

    svc.on("error", (err: Error) => {
      clearTimeout(timeout);
      console.error("❌ 错误:", err.message);
      reject(err);
    });

    switch (cmd) {
      case "install":
        svc.on("install", () => {
          console.log("✅ 服务已安装，正在启动...");
          svc.start();
        });
        svc.on("alreadyinstalled", () => {
          console.log("⚠️ 服务已存在");
          done();
        });
        svc.on("start", () => {
          console.log("✅ 服务已启动");
          done();
        });
        svc.install();
        break;

      case "uninstall":
        svc.on("uninstall", () => {
          console.log("✅ 服务已卸载");
          done();
        });
        svc.uninstall();
        break;

      case "start":
        svc.on("start", () => {
          console.log("✅ 服务已启动");
          done();
        });
        svc.start();
        break;

      case "stop":
        svc.on("stop", () => {
          console.log("✅ 服务已停止");
          done();
        });
        svc.stop();
        break;
    }
  });
}

export function showServiceHelp(cmd: string): void {
  const descriptions: Record<string, string> = {
    install: "将 Hub 注册为系统服务，实现开机自启动",
    uninstall: "从系统中卸载 Hub 服务",
    start: "启动已注册的 Hub 系统服务",
    stop: "停止正在运行的 Hub 系统服务",
  };

  console.log(`
Roblox Studio Hub - ${cmd} 命令

用法: roblox-studio-hub ${cmd}

描述:
  ${descriptions[cmd]}

注意:
  - Windows: 需要管理员权限运行
  - macOS/Linux: 需要使用 sudo 运行

示例:
  roblox-studio-hub ${cmd}
`);
}
