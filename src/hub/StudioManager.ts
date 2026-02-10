import type { StudioInstance, StudioInfo, LogEntry } from '../types.js';

const MAX_LOGS = 500;

export class StudioManager {
  private studios: Map<string, StudioInstance> = new Map();
  
  // 通过 placeId 查找（云场景）
  private placeIdIndex: Map<number, string> = new Map();
  
  // 通过 placeName 查找（本地文件）
  private placeNameIndex: Map<string, string> = new Map();

  /**
   * 生成 Studio ID
   */
  private generateId(info: StudioInfo): { id: string; type: 'place' | 'local' } {
    if (info.placeId > 0) {
      return { id: `place:${info.placeId}`, type: 'place' };
    }
    return { id: `local:${info.placeName}`, type: 'local' };
  }

  /**
   * 注册 Studio（HTTP 模式，无 WebSocket）
   */
  register(info: StudioInfo): StudioInstance | null {
    const { id, type } = this.generateId(info);
    
    const instance: StudioInstance = {
      id,
      type,
      placeId: info.placeId > 0 ? info.placeId : undefined,
      placeName: info.placeName,
      creatorName: info.creatorName,
      creatorType: info.creatorType,
      gameId: info.gameId > 0 ? info.gameId : undefined,
      userId: info.userId > 0 ? info.userId : undefined,
      connectedAt: new Date(),
      lastHeartbeat: Date.now(),
      logs: [],
    };

    this.studios.set(id, instance);
    
    // 更新索引
    if (type === 'place' && info.placeId > 0) {
      this.placeIdIndex.set(info.placeId, id);
    } else {
      this.placeNameIndex.set(info.placeName, id);
    }

    console.log(`[StudioManager] Registered: ${id}`);
    return instance;
  }

  /**
   * 通过 ID 注销 Studio
   */
  unregisterById(id: string): StudioInstance | null {
    const instance = this.studios.get(id);
    if (!instance) return null;
    
    // 清理索引
    if (instance.type === 'place' && instance.placeId) {
      this.placeIdIndex.delete(instance.placeId);
    } else {
      this.placeNameIndex.delete(instance.placeName);
    }
    
    this.studios.delete(id);
    console.log(`[StudioManager] Unregistered: ${id}`);
    return instance;
  }

  /**
   * 更新心跳时间
   */
  heartbeat(studioId: string): boolean {
    const studio = this.studios.get(studioId);
    if (!studio) return false;
    studio.lastHeartbeat = Date.now();
    return true;
  }

  /**
   * 通过 ID 获取 Studio
   */
  get(id: string): StudioInstance | undefined {
    return this.studios.get(id);
  }

  /**
   * 通过 placeId 获取 Studio
   */
  getByPlaceId(placeId: number): StudioInstance | undefined {
    const id = this.placeIdIndex.get(placeId);
    return id ? this.studios.get(id) : undefined;
  }

  /**
   * 通过 placeName 获取 Studio（本地文件）
   */
  getByPlaceName(placeName: string): StudioInstance | undefined {
    const id = this.placeNameIndex.get(placeName);
    return id ? this.studios.get(id) : undefined;
  }

  /**
   * 获取所有 Studio
   */
  getAll(): StudioInstance[] {
    return Array.from(this.studios.values());
  }

  /**
   * 添加日志
   */
  addLog(studioId: string, log: LogEntry): void {
    const studio = this.studios.get(studioId);
    if (!studio) return;
    
    studio.logs.push(log);
    if (studio.logs.length > MAX_LOGS) {
      studio.logs.shift();
    }
  }

  /**
   * 获取日志
   */
  getLogs(studioId: string, limit = 100): LogEntry[] {
    const studio = this.studios.get(studioId);
    if (!studio) return [];
    return studio.logs.slice(-limit);
  }
}

// 单例
export const studioManager = new StudioManager();
