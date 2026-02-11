#!/usr/bin/env node
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createHttpServer } from './server/httpServer.js';
import { isInstalledAsService, isServiceRunning } from './utils/serviceStatus.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.STUDIO_HUB_PORT || '35888', 10);

// 从 package.json 读取版本号
const packageJsonPath = path.join(__dirname, '..', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
const VERSION = packageJson.version;

const command = process.argv[2];

switch (command) {
  case 'serve':
    createHttpServer(PORT);
    break;
  case 'status':
    showStatus();
    break;
  case 'exec':
    execCommand();
    break;
  case 'install':
  case 'uninstall':
  case 'start':
  case 'stop':
    handleServiceCommand(command);
    break;
  case 'install-plugin':
    installPlugin();
    break;
  default:
    showHelp();
}

function showHelp(): void {
  console.log(`
Roblox Studio Hub v${VERSION}

用法: roblox-studio-hub <command>

命令:
  serve                        启动服务器（前台运行）
  status                       查看服务状态
  exec <studioId> <file> [-m]  执行 Lua 脚本
  install                      注册为系统服务（开机自启）
  uninstall                    卸载系统服务
  start                        启动系统服务
  stop                         停止系统服务
  install-plugin               安装 Roblox Studio 插件

exec 参数:
  studioId    目标 Studio ID（如 place:123456 或 local:MyGame）
  file        Lua 脚本文件路径
  -m, --mode  执行模式: eval（默认）、run、play

环境变量:
  STUDIO_HUB_PORT  服务端口（默认: 35888）

示例:
  roblox-studio-hub serve                          # 前台运行
  roblox-studio-hub exec place:123 script.lua     # 执行脚本
  roblox-studio-hub exec local:MyGame test.lua -m run
  roblox-studio-hub install                        # 注册为服务
  roblox-studio-hub install-plugin                 # 安装 Studio 插件
`);
}

async function showStatus(): Promise<void> {
  const installed = await isInstalledAsService();
  const httpRunning = await isServiceRunning();

  console.log(`
Roblox Studio Hub v${VERSION}

  已注册为服务: ${installed ? '✅ 是' : '❌ 否'}
  服务运行中:   ${httpRunning ? '✅ 是' : '❌ 否'} (端口 ${PORT})
  平台:         ${process.platform}
`);

  if (httpRunning && !installed) {
    console.log('  ⚠️  检测到服务在运行，但未注册为系统服务（可能是手动启动的 serve 命令）\n');
  }
}

async function getService(): Promise<any> {
  const platform = process.platform;
  let Service: any;

  if (platform === 'win32') {
    const mod = await import('node-windows');
    Service = mod.Service;
  } else if (platform === 'darwin') {
    const mod = await import('node-mac');
    Service = mod.Service;
  } else {
    const mod = await import('node-linux');
    Service = mod.Service;
  }

  return new Service({
    name: 'RobloxStudioHub',
    description: 'Roblox Studio Hub - WebSocket hub for managing multiple Roblox Studio instances',
    script: path.join(__dirname, 'index.js'),
    scriptOptions: 'serve',
    env: [{ name: 'STUDIO_HUB_PORT', value: String(PORT) }]
  });
}

async function handleServiceCommand(cmd: string): Promise<void> {
  const svc = await getService();

  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      console.log('⚠️ 操作超时');
      resolve();
    }, 30000);

    const done = () => {
      clearTimeout(timeout);
      resolve();
    };

    svc.on('error', (err: Error) => {
      clearTimeout(timeout);
      console.error('❌ 错误:', err.message);
      reject(err);
    });

    switch (cmd) {
      case 'install':
        svc.on('install', () => {
          console.log('✅ 服务已安装，正在启动...');
          svc.start();
        });
        svc.on('alreadyinstalled', () => {
          console.log('⚠️ 服务已存在');
          done();
        });
        svc.on('start', () => {
          console.log('✅ 服务已启动');
          done();
        });
        svc.install();
        break;

      case 'uninstall':
        svc.on('uninstall', () => {
          console.log('✅ 服务已卸载');
          done();
        });
        svc.uninstall();
        break;

      case 'start':
        svc.on('start', () => {
          console.log('✅ 服务已启动');
          done();
        });
        svc.start();
        break;

      case 'stop':
        svc.on('stop', () => {
          console.log('✅ 服务已停止');
          done();
        });
        svc.stop();
        break;
    }
  });
}

function getPluginsDir(): string {
  const platform = process.platform;
  
  if (platform === 'win32') {
    // Windows: %LOCALAPPDATA%\Roblox\Plugins\
    const localAppData = process.env.LOCALAPPDATA;
    if (!localAppData) {
      throw new Error('无法获取 LOCALAPPDATA 环境变量');
    }
    return path.join(localAppData, 'Roblox', 'Plugins');
  } else if (platform === 'darwin') {
    // macOS: ~/Documents/Roblox/Plugins/
    const home = process.env.HOME;
    if (!home) {
      throw new Error('无法获取 HOME 环境变量');
    }
    return path.join(home, 'Documents', 'Roblox', 'Plugins');
  } else {
    throw new Error(`不支持的平台: ${platform}`);
  }
}

