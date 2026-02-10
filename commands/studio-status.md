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
curl -s http://localhost:35888/api/studios
```

If connection refused, the server is not running. Inform the user:
- Start with `npm run dev` (development) or `npm start` (production)
- Default port is 35888

### 2. List Connected Studios

Parse the response to show connected Studios:

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

### 3. Report Status

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
   cd <project-directory>
   npm run dev
```

## Additional Info

For detailed Studio info, use:

```bash
curl http://localhost:35888/api/studios/{studioId}
```
