import { describe, it, expect } from "vitest";
import { execFile } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOCK_STUDIO_PKG = path.join(__dirname, "..");
const MONOREPO_ROOT = path.join(MOCK_STUDIO_PKG, "..", "..");

describe("Runtime Unit Tests (Lune)", () => {
  it("test-intercall: Runtime:call() inter-plugin communication", async () => {
    const scenarioPath = path.join(
      MOCK_STUDIO_PKG,
      "test-scenarios",
      "test-intercall",
    );

    const result = await new Promise<{
      exitCode: number;
      stdout: string;
      stderr: string;
    }>((resolve) => {
      execFile(
        "lune",
        ["run", scenarioPath],
        { timeout: 10000, cwd: MONOREPO_ROOT },
        (error, stdout, stderr) => {
          resolve({
            exitCode:
              typeof error?.code === "number" ? error.code : error ? 1 : 0,
            stdout: stdout?.toString() ?? "",
            stderr: stderr?.toString() ?? "",
          });
        },
      );
    });

    console.log("[test-intercall stdout]", result.stdout);
    if (result.stderr) console.log("[test-intercall stderr]", result.stderr);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("PASS: InterCall test passed");
  });

  it("test-plugin-deps: Plugin dependency topological sort", async () => {
    const scenarioPath = path.join(
      MOCK_STUDIO_PKG,
      "test-scenarios",
      "test-plugin-deps",
    );

    const result = await new Promise<{
      exitCode: number;
      stdout: string;
      stderr: string;
    }>((resolve) => {
      execFile(
        "lune",
        ["run", scenarioPath],
        { timeout: 10000, cwd: MONOREPO_ROOT },
        (error, stdout, stderr) => {
          resolve({
            exitCode:
              typeof error?.code === "number" ? error.code : error ? 1 : 0,
            stdout: stdout?.toString() ?? "",
            stderr: stderr?.toString() ?? "",
          });
        },
      );
    });

    console.log("[test-plugin-deps stdout]", result.stdout);
    if (result.stderr) console.log("[test-plugin-deps stderr]", result.stderr);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("PASS: Plugin dependency test passed");
  });

  it("test-notify: Runtime notification API", async () => {
    const scenarioPath = path.join(
      MOCK_STUDIO_PKG,
      "test-scenarios",
      "test-notify",
    );

    const result = await new Promise<{
      exitCode: number;
      stdout: string;
      stderr: string;
    }>((resolve) => {
      execFile(
        "lune",
        ["run", scenarioPath],
        { timeout: 10000, cwd: MONOREPO_ROOT },
        (error, stdout, stderr) => {
          resolve({
            exitCode:
              typeof error?.code === "number" ? error.code : error ? 1 : 0,
            stdout: stdout?.toString() ?? "",
            stderr: stderr?.toString() ?? "",
          });
        },
      );
    });

    console.log("[test-notify stdout]", result.stdout);
    if (result.stderr) console.log("[test-notify stderr]", result.stderr);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("PASS: Notification API test passed");
  });
});
