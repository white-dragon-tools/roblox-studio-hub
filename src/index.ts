#!/usr/bin/env node
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { createHttpServer } from './server/httpServer.js';
import { isInstalledAsService, isServiceRunning } from './utils/serviceStatus.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.STUDIO_HUB_PORT || '35888', 10);
const VERSION = '1.0.0';

const command = process.argv[2];

switch (command) {
  case 'serve':
    createHttpServer(PORT);
    break;
  case 'status':
    showStatus();
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
  serve          启动服务器（前台运行）
  status         查看服务状态
  install        注册为系统服务（开机自启）
  uninstall      卸载系统服务
  start          启动系统服务
  stop           停止系统服务
  install-plugin 安装 Roblox Studio 插件

环境变量:
  STUDIO_HUB_PORT  服务端口（默认: 35888）

示例:
  roblox-studio-hub serve              # 前台运行
  roblox-studio-hub install            # 注册为服务
  roblox-studio-hub install-plugin     # 安装 Studio 插件
  STUDIO_HUB_PORT=8080 roblox-studio-hub serve
`);
}

async function showStatus(): Promise<void> {
  const installed = await isInstalledAsService();
  const running = await isServiceRunning();

  console.log(`
Roblox Studio Hub v${VERSION}

  已注册为服务: ${installed ? '✅ 是' : '❌ 否'}
  服务运行中:   ${running ? '✅ 是' : '❌ 否'}
  平台:         ${process.platform}
  端口:         ${PORT}
`);
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
    env: [{ name: 'STUDIO_HUB_PORT', value: String(PORT) }]
  });
}

async function handleServiceCommand(cmd: string): Promise<void> {
  const svc = await getService();

  switch (cmd) {
    case 'install':
      svc.on('install', () => {
        console.log('✅ 服务已安装，正在启动...');
        svc.start();
      });
      svc.on('alreadyinstalled', () => {
        console.log('⚠️ 服务已存在');
      });
      svc.on('start', () => {
        console.log('✅ 服务已启动');
      });
      svc.install();
      break;

    case 'uninstall':
      svc.on('uninstall', () => {
        console.log('✅ 服务已卸载');
      });
      svc.uninstall();
      break;

    case 'start':
      svc.on('start', () => {
        console.log('✅ 服务已启动');
      });
      svc.start();
      break;

    case 'stop':
      svc.on('stop', () => {
        console.log('✅ 服务已停止');
      });
      svc.stop();
      break;
  }
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
