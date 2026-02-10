# Lua Code Patterns for Studio Hub

Common Lua code patterns for testing with Roblox Studio Hub.

## Basic Patterns

### Simple Return Value

```lua
return 1 + 1
```

### Print and Return

```lua
print("Hello from Studio!")
return "done"
```

### Multiple Operations

```lua
local result = {}
result.time = os.time()
result.random = math.random(1, 100)
return result
```

---

## Service Access Patterns

### Get Service

```lua
local Players = game:GetService("Players")
return #Players:GetPlayers()
```

### Multiple Services

```lua
local HttpService = game:GetService("HttpService")
local RunService = game:GetService("RunService")

return {
    isStudio = RunService:IsStudio(),
    isRunning = RunService:IsRunning(),
    guid = HttpService:GenerateGUID(false)
}
```

---

## Workspace Inspection

### List Children

```lua
local children = {}
for _, child in ipairs(workspace:GetChildren()) do
    table.insert(children, {
        name = child.Name,
        class = child.ClassName
    })
end
return children
```

### Find First Child

```lua
local part = workspace:FindFirstChild("SpawnLocation")
if part then
    return {
        position = {part.Position.X, part.Position.Y, part.Position.Z},
        size = {part.Size.X, part.Size.Y, part.Size.Z}
    }
end
return nil
```

### Recursive Find

```lua
local function findAll(parent, className)
    local results = {}
    for _, child in ipairs(parent:GetDescendants()) do
        if child:IsA(className) then
            table.insert(results, child:GetFullName())
        end
    end
    return results
end

return findAll(workspace, "Part")
```

---

## Data Store Patterns (Run/Play Mode)

### Read Data Store

```lua
local DataStoreService = game:GetService("DataStoreService")
local store = DataStoreService:GetDataStore("PlayerData")

local success, data = pcall(function()
    return store:GetAsync("test-key")
end)

return {
    success = success,
    data = data
}
```

### Write Data Store

```lua
local DataStoreService = game:GetService("DataStoreService")
local store = DataStoreService:GetDataStore("TestStore")

local success, err = pcall(function()
    store:SetAsync("test-key", {
        timestamp = os.time(),
        value = "test-value"
    })
end)

return {
    success = success,
    error = err
}
```

---

## HTTP Request Patterns

### GET Request

```lua
local HttpService = game:GetService("HttpService")

local success, response = pcall(function()
    return HttpService:GetAsync("https://httpbin.org/get")
end)

if success then
    return HttpService:JSONDecode(response)
end
return { error = response }
```

### POST Request

```lua
local HttpService = game:GetService("HttpService")

local data = HttpService:JSONEncode({
    test = "value",
    timestamp = os.time()
})

local success, response = pcall(function()
    return HttpService:PostAsync(
        "https://httpbin.org/post",
        data,
        Enum.HttpContentType.ApplicationJson
    )
end)

return {
    success = success,
    response = success and HttpService:JSONDecode(response) or response
}
```

---

## Instance Creation

### Create Part

```lua
local part = Instance.new("Part")
part.Name = "TestPart"
part.Size = Vector3.new(4, 1, 4)
part.Position = Vector3.new(0, 10, 0)
part.Anchored = true
part.BrickColor = BrickColor.new("Bright red")
part.Parent = workspace

return {
    created = true,
    fullName = part:GetFullName()
}
```

### Create Script

```lua
local script = Instance.new("Script")
script.Name = "TestScript"
script.Source = [[
    print("Hello from generated script!")
]]
script.Parent = game:GetService("ServerScriptService")

return "Script created: " .. script:GetFullName()
```

---

## Error Handling

### Protected Call

```lua
local success, result = pcall(function()
    -- Code that might error
    return workspace.NonExistentChild.Value
end)

return {
    success = success,
    result = result
}
```

### Try-Catch Pattern

```lua
local function tryExecute(fn)
    local success, result = pcall(fn)
    if success then
        return { ok = true, value = result }
    else
        return { ok = false, error = tostring(result) }
    end
end

return tryExecute(function()
    return game:GetService("Players"):GetPlayers()
end)
```

---

## Async Patterns

### Wait for Child

```lua
local part = workspace:WaitForChild("SpawnLocation", 5)
if part then
    return { found = true, name = part.Name }
end
return { found = false }
```

### Delayed Execution

```lua
task.wait(1)
print("After 1 second delay")
return os.time()
```

### Spawn Task

```lua
local results = {}

task.spawn(function()
    task.wait(0.5)
    table.insert(results, "task 1 done")
end)

task.spawn(function()
    task.wait(0.3)
    table.insert(results, "task 2 done")
end)

task.wait(1)
return results
```

---

## Testing Patterns

### Assert Pattern

```lua
local function assertEquals(actual, expected, message)
    if actual ~= expected then
        error(string.format("%s: expected %s, got %s", 
            message or "Assertion failed",
            tostring(expected),
            tostring(actual)
        ))
    end
end

assertEquals(1 + 1, 2, "Basic math")
assertEquals(type(workspace), "userdata", "Workspace type")

return "All assertions passed"
```

### Test Suite Pattern

```lua
local tests = {}
local passed = 0
local failed = 0

local function test(name, fn)
    local success, err = pcall(fn)
    if success then
        passed = passed + 1
        table.insert(tests, { name = name, status = "PASS" })
    else
        failed = failed + 1
        table.insert(tests, { name = name, status = "FAIL", error = err })
    end
end

test("workspace exists", function()
    assert(workspace ~= nil)
end)

test("can get service", function()
    local players = game:GetService("Players")
    assert(players ~= nil)
end)

test("math works", function()
    assert(2 + 2 == 4)
end)

return {
    passed = passed,
    failed = failed,
    total = passed + failed,
    tests = tests
}
```

---

## Performance Measurement

### Timing Code

```lua
local startTime = os.clock()

-- Code to measure
local sum = 0
for i = 1, 1000000 do
    sum = sum + i
end

local endTime = os.clock()

return {
    result = sum,
    elapsed = endTime - startTime,
    unit = "seconds"
}
```

### Memory Usage

```lua
collectgarbage("collect")
local before = collectgarbage("count")

-- Allocate memory
local data = {}
for i = 1, 10000 do
    data[i] = string.rep("x", 100)
end

local after = collectgarbage("count")

return {
    before = before,
    after = after,
    allocated = after - before,
    unit = "KB"
}
```

---

## Play Mode Specific (Client + Server)

### Server Code for Play Mode

```lua
-- This runs on server in play mode
local Players = game:GetService("Players")

-- Wait for a player to join
local player = Players.PlayerAdded:Wait()

return {
    playerJoined = true,
    playerName = player.Name,
    userId = player.UserId
}
```

### Shared Code Pattern

```lua
-- Works in both eval and run/play modes
local RunService = game:GetService("RunService")

local context = {
    isStudio = RunService:IsStudio(),
    isServer = RunService:IsServer(),
    isClient = RunService:IsClient(),
    isRunning = RunService:IsRunning()
}

return context
```
