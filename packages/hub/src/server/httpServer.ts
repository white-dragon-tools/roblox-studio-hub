import express, { Request, Response } from "express";
import { createServer } from "http";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { v4 as uuidv4 } from "uuid";
import { studioManager as defaultStudioManager } from "../hub/StudioManager.js";
import type { StudioManager } from "../hub/StudioManager.js";
import {
  isInstalledAsService,
  isServiceRunning,
  isRunningAsService,
} from "../utils/serviceStatus.js";
import type {
  StudioListResponse,
  StudioInfo,
  StudioInstance,
} from "../types.js";
import {
  resolveFileParams,
  findToolDescriptor,
} from "../utils/fileResolver.js";
import { discoverPluginTools } from "../hub/pluginDiscovery.js";
import type { PluginToolDef } from "../hub/pluginTypes.js";
import { createWsServer } from "./wsServer.js";
import {
  serializeDownstreamMessage,
  isMethodAllowedForState,
} from "./wsProtocol.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 从 package.json 读取版本号
const packageJsonPath = path.join(__dirname, "..", "..", "package.json");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
const VERSION = packageJson.version;

// 待执行的命令队列（studioId -> commands）
export interface PendingCommand {
  id: string;
  type: string;
  params: unknown;
  createdAt: number;
}

// 等待结果的请求（requestId -> resolver）
interface PendingResult {
  resolve: (result: unknown) => void;
  timer: NodeJS.Timeout;
  runtimeLogs: Array<{ timestamp: number; level: string; message: string }>;
}

// UI 事件
interface UIEvent {
  type: string;
  data: unknown;
  timestamp: number;
}

export interface AppOptions {
  studioManager: StudioManager;
  pluginTools?: ReadonlyArray<PluginToolDef>;
  staticDir?: string;
}

export interface AppState {
  pendingCommands: Map<string, PendingCommand[]>;
  pendingResults: Map<string, PendingResult>;
}

/**
 * 创建 Express app（不启动监听）。
 * 可注入依赖，便于测试。
 */
