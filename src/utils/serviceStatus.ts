import { exec } from 'child_process';
import { existsSync } from 'fs';
import { promisify } from 'util';
import http from 'http';

const execAsync = promisify(exec);

const SERVICE_NAME = 'robloxstudiohub.exe';
const DEFAULT_PORT = parseInt(process.env.STUDIO_HUB_PORT || '35888', 10);

/**
 * 检查是否已注册为系统服务
 */
export async function isInstalledAsService(): Promise<boolean> {
  const platform = process.platform;

  try {
    if (platform === 'win32') {
      // Windows: 查询服务注册表
      const { stdout } = await execAsync(`sc query ${SERVICE_NAME}`);
      return stdout.includes(SERVICE_NAME);
    } else if (platform === 'darwin') {
      // Mac: 检查 launchd plist 文件
      const plistPath = `${process.env.HOME}/Library/LaunchAgents/${SERVICE_NAME}.plist`;
      return existsSync(plistPath);
    } else {
      // Linux: 检查 systemd 服务
      const { stdout } = await execAsync(`systemctl list-unit-files | grep ${SERVICE_NAME}`);
      return stdout.length > 0;
    }
  } catch {
    return false;
  }
}

/**
 * 检查 Windows 服务是否正在运行
 */
export async function isWindowsServiceRunning(): Promise<boolean> {
  const platform = process.platform;

  try {
    if (platform === 'win32') {
      // Windows: 查询服务状态
      const { stdout } = await execAsync(`sc query ${SERVICE_NAME}`);
      return stdout.includes('RUNNING');
    } else if (platform === 'darwin') {
      // Mac: 检查 launchctl
      const { stdout } = await execAsync(`launchctl list | grep ${SERVICE_NAME}`);
      return stdout.length > 0;
    } else {
      // Linux: 检查 systemd 状态
      const { stdout } = await execAsync(`systemctl is-active ${SERVICE_NAME}`);
      return stdout.trim() === 'active';
    }
  } catch {
    return false;
  }
}

/**
 * 检查服务是否正在运行（通过 HTTP 请求检测）
 */
export async function isServiceRunning(port: number = DEFAULT_PORT): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.request(
      {
        hostname: 'localhost',
        port,
        path: '/api/studios',
        method: 'GET',
        timeout: 2000,
      },
      (res) => {
        resolve(res.statusCode === 200);
      }
    );

    req.on('error', () => {
      resolve(false);
    });

    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });

    req.end();
  });
}

/**
 * 检查当前进程是否作为服务运行
 */
export function isRunningAsService(): boolean {
  // 服务运行时通常没有 TTY
  return !process.stdout.isTTY;
}
