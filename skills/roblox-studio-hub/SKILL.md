---
name: roblox-studio-hub
description: This skill should be used when the user asks to "execute Lua code in Roblox Studio", "run code in Studio", "test Lua script", "connect to Studio Hub", "manage Studio instances", "check Studio status", "install Studio Hub", "setup Studio Hub service", or mentions Roblox Studio remote execution, Studio Hub API, or Lua code testing.
version: 1.0.0
---

# Roblox Studio Hub

A tool for managing multiple Roblox Studio instances and executing Lua code remotely via HTTP API.

## Overview

Roblox Studio Hub provides:
- **Multi-Studio Management** - Connect and manage multiple Roblox Studio instances simultaneously
- **Remote Code Execution** - Execute Lua code in Studio with three modes (eval, run, play)
- **Real-time Monitoring** - Track Studio status and execution results via Web UI
- **HTTP Long Polling** - Stable communication without WebSocket dependencies
- **System Service** - Run as background service with auto-start on boot

## Architecture

```
┌─────────────────┐     HTTP Long Polling     ┌─────────────────┐
│  Roblox Studio  │ ◄──────────────────────► │   Studio Hub    │
│    (Plugin)     │                           │    (Server)     │
└─────────────────┘                           └────────┬────────┘
                                                       │
                                              ┌────────▼────────┐
                                              │    REST API     │
                                              │  localhost:35888│
                                              └─────────────────┘
```

## Execution Modes

| Mode | Description | Use Case |
|------|-------------|----------|
| `eval` | Direct execution via `loadstring` | Quick scripts, simple tests |
| `run` | Server-side test via `StudioTestService` | Server logic testing |
| `play` | Full Play mode (server + client) | Complete game testing |

## Quick Start

### 1. Install Hub Server

必须保证当前运行在 `管理员` 权限中, 否则提醒用户并中断本次会话.

```bash
# Configure GitHub npm registry
npm config set @white-dragon-tools:registry https://npm.pkg.github.com

# Install globally
npm install -g @white-dragon-tools/roblox-studio-hub
```

### 2. Register as System Service (Recommended)

```bash
# Register as system service (auto-start on boot)
# Windows: Run as Administrator
# Mac/Linux: Use sudo
roblox-studio-hub install

# Check service status
roblox-studio-hub status
```

### 3. Install Studio Plugin

```bash
roblox-studio-hub install-plugin
```

Plugin will be installed to:
- Windows: `%LOCALAPPDATA%\Roblox\Plugins\`
- macOS: `~/Documents/Roblox/Plugins/`

### 4. Verify Setup

```bash
roblox-studio-hub status
```

Output:
```
Roblox Studio Hub v1.0.0

  已注册为服务: ✅ 是
  服务运行中:   ✅ 是
  平台:         win32
  端口:         35888
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `roblox-studio-hub` | Show help |
| `roblox-studio-hub serve` | Run server in foreground |
| `roblox-studio-hub status` | Check service status |
| `roblox-studio-hub install` | Register as system service |
| `roblox-studio-hub uninstall` | Uninstall system service |
| `roblox-studio-hub start` | Start system service |
| `roblox-studio-hub stop` | Stop system service |
| `roblox-studio-hub install-plugin` | Install Roblox Studio plugin |

## API Reference

### Check Hub Status

```
GET /api/status
```

Response:
```json
{
  "version": "1.0.0",
  "port": 35888,
  "uptime": 3600,
  "installedAsService": true,
  "serviceRunning": true,
  "runningAsService": true,
  "platform": "win32"
}
```

### List Connected Studios

```
GET /api/studios
```

Response:
```json
{
  "studios": [
    {
      "id": "place:123456",
      "type": "place",
      "placeName": "My Game",
      "connectedAt": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

### Execute Code

```
POST /api/execute
```

Request body:
```json
{
  "studioId": "place:123456",
  "code": "print('Hello'); return 42",
  "mode": "eval",
  "timeout": 30
}
```

Response:
```json
{
  "success": true,
  "result": 42,
  "logs": { "server": ["Hello"] },
  "errors": {}
}
```

### Studio ID Format

- Cloud place: `place:{placeId}` (e.g., `place:123456`)
- Local file: `local:{placeName}` (e.g., `local:MyGame`)

## Common Workflows

### Testing Lua Code

1. Ensure Hub service is running (`roblox-studio-hub status`)
2. Open Roblox Studio - plugin auto-connects
3. Execute code via API or Web UI at `http://localhost:35888`

### Debugging Connection Issues

1. Check Studio plugin status in the widget
2. Verify HTTP requests are enabled in Studio Settings
3. Check firewall settings for port 35888
4. Review service status: `roblox-studio-hub status`

### Running Server Tests

Use `run` mode for server-side testing:

```json
{
  "studioId": "place:123456",
  "code": "local Players = game:GetService('Players'); return #Players:GetPlayers()",
  "mode": "run"
}
```

### Full Play Mode Testing

Use `play` mode for complete game testing with client:

```json
{
  "studioId": "place:123456",
  "code": "return { serverTime = workspace:GetServerTimeNow() }",
  "mode": "play"
}
```

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `STUDIO_HUB_PORT` | `35888` | Server port |

### Studio Plugin Settings

Configure in the plugin widget:
- **Port** - Hub server port (default: 35888)
- **Debug Mode** - Enable verbose logging

## Additional Resources

### Reference Files

For detailed API documentation and patterns:
- **`references/api-reference.md`** - Complete API specification
- **`references/lua-patterns.md`** - Common Lua code patterns for testing

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Studio not connecting | Enable HTTP requests in Studio Settings → Security |
| Connection timeout | Check firewall, verify port 35888 is open |
| Code execution fails | Check Lua syntax, review error in response |
| Studio disconnects | Hub removes inactive Studios after 35s without heartbeat |
| Service not starting | Run `roblox-studio-hub install` with admin/sudo privileges |
