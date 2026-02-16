---
name: studio-exec
description: Execute Lua code in a connected Roblox Studio instance via Studio Hub CLI
allowed-tools: ["Execute", "Read", "Create"]
---

# Execute Lua Code in Roblox Studio

Execute Lua code on a connected Roblox Studio instance through the Studio Hub CLI.

## Prerequisites

1. Studio Hub server must be running (`roblox-studio-hub status`)
2. Roblox Studio must be open with the plugin connected

## Steps

### 1. Check Connected Studios

First, list all connected Studio instances:

```bash
roblox-studio-hub list
```

If no studios are connected, inform the user to:
- Ensure Roblox Studio is open
- Check the Studio Hub plugin widget shows "Connected"
- Verify HTTP requests are enabled in Studio Settings

### 2. Get Studio ID

From the output, identify the target Studio ID:
- Cloud place: `place:{placeId}` (e.g., `place:123456`)
- Local file: `local:{placeName}` (e.g., `local:MyGame`)
- Custom path: `path:{localPath}` (e.g., `path:D:/Projects/MyGame`)

### 3. Create Lua Script File

Save the Lua code to a file:

```lua
-- script.lua
print("Hello from Hub!")
return workspace:GetChildren()
```

### 4. Execute Code

Run the script using the CLI:

```bash
roblox-studio-hub exec <studioId> <file> [-m mode]
```

Examples:
```bash
# Default eval mode
roblox-studio-hub exec place:123456 script.lua

# Server-side test mode
roblox-studio-hub exec local:MyGame test.lua -m run

# Full play mode
roblox-studio-hub exec place:123456 test.lua --mode play
```

### Execution Modes

Choose the appropriate mode based on the task:

| Mode | When to Use |
|------|-------------|
| `eval` | Quick scripts, simple tests, REPL-style execution (default) |
| `run` | Server-side logic testing (uses StudioTestService) |
| `play` | Full game testing with client and server |

### 5. Report Results

The CLI will output:
- ✅ Success with return value (if any)
- Server/client logs
- ❌ Error messages if execution failed

## Example Usage

User: "Run this Lua code in Studio: `return workspace:GetChildren()`"

1. Check studios:
```bash
roblox-studio-hub list
```

2. Create script file (or use temp file):
```bash
echo "local children = {}; for _, c in ipairs(workspace:GetChildren()) do table.insert(children, {name=c.Name, class=c.ClassName}) end; return children" > temp_script.lua
```

3. Execute:
```bash
roblox-studio-hub exec place:123456 temp_script.lua
```

4. Report the returned children list to the user

## CLI Commands Reference

| Command | Description |
|---------|-------------|
| `roblox-studio-hub exec <studioId> <file>` | Execute Lua script (eval mode) |
| `roblox-studio-hub exec <studioId> <file> -m run` | Execute in run mode |
| `roblox-studio-hub exec <studioId> <file> -m play` | Execute in play mode |
| `roblox-studio-hub exec -h` | Show detailed help |

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Service not running | `roblox-studio-hub start` or `roblox-studio-hub serve` |
| No studios listed | Open Roblox Studio, check plugin connection |
| Execution timeout | Increase timeout or simplify code |
| Lua syntax error | Check error message in output |
| File not found | Use absolute path or check current directory |
