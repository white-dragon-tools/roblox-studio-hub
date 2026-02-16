import { describe, it, expect, vi } from "vitest";
import {
  SubscriptionManager,
  type NotificationCallback,
  type StudioSubscribeAction,
} from "./subscriptionManager.js";

describe("SubscriptionManager", () => {
  describe("subscribe()", () => {
    it("第一个订阅者触发 onStudioSubscribe 回调并返回 true", () => {
      const onStudioSubscribe = vi.fn();
      const manager = new SubscriptionManager({ onStudioSubscribe });
      const callback = vi.fn();

      const result = manager.subscribe("studio1", "event1", "sub1", callback);

      expect(result).toBe(true);
      expect(onStudioSubscribe).toHaveBeenCalledOnce();
      expect(onStudioSubscribe).toHaveBeenCalledWith("studio1", "event1");
    });

    it("第二个订阅者不触发 onStudioSubscribe，返回 false", () => {
      const onStudioSubscribe = vi.fn();
      const manager = new SubscriptionManager({ onStudioSubscribe });
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      manager.subscribe("studio1", "event1", "sub1", callback1);
      onStudioSubscribe.mockClear();
      const result = manager.subscribe("studio1", "event1", "sub2", callback2);

      expect(result).toBe(false);
      expect(onStudioSubscribe).not.toHaveBeenCalled();
    });

    it("同一 studio 不同事件各自触发 onStudioSubscribe", () => {
      const onStudioSubscribe = vi.fn();
      const manager = new SubscriptionManager({ onStudioSubscribe });
      const callback = vi.fn();

      manager.subscribe("studio1", "event1", "sub1", callback);
      manager.subscribe("studio1", "event2", "sub2", callback);

      expect(onStudioSubscribe).toHaveBeenCalledTimes(2);
      expect(onStudioSubscribe).toHaveBeenCalledWith("studio1", "event1");
      expect(onStudioSubscribe).toHaveBeenCalledWith("studio1", "event2");
    });

    it("重复的 subscriberId 被忽略，返回 false", () => {
      const onStudioSubscribe = vi.fn();
      const manager = new SubscriptionManager({ onStudioSubscribe });
      const callback1 = vi.fn();
      const callback2 = vi.fn();

      manager.subscribe("studio1", "event1", "sub1", callback1);
      onStudioSubscribe.mockClear();
      const result = manager.subscribe("studio1", "event1", "sub1", callback2);

      expect(result).toBe(false);
      expect(onStudioSubscribe).not.toHaveBeenCalled();
      expect(manager.getSubscriberCount("studio1", "event1")).toBe(1);
    });

    it("没有配置回调时正常工作", () => {
      const manager = new SubscriptionManager();
      const callback = vi.fn();

      const result = manager.subscribe("studio1", "event1", "sub1", callback);

      expect(result).toBe(true);
      expect(manager.getSubscriberCount("studio1", "event1")).toBe(1);
    });

    it("创建新的 studio 和 event 映射", () => {
      const manager = new SubscriptionManager();
      const callback = vi.fn();

      manager.subscribe("studio1", "event1", "sub1", callback);

      expect(manager.getSubscriberCount("studio1", "event1")).toBe(1);
      expect(manager.getSubscribedEvents("studio1")).toEqual(["event1"]);
    });
  });

  describe("unsubscribe()", () => {
    it("非最后订阅者返回 false，不触发 onStudioUnsubscribe", () => {
      const onStudioUnsubscribe = vi.fn();
      const manager = new SubscriptionManager({ onStudioUnsubscribe });
      const callback = vi.fn();

      manager.subscribe("studio1", "event1", "sub1", callback);
      manager.subscribe("studio1", "event1", "sub2", callback);

      const result = manager.unsubscribe("studio1", "event1", "sub1");

      expect(result).toBe(false);
      expect(onStudioUnsubscribe).not.toHaveBeenCalled();
      expect(manager.getSubscriberCount("studio1", "event1")).toBe(1);
    });

    it("最后订阅者返回 true，触发 onStudioUnsubscribe", () => {
      const onStudioUnsubscribe = vi.fn();
      const manager = new SubscriptionManager({ onStudioUnsubscribe });
      const callback = vi.fn();

      manager.subscribe("studio1", "event1", "sub1", callback);
      const result = manager.unsubscribe("studio1", "event1", "sub1");

      expect(result).toBe(true);
      expect(onStudioUnsubscribe).toHaveBeenCalledOnce();
      expect(onStudioUnsubscribe).toHaveBeenCalledWith("studio1", "event1");
      expect(manager.getSubscriberCount("studio1", "event1")).toBe(0);
    });

    it("不存在的 studioId 返回 false", () => {
      const manager = new SubscriptionManager();

      const result = manager.unsubscribe("nonexistent", "event1", "sub1");

      expect(result).toBe(false);
    });

    it("不存在的 event 返回 false", () => {
      const manager = new SubscriptionManager();
      const callback = vi.fn();

      manager.subscribe("studio1", "event1", "sub1", callback);
      const result = manager.unsubscribe("studio1", "nonexistent", "sub1");

      expect(result).toBe(false);
    });

    it("不存在的 subscriberId 返回 false", () => {
      const manager = new SubscriptionManager();
      const callback = vi.fn();

      manager.subscribe("studio1", "event1", "sub1", callback);
      const result = manager.unsubscribe("studio1", "event1", "nonexistent");

      expect(result).toBe(false);
    });

    it("删除最后订阅者后清理空 event map", () => {
      const manager = new SubscriptionManager();
      const callback = vi.fn();

      manager.subscribe("studio1", "event1", "sub1", callback);
      manager.unsubscribe("studio1", "event1", "sub1");

      expect(manager.getSubscribedEvents("studio1")).toEqual([]);
    });

    it("删除最后事件后清理空 studio map", () => {
      const manager = new SubscriptionManager();
      const callback = vi.fn();

      manager.subscribe("studio1", "event1", "sub1", callback);
      manager.unsubscribe("studio1", "event1", "sub1");

      // getSubscribedEvents 对不存在的 studio 返回空数组
      expect(manager.getSubscribedEvents("studio1")).toEqual([]);
      expect(manager.getSubscriberCount("studio1", "event1")).toBe(0);
    });

    it("保留其他事件的订阅", () => {
      const manager = new SubscriptionManager();
      const callback = vi.fn();

      manager.subscribe("studio1", "event1", "sub1", callback);
      manager.subscribe("studio1", "event2", "sub2", callback);
      manager.unsubscribe("studio1", "event1", "sub1");

      expect(manager.getSubscribedEvents("studio1")).toEqual(["event2"]);
    });

    it("没有配置回调时正常工作", () => {
      const manager = new SubscriptionManager();
      const callback = vi.fn();

      manager.subscribe("studio1", "event1", "sub1", callback);
      const result = manager.unsubscribe("studio1", "event1", "sub1");

      expect(result).toBe(true);
      expect(manager.getSubscriberCount("studio1", "event1")).toBe(0);
    });
  });

  describe("dispatch()", () => {
    it("分发到所有订阅者，返回计数", () => {
      const manager = new SubscriptionManager();
      const callback1 = vi.fn();
      const callback2 = vi.fn();
      const callback3 = vi.fn();

      manager.subscribe("studio1", "event1", "sub1", callback1);
      manager.subscribe("studio1", "event1", "sub2", callback2);
      manager.subscribe("studio1", "event1", "sub3", callback3);

      const count = manager.dispatch("studio1", "event1", { foo: "bar" });

      expect(count).toBe(3);
      expect(callback1).toHaveBeenCalledOnce();
      expect(callback1).toHaveBeenCalledWith("studio1", "event1", {
        foo: "bar",
      });
      expect(callback2).toHaveBeenCalledOnce();
      expect(callback2).toHaveBeenCalledWith("studio1", "event1", {
        foo: "bar",
      });
      expect(callback3).toHaveBeenCalledOnce();
      expect(callback3).toHaveBeenCalledWith("studio1", "event1", {
        foo: "bar",
      });
    });

    it("没有订阅者时返回 0", () => {
      const manager = new SubscriptionManager();

      const count = manager.dispatch("studio1", "event1", {});

      expect(count).toBe(0);
    });

    it("不存在的 studioId 返回 0", () => {
      const manager = new SubscriptionManager();
      const callback = vi.fn();

      manager.subscribe("studio1", "event1", "sub1", callback);
      const count = manager.dispatch("nonexistent", "event1", {});

      expect(count).toBe(0);
      expect(callback).not.toHaveBeenCalled();
    });

    it("不存在的 event 返回 0", () => {
      const manager = new SubscriptionManager();
      const callback = vi.fn();

      manager.subscribe("studio1", "event1", "sub1", callback);
      const count = manager.dispatch("studio1", "nonexistent", {});

      expect(count).toBe(0);
      expect(callback).not.toHaveBeenCalled();
    });

    it("回调错误被静默忽略，其他订阅者仍被调用", () => {
      const manager = new SubscriptionManager();
      const callback1 = vi.fn(() => {
        throw new Error("callback1 failed");
      });
      const callback2 = vi.fn();
      const callback3 = vi.fn();

      manager.subscribe("studio1", "event1", "sub1", callback1);
      manager.subscribe("studio1", "event1", "sub2", callback2);
      manager.subscribe("studio1", "event1", "sub3", callback3);

      const count = manager.dispatch("studio1", "event1", { test: true });

      expect(count).toBe(3);
      expect(callback1).toHaveBeenCalledOnce();
      expect(callback2).toHaveBeenCalledOnce();
      expect(callback3).toHaveBeenCalledOnce();
    });

    it("传递正确的 studioId、event 和 data", () => {
      const manager = new SubscriptionManager();
      const callback = vi.fn();
      const testData = { complex: { nested: [1, 2, 3] } };

      manager.subscribe("studio-xyz", "custom-event", "sub1", callback);
      manager.dispatch("studio-xyz", "custom-event", testData);

      expect(callback).toHaveBeenCalledWith(
        "studio-xyz",
        "custom-event",
        testData,
      );
    });

    it("空的 eventSubs 数组返回 0", () => {
      const manager = new SubscriptionManager();
      const callback = vi.fn();

      manager.subscribe("studio1", "event1", "sub1", callback);
      manager.unsubscribe("studio1", "event1", "sub1");
      // Event entry is deleted when empty, so this tests the !eventSubs path
      const count = manager.dispatch("studio1", "event1", {});

      expect(count).toBe(0);
    });
  });

  describe("removeStudio()", () => {
    it("删除某 studio 的所有订阅", () => {
      const manager = new SubscriptionManager();
      const callback = vi.fn();

      manager.subscribe("studio1", "event1", "sub1", callback);
      manager.subscribe("studio1", "event2", "sub2", callback);
      manager.subscribe("studio2", "event1", "sub3", callback);

      manager.removeStudio("studio1");

      expect(manager.getSubscriberCount("studio1", "event1")).toBe(0);
      expect(manager.getSubscriberCount("studio1", "event2")).toBe(0);
      expect(manager.getSubscribedEvents("studio1")).toEqual([]);
      // studio2 不受影响
      expect(manager.getSubscriberCount("studio2", "event1")).toBe(1);
    });

    it("不存在的 studioId 不报错", () => {
      const manager = new SubscriptionManager();

      expect(() => manager.removeStudio("nonexistent")).not.toThrow();
    });
  });

  describe("removeSubscriber()", () => {
    it("从所有 studio 和 event 删除订阅者", () => {
      const manager = new SubscriptionManager();
      const callback = vi.fn();

      manager.subscribe("studio1", "event1", "sub1", callback);
      manager.subscribe("studio1", "event2", "sub1", callback);
      manager.subscribe("studio2", "event1", "sub1", callback);
      manager.subscribe("studio2", "event1", "sub2", callback); // 另一个订阅者

      manager.removeSubscriber("sub1");

      expect(manager.getSubscriberCount("studio1", "event1")).toBe(0);
      expect(manager.getSubscriberCount("studio1", "event2")).toBe(0);
      expect(manager.getSubscriberCount("studio2", "event1")).toBe(1);
    });

    it("删除最后订阅者时触发 onStudioUnsubscribe", () => {
      const onStudioUnsubscribe = vi.fn();
      const manager = new SubscriptionManager({ onStudioUnsubscribe });
      const callback = vi.fn();

      manager.subscribe("studio1", "event1", "sub1", callback);
      manager.subscribe("studio2", "event2", "sub1", callback);

      manager.removeSubscriber("sub1");

      expect(onStudioUnsubscribe).toHaveBeenCalledTimes(2);
      expect(onStudioUnsubscribe).toHaveBeenCalledWith("studio1", "event1");
      expect(onStudioUnsubscribe).toHaveBeenCalledWith("studio2", "event2");
    });

    it("清理空 event 和 studio map", () => {
      const manager = new SubscriptionManager();
      const callback = vi.fn();

      manager.subscribe("studio1", "event1", "sub1", callback);
      manager.subscribe("studio2", "event2", "sub1", callback);

      manager.removeSubscriber("sub1");

      expect(manager.getSubscribedEvents("studio1")).toEqual([]);
      expect(manager.getSubscribedEvents("studio2")).toEqual([]);
    });

    it("不存在的 subscriberId 不报错", () => {
      const manager = new SubscriptionManager();

      expect(() => manager.removeSubscriber("nonexistent")).not.toThrow();
    });

    it("保留其他订阅者", () => {
      const manager = new SubscriptionManager();
      const callback = vi.fn();

      manager.subscribe("studio1", "event1", "sub1", callback);
      manager.subscribe("studio1", "event1", "sub2", callback);

      manager.removeSubscriber("sub1");

      expect(manager.getSubscriberCount("studio1", "event1")).toBe(1);
    });

    it("没有配置回调时正常工作", () => {
      const manager = new SubscriptionManager();
      const callback = vi.fn();

      manager.subscribe("studio1", "event1", "sub1", callback);
      expect(() => manager.removeSubscriber("sub1")).not.toThrow();
      expect(manager.getSubscriberCount("studio1", "event1")).toBe(0);
    });
  });

  describe("getSubscriberCount()", () => {
    it("返回正确的订阅者数量", () => {
      const manager = new SubscriptionManager();
      const callback = vi.fn();

      expect(manager.getSubscriberCount("studio1", "event1")).toBe(0);

      manager.subscribe("studio1", "event1", "sub1", callback);
      expect(manager.getSubscriberCount("studio1", "event1")).toBe(1);

      manager.subscribe("studio1", "event1", "sub2", callback);
      expect(manager.getSubscriberCount("studio1", "event1")).toBe(2);

      manager.unsubscribe("studio1", "event1", "sub1");
      expect(manager.getSubscriberCount("studio1", "event1")).toBe(1);
    });

    it("不存在的 studioId 返回 0", () => {
      const manager = new SubscriptionManager();

      expect(manager.getSubscriberCount("nonexistent", "event1")).toBe(0);
    });

    it("不存在的 event 返回 0", () => {
      const manager = new SubscriptionManager();
      const callback = vi.fn();

      manager.subscribe("studio1", "event1", "sub1", callback);
      expect(manager.getSubscriberCount("studio1", "nonexistent")).toBe(0);
    });
  });

  describe("getSubscribedEvents()", () => {
    it("返回所有订阅的事件", () => {
      const manager = new SubscriptionManager();
      const callback = vi.fn();

      manager.subscribe("studio1", "event1", "sub1", callback);
      manager.subscribe("studio1", "event2", "sub2", callback);
      manager.subscribe("studio1", "event3", "sub3", callback);

      const events = manager.getSubscribedEvents("studio1");
      expect(events).toHaveLength(3);
      expect(events).toContain("event1");
      expect(events).toContain("event2");
      expect(events).toContain("event3");
    });

    it("不存在的 studioId 返回空数组", () => {
      const manager = new SubscriptionManager();

      expect(manager.getSubscribedEvents("nonexistent")).toEqual([]);
    });

    it("删除所有订阅后返回空数组", () => {
      const manager = new SubscriptionManager();
      const callback = vi.fn();

      manager.subscribe("studio1", "event1", "sub1", callback);
      manager.unsubscribe("studio1", "event1", "sub1");

      expect(manager.getSubscribedEvents("studio1")).toEqual([]);
    });

    it("返回只读数组", () => {
      const manager = new SubscriptionManager();
      const callback = vi.fn();

      manager.subscribe("studio1", "event1", "sub1", callback);
      const events = manager.getSubscribedEvents("studio1");

      // TypeScript readonly 类型检查
      expect(Array.isArray(events)).toBe(true);
    });
  });

  describe("集成测试：完整订阅流程", () => {
    it("多 studio 多事件多订阅者的完整生命周期", () => {
      const onStudioSubscribe = vi.fn();
      const onStudioUnsubscribe = vi.fn();
      const manager = new SubscriptionManager({
        onStudioSubscribe,
        onStudioUnsubscribe,
      });

      const callback1 = vi.fn();
      const callback2 = vi.fn();
      const callback3 = vi.fn();

      // Phase 1: 建立订阅
      manager.subscribe("studio1", "selectionChanged", "client1", callback1);
      manager.subscribe("studio1", "selectionChanged", "client2", callback2);
      manager.subscribe("studio1", "outputMessage", "client1", callback1);
      manager.subscribe("studio2", "selectionChanged", "client3", callback3);

      expect(onStudioSubscribe).toHaveBeenCalledTimes(3);
      expect(manager.getSubscribedEvents("studio1")).toContain(
        "selectionChanged",
      );
      expect(manager.getSubscribedEvents("studio1")).toContain("outputMessage");
      expect(manager.getSubscribedEvents("studio2")).toContain(
        "selectionChanged",
      );

      // Phase 2: 分发通知
      const count1 = manager.dispatch("studio1", "selectionChanged", {
        selection: ["Part1"],
      });
      expect(count1).toBe(2);
      expect(callback1).toHaveBeenCalledWith("studio1", "selectionChanged", {
        selection: ["Part1"],
      });
      expect(callback2).toHaveBeenCalledWith("studio1", "selectionChanged", {
        selection: ["Part1"],
      });
      expect(callback3).not.toHaveBeenCalled();

      const count2 = manager.dispatch("studio2", "selectionChanged", {
        selection: ["Part2"],
      });
      expect(count2).toBe(1);
      expect(callback3).toHaveBeenCalledWith("studio2", "selectionChanged", {
        selection: ["Part2"],
      });

      // Phase 3: 部分取消订阅
      manager.unsubscribe("studio1", "selectionChanged", "client1");
      expect(onStudioUnsubscribe).not.toHaveBeenCalled(); // client2 仍在
      expect(manager.getSubscriberCount("studio1", "selectionChanged")).toBe(1);

      // Phase 4: 最后订阅者取消订阅
      onStudioUnsubscribe.mockClear();
      manager.unsubscribe("studio1", "selectionChanged", "client2");
      expect(onStudioUnsubscribe).toHaveBeenCalledWith(
        "studio1",
        "selectionChanged",
      );

      // Phase 5: removeSubscriber 清理跨 studio 订阅
      onStudioUnsubscribe.mockClear();
      manager.removeSubscriber("client1");
      expect(onStudioUnsubscribe).toHaveBeenCalledWith(
        "studio1",
        "outputMessage",
      );
      expect(manager.getSubscribedEvents("studio1")).toEqual([]);

      // Phase 6: removeStudio 清理整个 studio
      manager.removeStudio("studio2");
      expect(manager.getSubscriberCount("studio2", "selectionChanged")).toBe(0);
    });
  });
});
