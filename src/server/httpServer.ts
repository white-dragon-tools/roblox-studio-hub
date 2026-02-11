import express, { Request, Response } from 'express';
import { createServer } from 'http';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { v4 as uuidv4 } from 'uuid';
import { studioManager } from '../hub/StudioManager.js';
import { isInstalledAsService, isServiceRunning, isRunningAsService } from '../utils/serviceStatus.js';
import type { ExecuteRequest, StudioListResponse, StudioInfo, LogEntry, StudioInstance } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 从 package.json 读取版本号
const packageJsonPath = path.join(__dirname, '..', '..', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
const VERSION = packageJson.version;

// 待执行的命令队列（studioId -> commands）
interface PendingCommand {
  id: string;
  type: string;
  payload: unknown;
  createdAt: number;
}
const pendingCommands: Map<string, PendingCommand[]> = new Map();

// 等待结果的请求（requestId -> resolver）
interface PendingResult {
  resolve: (result: unknown) => void;
  timer: NodeJS.Timeout;
  runtimeLogs: Array<{ timestamp: number; level: string; message: string }>;
}
const pendingResults: Map<string, PendingResult> = new Map();

// 等待轮询的 Studio 请求（studioId -> response）
const waitingPolls: Map<string, Response> = new Map();

// UI 事件队列
interface UIEvent {
  type: string;
  data: unknown;
  timestamp: number;
}
const uiEvents: UIEvent[] = [];
const MAX_UI_EVENTS = 100;

// 等待轮询的 UI 请求
const waitingUIPolls: Set<Response> = new Set();

// 添加 UI 事件
function addUIEvent(type: string, data: unknown): void {
  const event: UIEvent = { type, data, timestamp: Date.now() };
  uiEvents.push(event);
  while (uiEvents.length > MAX_UI_EVENTS) {
    uiEvents.shift();
  }
  
  // 通知所有等待的 UI 轮询
  for (const res of waitingUIPolls) {
    try {
      res.json({ events: [event] });
    } catch (e) {
      // ignore
    }
  }
  waitingUIPolls.clear();
}

// 向 Studio 发送命令
function sendCommandToStudio(studioId: string, command: PendingCommand): boolean {
  // 检查是否有等待的轮询请求
  const waitingRes = waitingPolls.get(studioId);
  if (waitingRes) {
    try {
      waitingRes.json({ commands: [command] });
      waitingPolls.delete(studioId);
      return true;
    } catch (e) {
      waitingPolls.delete(studioId);
    }
  }
  
  // 否则加入队列
  let queue = pendingCommands.get(studioId);
  if (!queue) {
    queue = [];
    pendingCommands.set(studioId, queue);
  }
  queue.push(command);
  return true;
}

export function createHttpServer(port: number = 8080) {
  const app = express();
  const server = createServer(app);

  // 中间件
  app.use(express.json());
  
  // 静态文件（Web UI）
  app.use(express.static(path.join(__dirname, '../../public')));

  // ==================== Studio API ====================

  // Studio 长轮询获取命令（同时作为注册/心跳）
  app.get('/api/studio/poll', (req: Request, res: Response) => {
    const studioInfoStr = req.query.studioInfo as string;
    const timeout = parseInt(req.query.timeout as string, 10) || 30;
    
    if (!studioInfoStr) {
      res.status(400).json({ error: 'studioInfo is required' });
      return;
    }

    let studioInfo: StudioInfo;
    try {
      studioInfo = JSON.parse(studioInfoStr);
    } catch (e) {
      res.status(400).json({ error: 'Invalid studioInfo JSON' });
      return;
    }

    if (!studioInfo.placeName) {
      res.status(400).json({ error: 'placeName is required' });
      return;
    }

    // 生成 studioId
    let studioId: string;
    if (studioInfo.placeId > 0) {
      studioId = `place:${studioInfo.placeId}`;
    } else if (studioInfo.localPath) {
      studioId = `path:${studioInfo.localPath}`;
    } else {
      studioId = `local:${studioInfo.placeName}`;
    }

    // 检查是否有旧的轮询请求（同一个 Studio 的新请求会踢掉旧请求）
    const existingPoll = waitingPolls.get(studioId);
    if (existingPoll && existingPoll !== res) {
      console.log(`[HTTP] New poll replacing old poll: ${studioId}`);
      try {
        existingPoll.json({ studioId, commands: [{ type: 'disconnect', reason: 'Replaced by new connection' }] });
      } catch (e) {
        // ignore
      }
      waitingPolls.delete(studioId);
    }

    // 注册或更新 Studio
    let studio: StudioInstance | undefined = studioManager.get(studioId);
    
    if (!studio) {
      const newStudio = studioManager.register(studioInfo);
      if (newStudio) {
        studio = newStudio;
        console.log(`[HTTP] Studio registered via poll: ${studioId}`);
        
        // 通知 UI
        addUIEvent('studio_connected', {
          studio: {
            id: studio.id,
            type: studio.type,
            placeName: studio.placeName,
            creatorName: studio.creatorName,
            creatorType: studio.creatorType,
            placeId: studio.placeId,
            gameId: studio.gameId,
            localPath: studio.localPath,
            connectedAt: studio.connectedAt.toISOString(),
            clientCount: 0
          }
        });
      }
    } else {
      // 更新心跳
      studioManager.heartbeat(studioId);
    }

    // 检查是否有待处理的命令
    const queue = pendingCommands.get(studioId);
    if (queue && queue.length > 0) {
      const commands = queue.splice(0, queue.length);
      res.json({ studioId, commands });
      return;
    }

    // 等待新命令
    waitingPolls.set(studioId, res);

    // 设置超时
    const timer = setTimeout(() => {
      if (waitingPolls.get(studioId) === res) {
        waitingPolls.delete(studioId);
        try {
          res.json({ studioId, commands: [] });
        } catch (e) {
          // ignore
        }
      }
    }, timeout * 1000);

    // 请求关闭时清理
    req.on('close', () => {
      clearTimeout(timer);
      if (waitingPolls.get(studioId) === res) {
        waitingPolls.delete(studioId);
      }
    });
  });

  // Studio 返回执行结果
  app.post('/api/studio/result', (req: Request, res: Response) => {
    const { id, payload } = req.body as { id: string; payload: unknown };
    
    if (!id) {
      res.status(400).json({ error: 'id is required' });
      return;
    }

    const pending = pendingResults.get(id);
    if (pending) {
      clearTimeout(pending.timer);
      pending.resolve({
        ...payload as object,
        runtimeLogs: pending.runtimeLogs
      });
      pendingResults.delete(id);
    }

    res.json({ success: true });
  });



  // ==================== Client API ====================

  // API: 获取所有 Studio 列表
  app.get('/api/studios', (_req: Request, res: Response) => {
    const studios = studioManager.getAll();
    const response: StudioListResponse = {
      studios: studios.map(s => ({
        id: s.id,
        type: s.type,
        placeId: s.placeId,
        placeName: s.placeName,
        connectedAt: s.connectedAt.toISOString(),
        clientCount: 0
      }))
    };
    res.json(response);
  });

  // API: 获取单个 Studio 详情
  app.get('/api/studios/:id', (req: Request, res: Response) => {
    const { id } = req.params;
    
    // 解析 ID: "place:123" 或 "local:name"
    let studio;
    if (id.startsWith('place:')) {
      const placeId = parseInt(id.slice(6), 10);
      studio = studioManager.getByPlaceId(placeId);
    } else if (id.startsWith('local:')) {
      const placeName = id.slice(6);
      studio = studioManager.getByPlaceName(placeName);
    } else {
      studio = studioManager.get(id);
    }

    if (!studio) {
      res.status(404).json({ error: 'Studio not found' });
      return;
    }

    res.json({
      id: studio.id,
      type: studio.type,
      placeId: studio.placeId,
      placeName: studio.placeName,
      gameId: studio.gameId,
      userId: studio.userId,
      connectedAt: studio.connectedAt.toISOString(),
      clientCount: 0
    });
  });

  // API: 获取 Studio 日志
  app.get('/api/studios/:id/logs', (req: Request, res: Response) => {
    const { id } = req.params;
    const limit = parseInt(req.query.limit as string, 10) || 100;

    let studioId = id;
    if (!id.includes(':')) {
      const placeId = parseInt(id, 10);
      if (!isNaN(placeId)) {
        studioId = `place:${placeId}`;
      } else {
        studioId = `local:${id}`;
      }
    }

    const logs = studioManager.getLogs(studioId, limit);
    res.json({ logs });
  });

  // API: 执行代码
  app.post('/api/execute', async (req: Request, res: Response) => {
    const { studioId, code, mode = 'eval', timeout = 30 } = req.body as ExecuteRequest;

    if (!studioId) {
      res.status(400).json({ error: 'studioId is required' });
      return;
    }

    if (!code) {
      res.status(400).json({ error: 'code is required' });
      return;
    }

    // 解析 studioId
    let resolvedId = studioId;
    if (!studioId.includes(':')) {
      const placeId = parseInt(studioId, 10);
      if (!isNaN(placeId)) {
        resolvedId = `place:${placeId}`;
      } else {
        resolvedId = `local:${studioId}`;
      }
    }

    const studio = studioManager.get(resolvedId);
    if (!studio) {
      res.status(404).json({ error: `Studio not found: ${resolvedId}` });
      return;
    }

    try {
      const result = await executeOnStudio(resolvedId, code, mode, timeout);
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // ==================== UI API ====================

  // UI 长轮询获取更新
  app.get('/api/ui/poll', (req: Request, res: Response) => {
    const since = parseInt(req.query.since as string, 10) || 0;
    const timeout = parseInt(req.query.timeout as string, 10) || 30;

    // 检查是否有新事件
    const newEvents = uiEvents.filter(e => e.timestamp > since);
    if (newEvents.length > 0) {
      res.json({ events: newEvents });
      return;
    }

    // 等待新事件
    waitingUIPolls.add(res);

    // 设置超时
    const timer = setTimeout(() => {
      if (waitingUIPolls.has(res)) {
        waitingUIPolls.delete(res);
        try {
          res.json({ events: [] });
        } catch (e) {
          // ignore
        }
      }
    }, timeout * 1000);

    // 请求关闭时清理
    req.on('close', () => {
      clearTimeout(timer);
      waitingUIPolls.delete(res);
    });
  });

  // UI 初始化数据
  app.get('/api/ui/init', (_req: Request, res: Response) => {
    const studios = studioManager.getAll();
    res.json({
      studios: studios.map(s => ({
        id: s.id,
        type: s.type,
        placeName: s.placeName,
        creatorName: s.creatorName,
        creatorType: s.creatorType,
        placeId: s.placeId,
        gameId: s.gameId,
        localPath: s.localPath,
        connectedAt: s.connectedAt.toISOString(),
        clientCount: 0
      }))
    });
  });

  // API: 获取 Hub 状态
  app.get('/api/status', async (_req: Request, res: Response) => {
    const installed = await isInstalledAsService();
    const serviceRunning = await isServiceRunning();
    
    res.json({
      version: VERSION,
      port,
      uptime: process.uptime(),
      installedAsService: installed,
      serviceRunning,
      runningAsService: isRunningAsService(),
      platform: process.platform,
      nodeVersion: process.version
    });
  });

  // 启动服务器
  server.listen(port, () => {
    console.log(`🐉 Roblox Studio Hub running at http://localhost:${port}`);
    console.log(`   Studio API:`);
    console.log(`   - GET  /api/studio/poll?studioInfo=JSON`);
    console.log(`   - POST /api/studio/result`);
    console.log(`   - POST /api/studio/log`);
  });

  // 定期清理超时的 Studio（35秒无心跳）
  setInterval(() => {
    const now = Date.now();
    const studios = studioManager.getAll();
    for (const studio of studios) {
      if (now - studio.lastHeartbeat > 35000) {
        console.log(`[HTTP] Studio timeout, removing: ${studio.id}`);
        studioManager.unregisterById(studio.id);
        pendingCommands.delete(studio.id);
        waitingPolls.delete(studio.id);
        addUIEvent('studio_disconnected', { studioId: studio.id });
      }
    }
  }, 10000);

  return server;
}

// 向 Studio 发送执行命令
function executeOnStudio(
  studioId: string,
  code: string,
  mode: 'eval' | 'run' | 'play' = 'eval',
  timeout = 30
): Promise<{ success: boolean; result?: unknown; logs?: unknown; runtimeLogs?: unknown; errors?: unknown; error?: string }> {
  return new Promise((resolve) => {
    const id = uuidv4();
    const command: PendingCommand = {
      id,
      type: 'execute',
      payload: { code, mode, timeout },
      createdAt: Date.now()
    };

    // 设置超时
    const timer = setTimeout(() => {
      const pending = pendingResults.get(id);
      if (pending) {
        resolve({ success: false, error: 'Execution timeout', runtimeLogs: pending.runtimeLogs });
        pendingResults.delete(id);
      }
    }, timeout * 1000);

    // 注册等待结果
    pendingResults.set(id, {
      resolve: (result) => resolve(result as typeof resolve extends (r: infer R) => void ? R : never),
      timer,
      runtimeLogs: []
    });

    // 发送命令
    sendCommandToStudio(studioId, command);
  });
}
