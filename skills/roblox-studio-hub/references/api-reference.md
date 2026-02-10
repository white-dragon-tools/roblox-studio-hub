# Roblox Studio Hub API Reference

Complete API documentation for the Studio Hub server.

## Base URL

```
http://localhost:35888
```

Default port is `35888`, configurable via `STUDIO_HUB_PORT` environment variable.

---

## Studio API (Plugin Communication)

These endpoints are used by the Roblox Studio plugin for communication.

### GET /api/studio/poll

Long polling endpoint for Studio registration, heartbeat, and command retrieval.

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `studioInfo` | string | Yes | JSON-encoded Studio information |
| `timeout` | number | No | Poll timeout in seconds (default: 30) |

**studioInfo Schema:**

```json
{
  "placeId": 123456,
  "placeName": "My Game",
  "creatorName": "Developer",
  "creatorType": "User",
  "gameId": 789,
  "userId": 456
}
```

**Response:**

```json
{
  "studioId": "place:123456",
  "commands": [
    {
      "id": "uuid-string",
      "type": "execute",
      "payload": {
        "code": "print('Hello')",
        "mode": "eval",
        "timeout": 30
      }
    }
  ]
}
```

**Command Types:**

| Type | Description |
|------|-------------|
| `execute` | Execute Lua code |
| `disconnect` | Connection replaced by new poll |

---

### POST /api/studio/result

Submit execution results back to the Hub.

**Request Body:**

```json
{
  "id": "command-uuid",
  "payload": {
    "success": true,
    "result": "return value",
    "logs": {
      "server": ["log line 1", "log line 2"],
      "client": ["client log"]
    },
    "errors": {
      "server": "error message if any",
      "client": "client error if any"
    }
  }
}
```

**Response:**

```json
{
  "success": true
}
```

---

## Client API (External Consumers)

These endpoints are for Web UI and external applications.

### GET /api/studios

List all connected Studio instances.

**Response:**

```json
{
  "studios": [
    {
      "id": "place:123456",
      "type": "place",
      "placeId": 123456,
      "placeName": "My Game",
      "connectedAt": "2024-01-01T00:00:00.000Z",
      "clientCount": 0
    },
    {
      "id": "local:TestGame",
      "type": "local",
      "placeName": "TestGame",
      "connectedAt": "2024-01-01T00:01:00.000Z",
      "clientCount": 0
    }
  ]
}
```

**Studio Types:**

| Type | ID Format | Description |
|------|-----------|-------------|
| `place` | `place:{placeId}` | Cloud-saved place |
| `local` | `local:{placeName}` | Local unsaved file |

---

### GET /api/studios/:id

Get details for a specific Studio instance.

**URL Parameters:**

| Parameter | Description |
|-----------|-------------|
| `id` | Studio ID (e.g., `place:123456` or `local:MyGame`) |

**Response:**

```json
{
  "id": "place:123456",
  "type": "place",
  "placeId": 123456,
  "placeName": "My Game",
  "gameId": 789,
  "userId": 456,
  "connectedAt": "2024-01-01T00:00:00.000Z",
  "clientCount": 0
}
```

**Error Response (404):**

```json
{
  "error": "Studio not found"
}
```

---

### GET /api/studios/:id/logs

Retrieve logs for a specific Studio.

**URL Parameters:**

| Parameter | Description |
|-----------|-------------|
| `id` | Studio ID |

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `limit` | number | 100 | Maximum log entries to return |

**Response:**

```json
{
  "logs": [
    {
      "timestamp": 1704067200000,
      "source": "server",
      "level": "info",
      "message": "Script executed successfully"
    }
  ]
}
```

---

### POST /api/execute

Execute Lua code on a connected Studio instance.

**Request Body:**

```json
{
  "studioId": "place:123456",
  "code": "return 1 + 1",
  "mode": "eval",
  "timeout": 30
}
```

**Parameters:**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `studioId` | string | Yes | - | Target Studio ID |
| `code` | string | Yes | - | Lua code to execute |
| `mode` | string | No | `eval` | Execution mode |
| `timeout` | number | No | 30 | Timeout in seconds |

**Execution Modes:**

| Mode | Description | Use Case |
|------|-------------|----------|
| `eval` | Direct `loadstring` execution | Quick scripts, REPL-style |
| `run` | `StudioTestService:ExecuteRunModeAsync` | Server-side testing |
| `play` | `StudioTestService:ExecutePlayModeAsync` | Full client+server testing |

**Success Response:**

```json
{
  "success": true,
  "result": 2,
  "logs": {
    "server": ["print output line 1"],
    "client": []
  },
  "errors": {}
}
```

**Error Response:**

```json
{
  "success": false,
  "result": null,
  "logs": {
    "server": []
  },
  "errors": {
    "server": "attempt to index nil with 'foo'"
  }
}
```

**Timeout Response:**

```json
{
  "success": false,
  "error": "Execution timeout"
}
```

---

## UI API

Endpoints for the Web UI real-time updates.

### GET /api/ui/init

Get initial UI state with all connected Studios.

**Response:**

```json
{
  "studios": [
    {
      "id": "place:123456",
      "type": "place",
      "placeName": "My Game",
      "creatorName": "Developer",
      "creatorType": "User",
      "placeId": 123456,
      "gameId": 789,
      "connectedAt": "2024-01-01T00:00:00.000Z",
      "clientCount": 0
    }
  ]
}
```

---

### GET /api/ui/poll

Long polling for real-time UI events.

**Query Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `since` | number | 0 | Timestamp of last received event |
| `timeout` | number | 30 | Poll timeout in seconds |

**Response:**

```json
{
  "events": [
    {
      "type": "studio_connected",
      "data": {
        "studio": { "id": "place:123456", "placeName": "My Game" }
      },
      "timestamp": 1704067200000
    },
    {
      "type": "studio_disconnected",
      "data": {
        "studioId": "place:123456"
      },
      "timestamp": 1704067260000
    }
  ]
}
```

**Event Types:**

| Type | Description | Data |
|------|-------------|------|
| `studio_connected` | New Studio connected | `{ studio: StudioInfo }` |
| `studio_disconnected` | Studio disconnected | `{ studioId: string }` |

---

## Error Handling

All endpoints return standard HTTP status codes:

| Code | Description |
|------|-------------|
| 200 | Success |
| 400 | Bad request (missing/invalid parameters) |
| 404 | Resource not found |
| 500 | Internal server error |

Error response format:

```json
{
  "error": "Error message description"
}
```

---

## Rate Limits & Timeouts

| Setting | Value | Description |
|---------|-------|-------------|
| Poll timeout | 30s | Default long poll duration |
| Heartbeat timeout | 35s | Studio removed if no heartbeat |
| Execution timeout | 30s | Default code execution timeout |
| Max logs | 500 | Maximum logs stored per Studio |

---

## Example: Complete Workflow

### 1. Check Connected Studios

```bash
curl http://localhost:35888/api/studios
```

### 2. Execute Code

```bash
curl -X POST http://localhost:35888/api/execute \
  -H "Content-Type: application/json" \
  -d '{
    "studioId": "place:123456",
    "code": "local HttpService = game:GetService(\"HttpService\"); return HttpService:GenerateGUID(false)",
    "mode": "eval"
  }'
```

### 3. Monitor Events (Long Poll)

```bash
curl "http://localhost:35888/api/ui/poll?since=0&timeout=60"
```
