// Studio 信息（从插件注册时获取）
export interface StudioInfo {
  placeId: number;
  placeName: string;
  creatorName?: string;
  creatorType?: string;
  gameId: number;
  userId: number;
}

// Studio 实例
export interface StudioInstance {
  id: string;                    // "place:123456" 或 "local:MyGame"
  type: 'place' | 'local';
  placeId?: number;              // 云场景
  placeName: string;             // Place 名称 或 本地文件名
  creatorName?: string;          // 创建者名称（云场景）
  creatorType?: string;          // 创建者类型：User / Group
  gameId?: number;
  userId?: number;
  connectedAt: Date;
  lastHeartbeat: number;         // 最后心跳时间戳
  logs: LogEntry[];              // 日志历史
}

// 日志条目
export interface LogEntry {
  timestamp: number;
  source: string;
  level: string;
  message: string;
}

// HTTP API 响应
export interface StudioListResponse {
  studios: Array<{
    id: string;
    type: 'place' | 'local';
    placeId?: number;
    placeName: string;
    connectedAt: string;
    clientCount: number;
  }>;
}

export interface ExecuteRequest {
  studioId: string;
  code: string;
  mode?: 'eval' | 'run' | 'play';
  target?: string;
  timeout?: number;
}

export interface ExecuteResponse {
  success: boolean;
  result?: unknown;
  logs?: { server?: string[]; client?: string[] };
  errors?: { server?: string; client?: string };
}
