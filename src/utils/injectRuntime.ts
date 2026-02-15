import path from "path";
import fs from "fs";
import os from "os";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 注入 Hub Runtime 到 .rbxl 文件
 * 使用 rojo-injectable build --merge 将 Runtime + plugins 注入到 ReplicatedStorage
 */
export async function injectRuntime(placePath: string): Promise<void> {
  const runtimeSrcPath = path.join(__dirname, "..", "..", "runtime", "src");
  const pluginsPath = path.join(
    os.homedir(),
    ".roblox-studio-hub",
    "plugins",
  );

  // Ensure plugins directory exists
  fs.mkdirSync(pluginsPath, { recursive: true });

  // Generate temporary project.json for Rojo
  const projectJson = {
    name: "StudioHubRuntime",
    tree: {
      $className: "DataModel",
      ReplicatedStorage: {
        $className: "ReplicatedStorage",
        __HubRuntime__: {
          $path: runtimeSrcPath,
          plugins: {
            $path: pluginsPath,
          },
        },
      },
    },
  };

  const tmpProjectJsonPath = path.join(
    os.tmpdir(),
    `hub-runtime-${Date.now()}.project.json`,
  );

  try {
    fs.writeFileSync(tmpProjectJsonPath, JSON.stringify(projectJson, null, 2));

    // TODO: 发布 rojo-injectable 后改为 npm 包路径
    const ROJO_INJECTABLE_BIN = path.join(
      os.homedir(),
      "workspace/yoyo999888/rojo-injectable/master-rojo-injectable/target/release/rojo",
    );

    if (!fs.existsSync(ROJO_INJECTABLE_BIN)) {
      throw new Error(
        `rojo-injectable 二进制不存在: ${ROJO_INJECTABLE_BIN}\n请先编译: cargo build --release`,
      );
    }

    const { execFileSync } = await import("child_process");
    try {
      execFileSync(
        ROJO_INJECTABLE_BIN,
        [
          "build",
          tmpProjectJsonPath,
          "--merge",
          placePath,
          "--output",
          placePath,
        ],
        { stdio: "pipe" },
      );
    } catch (e) {
      const stderr =
        (e as { stderr?: Buffer }).stderr?.toString() ||
        (e as Error).message;
      throw new Error(`注入失败: ${stderr}`);
    }
  } finally {
    try {
      fs.unlinkSync(tmpProjectJsonPath);
    } catch {
      // ignore cleanup errors
    }
  }
}
