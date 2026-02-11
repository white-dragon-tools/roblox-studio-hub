---
name: studio-status
description: Check the status of connected Roblox Studio instances
allowed-tools: ["Execute"]
---

# Check Studio Hub Status

Check the status of the Studio Hub server and connected Roblox Studio instances.

## Steps

### 1. Check Server Status

Verify the Hub server is running:

```bash
roblox-studio-hub status
```

If the service is not running, inform the user:
- Install as service: `roblox-studio-hub install` (requires admin/sudo)
- Or run manually: `roblox-studio-hub serve`

### 2. List Connected Studios

List all connected Studio instances:

```bash
roblox-studio-hub list
```

### 3. Get Studio Details (Optional)

For detailed info about a specific Studio:

```bash
roblox-studio-hub info <studioId>
```

### 4. Report Status

Format the status report for the user:

**Server Running, Studios Connected:**
```
✅ Studio Hub Status
   Server: Running on http://localhost:35888
   
   Connected Studios:
   • place:123456 - "My Game" (connected 5 min ago)
   • local:TestGame - "TestGame" (connected 2 min ago)
```

**Server Running, No Studios:**
```
✅ Studio Hub Status
   Server: Running on http://localhost:35888
   
   ⚠️ No Studios connected
   
   To connect:
   1. Open Roblox Studio
   2. The plugin should auto-connect
   3. Check the Studio Hub widget shows "Connected"
```

**Server Not Running:**
```
❌ Studio Hub Status
   Server: Not running
   
   To start:
   roblox-studio-hub start    # If installed as service
   roblox-studio-hub serve    # Manual foreground mode
```

## CLI Commands Reference

| Command | Description |
|---------|-------------|
| `roblox-studio-hub status` | Check Hub service status |
| `roblox-studio-hub list` | List all connected Studios |
| `roblox-studio-hub info <studioId>` | Show Studio details |
| `roblox-studio-hub logs <studioId>` | View Studio logs |

All commands support `-h` for help.
