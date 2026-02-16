/**
 * 通知订阅管理器
 *
 * 管理客户端对 Studio 事件的订阅。
 * 当首个客户端订阅某事件时，通知 Studio 开始监听。
 * 当最后一个客户端取消订阅时，通知 Studio 停止监听。
 */

export type NotificationCallback = (
  studioId: string,
  event: string,
  data: unknown,
) => void;

export type StudioSubscribeAction = (
  studioId: string,
  event: string,
) => void;

interface SubscriptionEntry {
  readonly subscriberId: string;
  readonly callback: NotificationCallback;
}

export interface SubscriptionManagerOptions {
  /** 当 Studio 需要开始监听某事件时调用 */
  readonly onStudioSubscribe?: StudioSubscribeAction;
  /** 当 Studio 可以停止监听某事件时调用 */
  readonly onStudioUnsubscribe?: StudioSubscribeAction;
}

export class SubscriptionManager {
  // studioId → event → subscribers[]
  private readonly subscriptions: Map<string, Map<string, SubscriptionEntry[]>> =
    new Map();
  private readonly onStudioSubscribe: StudioSubscribeAction | undefined;
  private readonly onStudioUnsubscribe: StudioSubscribeAction | undefined;

  constructor(options: SubscriptionManagerOptions = {}) {
    this.onStudioSubscribe = options.onStudioSubscribe;
    this.onStudioUnsubscribe = options.onStudioUnsubscribe;
  }

  /**
   * 订阅 Studio 事件
   * @returns true 如果是该事件的首个订阅者（触发了 Studio subscribe）
   */
  subscribe(
    studioId: string,
    event: string,
    subscriberId: string,
    callback: NotificationCallback,
  ): boolean {
    let studioSubs = this.subscriptions.get(studioId);
    if (!studioSubs) {
      studioSubs = new Map();
      this.subscriptions.set(studioId, studioSubs);
    }

    let eventSubs = studioSubs.get(event);
    const isFirst = !eventSubs || eventSubs.length === 0;

    if (!eventSubs) {
      eventSubs = [];
      studioSubs.set(event, eventSubs);
    }

    // 防止重复订阅
    const existing = eventSubs.find((s) => s.subscriberId === subscriberId);
    if (existing) return false;

    eventSubs.push({ subscriberId, callback });

    // 首个订阅者 → 通知 Studio 开始监听
    if (isFirst && this.onStudioSubscribe) {
      this.onStudioSubscribe(studioId, event);
    }

    return isFirst;
  }

  /**
   * 取消订阅
   * @returns true 如果是该事件的最后一个订阅者（触发了 Studio unsubscribe）
   */
  unsubscribe(
    studioId: string,
    event: string,
    subscriberId: string,
  ): boolean {
    const studioSubs = this.subscriptions.get(studioId);
    if (!studioSubs) return false;

    const eventSubs = studioSubs.get(event);
    if (!eventSubs) return false;

    const idx = eventSubs.findIndex((s) => s.subscriberId === subscriberId);
    if (idx === -1) return false;

    eventSubs.splice(idx, 1);

    const isLast = eventSubs.length === 0;

    if (isLast) {
      studioSubs.delete(event);
      if (studioSubs.size === 0) {
        this.subscriptions.delete(studioId);
      }
      if (this.onStudioUnsubscribe) {
        this.onStudioUnsubscribe(studioId, event);
      }
    }

    return isLast;
  }

  /**
   * 分发通知给所有订阅者
   */
  dispatch(studioId: string, event: string, data: unknown): number {
    const studioSubs = this.subscriptions.get(studioId);
    if (!studioSubs) return 0;

    const eventSubs = studioSubs.get(event);
    if (!eventSubs || eventSubs.length === 0) return 0;

    for (const sub of eventSubs) {
      try {
        sub.callback(studioId, event, data);
      } catch {
        // 忽略回调错误
      }
    }

    return eventSubs.length;
  }

  /**
   * 清理某个 Studio 的所有订阅（Studio 断开连接时调用）
   */
  removeStudio(studioId: string): void {
    this.subscriptions.delete(studioId);
  }

  /**
   * 清理某个订阅者的所有订阅
   */
  removeSubscriber(subscriberId: string): void {
    for (const [studioId, studioSubs] of this.subscriptions) {
      for (const [event, eventSubs] of studioSubs) {
        const idx = eventSubs.findIndex(
          (s) => s.subscriberId === subscriberId,
        );
        if (idx !== -1) {
          eventSubs.splice(idx, 1);
          if (eventSubs.length === 0) {
            studioSubs.delete(event);
            if (this.onStudioUnsubscribe) {
              this.onStudioUnsubscribe(studioId, event);
            }
          }
        }
      }
      if (studioSubs.size === 0) {
        this.subscriptions.delete(studioId);
      }
    }
  }

  /**
   * 获取某 Studio 某事件的订阅者数量
   */
  getSubscriberCount(studioId: string, event: string): number {
    const studioSubs = this.subscriptions.get(studioId);
    if (!studioSubs) return 0;
    const eventSubs = studioSubs.get(event);
    return eventSubs?.length ?? 0;
  }

  /**
   * 获取某 Studio 的所有订阅事件
   */
  getSubscribedEvents(studioId: string): readonly string[] {
    const studioSubs = this.subscriptions.get(studioId);
    if (!studioSubs) return [];
    return Array.from(studioSubs.keys());
  }
}
