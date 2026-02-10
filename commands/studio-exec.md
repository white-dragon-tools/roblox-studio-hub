---
name: studio-exec
description: Execute Lua code in a connected Roblox Studio instance via Studio Hub API
allowed-tools: ["Execute", "Read"]
---

# Execute Lua Code in Roblox Studio

Execute Lua code on a connected Roblox Studio instance through the Studio Hub API.

## Prerequisites

1. Studio Hub server must be running (`npm run dev` in the project directory)
2. Roblox Studio must be open with the plugin connected

## Steps

### 1. Check Connected Studios

First, list all connected Studio instances:

```bash
curl http://localhost:35888/api/studios
```

If no studios are connected, inform the user to:
- Ensure Roblox Studio is open
- Check the Studio Hub plugin widget shows "Connected"
- Verify HTTP requests are enabled in Studio Settings

### 2. Get Studio ID

From the response, identify the target Studio ID:
- Cloud place: `place:{placeId}` (e.g., `place:123456`)
- Local file: `local:{placeName}` (e.g., `local:MyGame`)

### 3. Execute Code

Send the Lua code to the Studio:

```bash
curl -X POST http://localhost:35888/api/execute \
  -H "Content-Type: application/json" \
  -d '{
    "studioId": "STUDIO_ID_HERE",
    "code": "LUA_CODE_HERE",
    "mode": "eval",
    "timeout": 30
  }'
```

### Execution Modes

Choose the appropriate mode based on the task:

| Mode | When to Use |
|------|-------------|
| `eval` | Quick scripts, simple tests, REPL-style execution |
| `run` | Server-side logic testing (uses StudioTestService) |
| `play` | Full game testing with client and server |

### 4. Report Results

Parse the response and report to the user:

**Success:**
```json
{
  "success": true,
  "result": <return_value>,
  "logs": { "server": [...] }
}
```

**Error:**
```json
{
  "success": false,
  "errors": { "server": "error message" }
}
```

## Example Usage

User: "Run this Lua code in Studio: `return workspace:GetChildren()`"

1. Check studios: `curl http://localhost:35888/api/studios`
2. Execute:
```bash
curl -X POST http://localhost:35888/api/execute \
  -H "Content-Type: application/json" \
  -d '{"studioId": "place:123456", "code": "local children = {}; for _, c in ipairs(workspace:GetChildren()) do table.insert(children, {name=c.Name, class=c.ClassName}) end; return children", "mode": "eval"}'
```
3. Report the returned children list to the user

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Connection refused | Start Hub server: `npm run dev` |
| No studios listed | Open Roblox Studio, check plugin connection |
| Execution timeout | Increase timeout or simplify code |
| Lua syntax error | Check error message in response |
