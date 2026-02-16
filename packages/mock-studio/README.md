# mock-studio

Lune-based mock of Roblox Studio for testing the Hub without a real Studio instance.

## Architecture

- `mock-studio.luau` — entry point, boots the mock Roblox environment and loads runtime
- `lib/` — mock implementations (Roblox API, WebSocket transport, plugin loader)
- `test-scenarios/` — standalone Lune scripts, each testing a specific behavior
- `tests/` — vitest test files that orchestrate Hub + mock-studio together

## Prerequisites

- [Lune](https://lune-org.github.io/docs) CLI (`aftman add lune-org/lune`)
- Node.js 20+
- Hub package built (`cd ../hub && pnpm build`)

## Running Tests

```bash
# Mock-based contract tests (no real Studio needed)
pnpm test

# Real Studio contract tests (macOS, Roblox Studio installed)
REAL_STUDIO=1 pnpm test:real
```

## Test Scenarios

| Scenario | Description |
|---|---|
| `mock-client` | Full WS client simulating Studio connection lifecycle |
| `test-connect` | Basic connection handshake |
| `test-command` | Command dispatch and result |
| `test-gamestate` | gameState transition (edit/play) |
| `test-intercall` | Inter-plugin `runtime:call()` |
| `test-plugin-deps` | Topological sort of plugin dependencies |
| `test-notify` | Notification subscribe/emit |

## Behavioral Contracts (C1-C7)

Both mock and real Studio must pass the same contract tests:

- **C1**: Connection registration — Hub has valid StudioInstance after connect
- **C2**: Method descriptors — execute + getStudioInfo with correct shape
- **C3**: Command execution — `execute` eval mode returns correct result
- **C4**: Environment probe — RunService, DataModel, ReplicatedStorage match real Studio
- **C5**: Error propagation — Lua errors captured, not swallowed
- **C6**: gameState transition — edit/play transitions reported to Hub
- **C7**: Disconnect cleanup — Studio removed from Hub after disconnect

## Relationship to Hub

This package depends on `@white-dragon-tools/roblox-studio-hub/testing` which re-exports
`StudioManager`, `createApp`, `createWsServer`, and `injectRuntime` for test setup.
