--[[
	test-gamestate.luau

	Tests: Plugin detects gameState changes (edit -> play -> edit)
	and sends `state` messages to Hub via WebSocket.

	Usage: lune run packages/mock-studio/test-scenarios/test-gamestate <port>
]]

local roblox = require("@lune/roblox")
local fs = require("@lune/fs")
local process = require("@lune/process")
local task = require("@lune/task")

-- Parse args
local port = tonumber(process.args[1])
if not port then
	print("FAIL: Usage: lune run test-gamestate <port>")
	process.exit(1)
end

-- ======== Setup ========
local MockTransport = require("../lib/mock-transport")
MockTransport.install()

local MockRoblox = require("../lib/mock-roblox")
local game, controller = MockRoblox.create({
	placeName = "GameStateTestPlace",
	localPath = "/tmp/gamestate-test.rbxl",
})

-- Load runtime via loadstring
local runtimeSrcPath = process.cwd .. "/packages/runtime/src/init.lua"
local runtimeSource = fs.readFile(runtimeSrcPath)

local scriptInstance = roblox.Instance.new("ModuleScript")
scriptInstance.Name = "__HubRuntime__"
scriptInstance.Parent = game:GetService("ReplicatedStorage")

local chunk = assert(loadstring(runtimeSource, "runtime/init.lua"))

local MockEnum = setmetatable({
	WebStreamClientType = { WebSocket = "WebSocket" },
	HttpContentType = { ApplicationJson = "application/json" },
}, { __index = Enum })

local env = setmetatable({
	game = game,
	script = scriptInstance,
	require = require,
	print = print,
	warn = warn,
	error = error,
	pcall = pcall,
	type = type,
	tostring = tostring,
	tonumber = tonumber,
	ipairs = ipairs,
	pairs = pairs,
	table = table,
	string = string,
	math = math,
	task = task,
	Enum = MockEnum,
	Color3 = (Color3 :: any),
}, { __index = _G })

setfenv(chunk, env)
local Runtime = chunk()

-- Register handlers with different contexts
Runtime:registerHandler({
	name = "editOnly",
	description = "Only works in edit mode",
	inputSchema = { type = "object", properties = {} },
	context = "edit",
}, function(params)
	return { success = true, context = "edit" }
end)

Runtime:registerHandler({
	name = "playOnly",
	description = "Only works in play mode",
	inputSchema = { type = "object", properties = {} },
	context = "play",
}, function(params)
	return { success = true, context = "play" }
end)

Runtime:registerHandler({
	name = "anyContext",
	description = "Works in any context",
	inputSchema = { type = "object", properties = {} },
	context = "both",
}, function(params)
	return { success = true, context = "both" }
end)

Runtime:loadPlugins()

-- ======== Run (Plugin role) ========
local MockPlugin = require("../lib/mock-plugin")
local mockPlugin = MockPlugin.create(game, Runtime, port)

-- Track gameState changes
local stateChanges: { string } = {}
mockPlugin.onGameStateChange = function(state: string)
	table.insert(stateChanges, state)
	print("[test-gamestate] Plugin reported state change: " .. state)
end

-- Connect (starts in edit mode)
mockPlugin:connect()

for i = 1, 50 do
	task.wait(0.1)
	if mockPlugin.isConnected then break end
end

if not mockPlugin.isConnected then
	print("FAIL: Not connected")
	process.exit(1)
end

print("[test-gamestate] Connected in edit mode, gameState: " .. mockPlugin.gameState)

-- Verify initial state
if mockPlugin.gameState ~= "edit" then
	print("FAIL: Expected initial gameState='edit', got: " .. mockPlugin.gameState)
	process.exit(1)
end

-- Simulate Play (F5): switch to play mode
print("[test-gamestate] Simulating Play (F5)...")
controller:setGameState("play")

-- Wait for monitorGameState to detect the change (polls every 1s)
task.wait(2)

if mockPlugin.gameState ~= "play" then
	print("FAIL: Expected gameState='play' after F5, got: " .. mockPlugin.gameState)
	process.exit(1)
end
print("[test-gamestate] gameState is now: " .. mockPlugin.gameState)

-- Simulate Stop (Shift+F5): switch back to edit mode
print("[test-gamestate] Simulating Stop (Shift+F5)...")
controller:setGameState("edit")

-- Wait for detection
task.wait(2)

if mockPlugin.gameState ~= "edit" then
	print("FAIL: Expected gameState='edit' after Stop, got: " .. mockPlugin.gameState)
	process.exit(1)
end
print("[test-gamestate] gameState is now: " .. mockPlugin.gameState)

-- Verify state changes were reported
if #stateChanges < 2 then
	print("FAIL: Expected at least 2 state changes, got: " .. #stateChanges)
	process.exit(1)
end

if stateChanges[1] ~= "play" then
	print("FAIL: First state change should be 'play', got: " .. stateChanges[1])
	process.exit(1)
end

if stateChanges[2] ~= "edit" then
	print("FAIL: Second state change should be 'edit', got: " .. stateChanges[2])
	process.exit(1)
end

mockPlugin:disconnect()

print("PASS: GameState test passed (edit -> play -> edit)")
process.exit(0)
