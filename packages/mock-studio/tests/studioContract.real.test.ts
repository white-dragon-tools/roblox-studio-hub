/**
 * studioContract.real.test.ts
 *
 * Runs behavioral contracts C1-C5, C7 against a REAL Roblox Studio instance.
 * Gated by REAL_STUDIO=1 environment variable — skipped in normal test runs.
 *
 * Prerequisites:
 *   - macOS with Roblox Studio installed
 *   - `rojo`, `lune`, `rspo` on PATH (npm i @white-dragon-tools/roblox-studio-physical-operation)
 *   - tests/game.rbxl exists
 *   - REAL_STUDIO=1 env var set
 *
 * Usage: REAL_STUDIO=1 pnpm test:real
 */
import { describe, it, beforeAll, afterAll } from "vitest";
import { execFileSync } from "child_process";
import http from "http";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import {
  StudioManager,
  createApp,
  createWsServer,
  injectRuntime,
} from "@white-dragon-tools/roblox-studio-hub/testing";
import {
  C1_connectionRegistration,
  C2_methodDescriptors,
  C3_commandExecution,
  C4_environmentProbe,
  C5_errorPropagation,
  C7_disconnectCleanup,
  type ContractDeps,
} from "./studioContracts.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOCK_STUDIO_PKG = path.join(__dirname, "..");
const MONOREPO_ROOT = path.join(MOCK_STUDIO_PKG, "..", "..");
const FIXTURE_RBXL = path.join(MONOREPO_ROOT, "tests", "game.rbxl");
const PLUGINS_DIR = path.join(MONOREPO_ROOT, "packages", "plugins");

const REAL_STUDIO = process.env.REAL_STUDIO === "1";

function getPort(server: http.Server): number {
  const addr = server.address();
  if (addr && typeof addr === "object") return addr.port;
  throw new Error("server not listening");
}

/** Run `rspo` CLI command and return parsed JSON result */
function rspo(...args: string[]): unknown {
  const output = execFileSync("npx", ["rspo", ...args], {
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  return JSON.parse(output.trim());
}

/**
 * Wait for a Studio to connect and become ready.
 */
async function waitForStudio(
  studioManager: StudioManager,
  timeoutMs: number,
): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const studios = studioManager.getAll();
    if (studios.length > 0 && studios[0].methods.length > 0) {
      return studios[0].id;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No Studio connected within ${timeoutMs}ms`);
}

describe.skipIf(!REAL_STUDIO)("Behavioral Contracts (real Studio)", () => {
  let httpServer: http.Server;
  let studioManager: StudioManager;
  let port: number;
  let studioId: string;
  let deps: ContractDeps;
  let tempRbxl: string;

  beforeAll(async () => {
    // 1. Copy fixture to temp so we don't modify the original
    // Resolve macOS /var -> /private/var symlink so rspo can match paths
    const realTmpDir = fs.realpathSync(os.tmpdir());
    tempRbxl = path.join(realTmpDir, `hub-contract-test-${Date.now()}.rbxl`);
    fs.copyFileSync(FIXTURE_RBXL, tempRbxl);

    // 2. Start Hub (HTTP + WS)
    studioManager = new StudioManager();
    const result = createApp({ studioManager, pluginTools: [] });
    httpServer = http.createServer(result.app);
    createWsServer({
      httpServer,
      studioManager,
      pendingResults: result.state.pendingResults,
    });
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    port = getPort(httpServer);

    // 3. Inject runtime + plugins into the place file (with random port)
    await injectRuntime(tempRbxl, {
      extraPluginDirs: [PLUGINS_DIR],
      port,
    });

    // 4. Open in real Studio via rspo CLI
    const openResult = rspo("open", tempRbxl) as {
      success: boolean;
      message: string;
    };
    if (!openResult.success) {
      console.warn(`rspo open warning: ${openResult.message}`);
    }

    // 5. Wait for Studio to connect (the real check)
    studioId = await waitForStudio(studioManager, 60000);
    deps = { server: httpServer, studioManager, studioId };
  }, 90000);

  afterAll(async () => {
    // Close Studio via rspo CLI
    try {
      if (tempRbxl) rspo("close", tempRbxl);
    } catch {
      // ignore
    }

    // Close HTTP server
    if (httpServer) {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }

    // Clean up temp file
    try {
      if (tempRbxl) fs.unlinkSync(tempRbxl);
    } catch {
      // ignore
    }
  }, 60000);

  it("C1: connection registration", async () => {
    await C1_connectionRegistration(deps);
  });

  it("C2: method descriptors", async () => {
    await C2_methodDescriptors(deps);
  });

  it("C3: command execution", async () => {
    await C3_commandExecution(deps);
  }, 30000);

  it("C4: environment probe", async () => {
    await C4_environmentProbe(deps);
  }, 30000);

  it("C5: error propagation", async () => {
    await C5_errorPropagation(deps);
  }, 30000);

  it("C7: disconnect cleanup", async () => {
    const disconnect = async () => {
      rspo("close", tempRbxl);
      await new Promise((r) => setTimeout(r, 2000));
    };

    await C7_disconnectCleanup(deps, disconnect);
  }, 15000);
});