function installPlugin(): void {
  const pluginSrc = path.join(__dirname, 'StudioHubPlugin.rbxm');
  
  // 检查插件文件是否存在
  if (!fs.existsSync(pluginSrc)) {
    console.error('❌ 插件文件不存在:', pluginSrc);
    console.error('   请确保已正确安装 @white-dragon-tools/roblox-studio-hub');
    process.exit(1);
  }
  
  try {
    const pluginsDir = getPluginsDir();
    
    // 确保插件目录存在
    if (!fs.existsSync(pluginsDir)) {
      fs.mkdirSync(pluginsDir, { recursive: true });
      console.log(`📁 创建插件目录: ${pluginsDir}`);
    }
    
    const pluginDest = path.join(pluginsDir, 'StudioHubPlugin.rbxm');
    
    // 复制插件文件
    fs.copyFileSync(pluginSrc, pluginDest);
    
    console.log(`
✅ Studio 插件安装成功！

  安装位置: ${pluginDest}

  下一步:
  1. 重启 Roblox Studio（如果已打开）
  2. 插件会自动连接到 Hub（端口 ${PORT}）
  3. 确保 Hub 服务正在运行: roblox-studio-hub status
`);
  } catch (err) {
    console.error('❌ 插件安装失败:', (err as Error).message);
    process.exit(1);
  }
}

async function execCommand(): Promise<void> {
  const studioId = process.argv[3];
  const filePath = process.argv[4];
  
  // 解析 mode 参数
  let mode: 'eval' | 'run' | 'play' = 'eval';
  const modeIndex = process.argv.indexOf('-m');
  const modeIndexLong = process.argv.indexOf('--mode');
  const modeArgIndex = modeIndex !== -1 ? modeIndex : modeIndexLong;
  if (modeArgIndex !== -1 && process.argv[modeArgIndex + 1]) {
    const modeArg = process.argv[modeArgIndex + 1];
    if (modeArg === 'eval' || modeArg === 'run' || modeArg === 'play') {
      mode = modeArg;
    } else {
      console.error(`❌ 无效的执行模式: ${modeArg}`);
      console.error('   有效模式: eval, run, play');
      process.exit(1);
    }
  }

  if (!studioId) {
    console.error('❌ 缺少 studioId 参数');
    console.error('   用法: roblox-studio-hub exec <studioId> <file> [-m mode]');
    process.exit(1);
  }

  if (!filePath) {
    console.error('❌ 缺少文件路径参数');
    console.error('   用法: roblox-studio-hub exec <studioId> <file> [-m mode]');
    process.exit(1);
  }

  // 解析文件路径
  const absolutePath = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  
  if (!fs.existsSync(absolutePath)) {
    console.error(`❌ 文件不存在: ${absolutePath}`);
    process.exit(1);
  }

  // 读取 Lua 代码
  const code = fs.readFileSync(absolutePath, 'utf-8');

  console.log(`📤 执行脚本: ${path.basename(absolutePath)}`);
  console.log(`   目标: ${studioId}`);
  console.log(`   模式: ${mode}`);
  console.log('');

  try {
    const response = await fetch(`http://localhost:${PORT}/api/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studioId, code, mode }),
    });

    const result = await response.json() as {
      success: boolean;
      result?: unknown;
      error?: string;
      errors?: { server?: string; client?: string };
      logs?: { server?: string[]; client?: string[] };
    };

    if (result.success) {
      console.log('✅ 执行成功');
      if (result.result !== undefined) {
        console.log('');
        console.log('返回值:');
        console.log(JSON.stringify(result.result, null, 2));
      }
      if (result.logs?.server?.length) {
        console.log('');
        console.log('服务端日志:');
        result.logs.server.forEach((log: string) => console.log(`  ${log}`));
      }
      if (result.logs?.client?.length) {
        console.log('');
        console.log('客户端日志:');
        result.logs.client.forEach((log: string) => console.log(`  ${log}`));
      }
    } else {
      console.error('❌ 执行失败');
      if (result.error) {
        console.error(`   ${result.error}`);
      }
      if (result.errors?.server) {
        console.error('');
        console.error('服务端错误:');
        console.error(`  ${result.errors.server}`);
      }
      if (result.errors?.client) {
        console.error('');
        console.error('客户端错误:');
        console.error(`  ${result.errors.client}`);
      }
      process.exit(1);
    }
  } catch (err) {
    console.error('❌ 请求失败:', (err as Error).message);
    console.error('   请确保 Studio Hub 服务正在运行');
    process.exit(1);
  }
}