export function createApp(options: AppOptions): {
  app: express.Express;
  state: AppState;
} {
  const { studioManager, pluginTools = [], staticDir } = options;

  const app = express();
  app.use(express.json());

  if (staticDir) {
    app.use(express.static(staticDir));
  }

  // === Internal state ===
  const pendingCommands: Map<string, PendingCommand[]> = new Map();
  const pendingResults: Map<string, PendingResult> = new Map();
  const uiEvents: UIEvent[] = [];
  const MAX_UI_EVENTS = 100;
  const waitingUIPolls: Set<Response> = new Set();

  function addUIEvent(type: string, data: unknown): void {
    const event: UIEvent = { type, data, timestamp: Date.now() };
    uiEvents.push(event);
    while (uiEvents.length > MAX_UI_EVENTS) {
      uiEvents.shift();
    }

    for (const res of waitingUIPolls) {
      try {
        res.json({ events: [event] });
      } catch (e) {
        // ignore
      }
    }
    waitingUIPolls.clear();
  }

  function sendCommandToStudio(
    studioId: string,
    command: PendingCommand,
  ): boolean {
    let queue = pendingCommands.get(studioId);
    if (!queue) {
      queue = [];
      pendingCommands.set(studioId, queue);
    }
    queue.push(command);
    return true;
  }

  function resolveStudio(id: string): StudioInstance | undefined {
    if (id.startsWith("place:"))
      return studioManager.getByPlaceId(parseInt(id.slice(6), 10));
    if (id.startsWith("local:"))
      return studioManager.getByPlaceName(id.slice(6));
    if (id.startsWith("path:"))
      return studioManager.getByLocalPath(id.slice(5));
    const placeId = parseInt(id, 10);
    if (!isNaN(placeId)) return studioManager.getByPlaceId(placeId);
    return studioManager.getByPlaceName(id);
  }

  function callStudio(
    studioId: string,
    method: string,
    params: unknown,
    timeout = 30,
  ): Promise<{
    success: boolean;
    result?: unknown;
    logs?: unknown;
    runtimeLogs?: unknown;
    errors?: unknown;
    error?: string;
  }> {
    return new Promise((resolve) => {
      const id = uuidv4();

      const timer = setTimeout(() => {
        const pending = pendingResults.get(id);
        if (pending) {
          resolve({
            success: false,
            error: "Execution timeout",
            runtimeLogs: pending.runtimeLogs,
          });
          pendingResults.delete(id);
        }
      }, timeout * 1000);

      pendingResults.set(id, {
        resolve: (result) =>
          resolve(
            result as typeof resolve extends (r: infer R) => void ? R : never,
          ),
        timer,
        runtimeLogs: [],
      });

      // WS 优先，HTTP 降级
      const ws = studioManager.getWs(studioId);
      if (ws && ws.readyState === 1) {
        ws.send(
          serializeDownstreamMessage({
            type: "command",
            id,
            method,
            params: (params ?? {}) as Record<string, unknown>,
          }),
        );
      } else {
        const command: PendingCommand = {
          id,
          type: method,
          params,
          createdAt: Date.now(),
        };
        sendCommandToStudio(studioId, command);
      }
    });
  }

  // ==================== Studio API ====================

  // Studio 短轮询获取命令（同时作为注册/心跳）
  app.post("/api/studio/poll", (req: Request, res: Response) => {
    const studioInfo = req.body.studioInfo as StudioInfo | undefined;

    if (!studioInfo) {
      res.status(400).json({ error: "studioInfo is required" });
      return;
    }

    if (!studioInfo.placeName) {
      res.status(400).json({ error: "placeName is required" });
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

    // 注册或更新 Studio
    let studio: StudioInstance | undefined = studioManager.get(studioId);

    if (!studio) {
      const newStudio = studioManager.register(studioInfo);
      if (newStudio) {
        studio = newStudio;
        console.log(`[HTTP] Studio registered via poll: ${studioId}`);

        addUIEvent("studio_connected", {
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
            clientCount: 0,
          },
        });
      }
    } else {
      studioManager.heartbeat(studioId, studioInfo);
    }

    // 检查是否有待处理的命令
    const queue = pendingCommands.get(studioId);
    if (queue && queue.length > 0) {
      const commands = queue.splice(0, queue.length);
      res.json({ studioId, commands });
      return;
    }

    // 短轮询：无待处理命令，立即返回空列表
    res.json({ studioId, commands: [] });
  });

  // Studio 返回执行结果
  app.post("/api/studio/result", (req: Request, res: Response) => {
    const { id, payload } = req.body as { id: string; payload: unknown };

    if (!id) {
      res.status(400).json({ error: "id is required" });
      return;
    }

    const pending = pendingResults.get(id);
    if (pending) {
      clearTimeout(pending.timer);
      pending.resolve({
        ...(payload as object),
        runtimeLogs: pending.runtimeLogs,
      });
      pendingResults.delete(id);
    }

    res.json({ success: true });
  });

  // ==================== Client API ====================

  // API: 获取所有 Studio 列表
  app.get("/api/studios", (_req: Request, res: Response) => {
    const studios = studioManager.getAll();
    const response: StudioListResponse = {
      studios: studios.map((s) => ({
        id: s.id,
        type: s.type,
        placeId: s.placeId,
        placeName: s.placeName,
        connectedAt: s.connectedAt.toISOString(),
        clientCount: 0,
      })),
    };
    res.json(response);
  });

  // API: 获取单个 Studio 详情
  app.get("/api/studios/:id", (req: Request, res: Response) => {
    const studio = resolveStudio(req.params.id);

    if (!studio) {
      res.status(404).json({ error: "Studio not found" });
      return;
    }

    res.json({
      id: studio.id,
      type: studio.type,
      placeId: studio.placeId,
      placeName: studio.placeName,
      gameId: studio.gameId,
      userId: studio.userId,
      gameState: studio.gameState,
      connectedAt: studio.connectedAt.toISOString(),
      clientCount: 0,
    });
  });

  // API: 获取 Studio 可用方法
  app.get("/api/studios/:id/methods", (req: Request, res: Response) => {
    const studio = resolveStudio(req.params.id);
    if (!studio) {
      res.status(404).json({ error: "Studio not found" });
      return;
    }
    res.json({ methods: studio.methods });
  });

  // API: 获取 Studio 日志
  app.get("/api/studios/:id/logs", (req: Request, res: Response) => {
    const studio = resolveStudio(req.params.id);
    if (!studio) {
      res.status(404).json({ error: "Studio not found" });
      return;
    }

    const limit = parseInt(req.query.limit as string, 10) || 100;
    const logs = studioManager.getLogs(studio.id, limit);
    res.json({ logs });
  });

  // API: 调用 Studio 方法（通用入口）
  app.post("/api/studios/:id/call", async (req: Request, res: Response) => {
    const {
      method,
      params,
      timeout = 30,
    } = req.body as { method: string; params: unknown; timeout?: number };

    if (!method) {
      res.status(400).json({ error: "method is required" });
      return;
    }

    const studio = resolveStudio(req.params.id);
    if (!studio) {
      res.status(404).json({ error: "Studio not found" });
      return;
    }

    const methodDescriptor = studio.methods.find((m) => m.name === method);
    if (!methodDescriptor) {
      res.status(400).json({ error: `Method not available: ${method}` });
      return;
    }

    // context 校验：method.context 必须匹配 studio.gameState
    if (!isMethodAllowedForState(methodDescriptor, studio.gameState)) {
      res.status(400).json({
        error: `Method "${method}" requires context "${methodDescriptor.context}", but studio is in "${studio.gameState}" state`,
      });
      return;
    }

    // x-file 参数解析：替换 file:// URI 为文件内容
    let resolvedParams = params;
    if (params && typeof params === "object") {
      const tool = findToolDescriptor(pluginTools, method);
      if (tool) {
        try {
          resolvedParams = resolveFileParams(
            params as Record<string, unknown>,
            tool,
          );
        } catch (e) {
          res
            .status(400)
            .json({ error: `文件参数解析失败: ${(e as Error).message}` });
          return;
        }
      }
    }

    try {
      const result = await callStudio(
        studio.id,
        method,
        resolvedParams,
        timeout,
      );
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // ==================== UI API ====================

  // UI 长轮询获取更新
  app.get("/api/ui/poll", (req: Request, res: Response) => {
    const since = parseInt(req.query.since as string, 10) || 0;
    const timeout = parseInt(req.query.timeout as string, 10) || 30;

    const newEvents = uiEvents.filter((e) => e.timestamp > since);
    if (newEvents.length > 0) {
      res.json({ events: newEvents });
      return;
    }

    waitingUIPolls.add(res);

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

    req.on("close", () => {
      clearTimeout(timer);
      waitingUIPolls.delete(res);
    });
  });

  // UI 初始化数据
  app.get("/api/ui/init", (_req: Request, res: Response) => {
    const studios = studioManager.getAll();
    res.json({
      studios: studios.map((s) => ({
        id: s.id,
        type: s.type,
        placeName: s.placeName,
        creatorName: s.creatorName,
        creatorType: s.creatorType,
        placeId: s.placeId,
        gameId: s.gameId,
        localPath: s.localPath,
        connectedAt: s.connectedAt.toISOString(),
        clientCount: 0,
      })),
    });
  });

  // API: 获取 Hub 状态
  app.get("/api/status", async (_req: Request, res: Response) => {
    const installed = await isInstalledAsService();
    const serviceRunning = await isServiceRunning();

    res.json({
      version: VERSION,
      uptime: process.uptime(),
      installedAsService: installed,
      serviceRunning,
      runningAsService: isRunningAsService(),
      platform: process.platform,
      nodeVersion: process.version,
    });
  });

  return { app, state: { pendingCommands, pendingResults } };
}

export function createHttpServer(port: number = 8080) {
  const { app, state } = createApp({
    studioManager: defaultStudioManager,
    pluginTools: discoverPluginTools(),
    staticDir: path.join(__dirname, "../../public"),
  });

  const server = createServer(app);

  // WebSocket server 挂载到 HTTP server
  createWsServer({
    httpServer: server,
    studioManager: defaultStudioManager,
    pendingResults: state.pendingResults,
  });

  server.listen(port, () => {
    console.log(`🐉 Roblox Studio Hub running at http://localhost:${port}`);
    console.log(`   Studio API:`);
    console.log(`   - POST /api/studio/poll (HTTP)`);
    console.log(`   - WebSocket ws://localhost:${port}`);
  });

  // 定期清理超时的 HTTP Studio（WS Studio 由 WS close 事件清理）
  // 短轮询间隔 2s，35s 无心跳视为离线
  setInterval(() => {
    const now = Date.now();
    const studios = defaultStudioManager.getAll();
    for (const studio of studios) {
      // 有 WS 连接的 Studio 不受 HTTP 心跳超时影响
      if (defaultStudioManager.hasWs(studio.id)) continue;
      if (now - studio.lastHeartbeat > 35000) {
        console.log(`[HTTP] Studio timeout, removing: ${studio.id}`);
        defaultStudioManager.unregisterById(studio.id);
        state.pendingCommands.delete(studio.id);
      }
    }
  }, 10000);

  return server;
}
