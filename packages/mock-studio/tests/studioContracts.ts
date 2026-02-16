/**
 * Behavioral contracts: Hub-observable behaviors that both
 * mock-studio (Lune) and real Roblox Studio must satisfy.
 */
import { expect } from "vitest";
import request from "supertest";
import type http from "http";
import type { StudioManager } from "@white-dragon-tools/roblox-studio-hub/testing";

export interface ContractDeps {
  server: http.Server;
  studioManager: StudioManager;
  studioId: string;
}

/** C1: After connection, Hub has a valid StudioInstance */
export async function C1_connectionRegistration(
  deps: ContractDeps,
): Promise<void> {
  const { server, studioId } = deps;

  const res = await request(server).get(
    `/api/studios/${encodeURIComponent(studioId)}`,
  );
  expect(res.status).toBe(200);
  expect(res.body.placeName).toBeTruthy();
  expect(res.body.gameState).toBe("edit");

  const studio = deps.studioManager.get(studioId);
  expect(studio).toBeDefined();
  expect(studio!.methods.length).toBeGreaterThan(0);
}

/** C2: Methods include execute + getStudioInfo with correct shape */
export async function C2_methodDescriptors(
  deps: ContractDeps,
): Promise<void> {
  const { server, studioId } = deps;

  const res = await request(server).get(
    `/api/studios/${encodeURIComponent(studioId)}/methods`,
  );
  expect(res.status).toBe(200);

  const methods = res.body.methods as Array<{
    name: string;
    description: string;
    inputSchema: unknown;
    context?: string;
  }>;

  // Must have execute and getStudioInfo
  const execute = methods.find((m) => m.name === "execute");
  expect(execute).toBeDefined();
  expect(execute!.description).toBeTruthy();
  expect(execute!.inputSchema).toBeDefined();

  const getInfo = methods.find((m) => m.name === "getStudioInfo");
  expect(getInfo).toBeDefined();
  expect(getInfo!.description).toBeTruthy();
  expect(getInfo!.inputSchema).toBeDefined();

  // Every method has required shape
  for (const method of methods) {
    expect(method.name).toBeTruthy();
    expect(method.description).toBeTruthy();
    expect(method.inputSchema).toBeDefined();
  }
}

/** C3: execute eval mode returns correct result */
export async function C3_commandExecution(
  deps: ContractDeps,
): Promise<void> {
  const { server, studioId } = deps;

  const res = await request(server)
    .post(`/api/studios/${encodeURIComponent(studioId)}/call`)
    .send({
      method: "execute",
      params: { code: "return 1+1", mode: "eval" },
      timeout: 10,
    });

  expect(res.status).toBe(200);
  expect(res.body.success).toBe(true);
  expect(res.body.result).toBe(2);
}

/** C4: Lua environment probes match real Studio */
export async function C4_environmentProbe(
  deps: ContractDeps,
): Promise<void> {
  const { server, studioId } = deps;

  const probe = async (code: string) => {
    const res = await request(server)
      .post(`/api/studios/${encodeURIComponent(studioId)}/call`)
      .send({ method: "execute", params: { code, mode: "eval" }, timeout: 10 });
    return res.body;
  };

  // RunService:IsEdit() should be true in edit mode
  const r1 = await probe(
    "return game:GetService('RunService'):IsEdit()",
  );
  expect(r1.success).toBe(true);
  expect(r1.result).toBe(true);

  // game.ClassName should be "DataModel"
  const r2 = await probe("return game.ClassName");
  expect(r2.success).toBe(true);
  expect(r2.result).toBe("DataModel");

  // ReplicatedStorage should exist
  const r3 = await probe(
    "return game:GetService('ReplicatedStorage') ~= nil",
  );
  expect(r3.success).toBe(true);
  expect(r3.result).toBe(true);
}

/** C5: Lua error is captured and returned, not swallowed */
export async function C5_errorPropagation(
  deps: ContractDeps,
): Promise<void> {
  const { server, studioId } = deps;

  const res = await request(server)
    .post(`/api/studios/${encodeURIComponent(studioId)}/call`)
    .send({
      method: "execute",
      params: { code: "error('intentional test error')", mode: "eval" },
      timeout: 10,
    });

  expect(res.status).toBe(200);
  expect(res.body.success).toBe(false);
  // Error in errors.server or at top level
  const errorMsg = res.body.errors?.server ?? res.body.error ?? "";
  expect(errorMsg).toContain("intentional test error");
}

/** C6: gameState transitions are reported to Hub */
export async function C6_gameStateTransition(
  deps: ContractDeps,
  toPlay: () => Promise<void>,
  toEdit: () => Promise<void>,
): Promise<void> {
  const { server, studioId } = deps;

  // Initial: edit
  let res = await request(server).get(
    `/api/studios/${encodeURIComponent(studioId)}`,
  );
  expect(res.body.gameState).toBe("edit");

  // Transition to play
  await toPlay();
  await waitForGameState(deps, "play", 15000);

  res = await request(server).get(
    `/api/studios/${encodeURIComponent(studioId)}`,
  );
  expect(res.body.gameState).toBe("play");

  // Transition back to edit
  await toEdit();
  await waitForGameState(deps, "edit", 15000);

  res = await request(server).get(
    `/api/studios/${encodeURIComponent(studioId)}`,
  );
  expect(res.body.gameState).toBe("edit");
}

/** C7: After disconnect, Studio is removed from Hub */
export async function C7_disconnectCleanup(
  deps: ContractDeps,
  disconnect: () => Promise<void>,
): Promise<void> {
  const { server, studioId } = deps;

  // Should exist before disconnect
  let res = await request(server).get(
    `/api/studios/${encodeURIComponent(studioId)}`,
  );
  expect(res.status).toBe(200);

  await disconnect();

  // Wait for cleanup
  const start = Date.now();
  while (Date.now() - start < 5000) {
    res = await request(server).get(
      `/api/studios/${encodeURIComponent(studioId)}`,
    );
    if (res.status === 404) return;
    await new Promise((r) => setTimeout(r, 200));
  }

  throw new Error("Studio was not cleaned up after disconnect");
}

// === Helpers ===

async function waitForGameState(
  deps: ContractDeps,
  expected: string,
  timeoutMs: number,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const studio = deps.studioManager.get(deps.studioId);
    if (studio?.gameState === expected) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(
    `Timed out waiting for gameState="${expected}" (${timeoutMs}ms)`,
  );
}
