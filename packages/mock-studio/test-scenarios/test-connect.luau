--[[
	test-connect.luau

	Tests: Plugin connects to Hub via WebSocket, sends hello, receives welcome.

	Usage: lune run packages/mock-studio/test-scenarios/test-connect <port>

	Exit code 0 = success, 1 = failure
]]

local roblox = require("@lune/roblox")
local fs = require("@lune/fs")
local process = require("@lune/process")
local task = require("@lune/task")

-- Parse args
local port = tonumber(process.args[1])
if not port then
	print("FAIL: Usage: lune run test-connect <port>")
	process.exit(1)
end

-- ======== Setup Mock Environment ========

local MockTransport = require("../lib/mock-transport")
MockTransport.install()

local MockRoblox = require("../lib/mock-roblox")
local game, _controller = MockRoblox.create({
	placeName = "ConnectTestPlace",
	localPath = "/tmp/connect-test.rbxl",
})

-- ======== Load Runtime via loadstring ========

local runtimeSrcPath = process.cwd .. "/packages/runtime/src/init.lua"
if not fs.isFile(runtimeSrcPath) then
	print("FAIL: Runtime source not found: " .. runtimeSrcPath)
	process.exit(1)
end

local runtimeSource = fs.readFile(runtimeSrcPath)

local scriptInstance = roblox.Instance.new("ModuleScript")
scriptInstance.Name = "__HubRuntime__"
scriptInstance.Parent = game:GetService("ReplicatedStorage")

local chunk, loadErr = loadstring(runtimeSource, "runtime/init.lua")
if not chunk then
	print("FAIL: Could not parse runtime source: " .. tostring(loadErr))
	process.exit(1)
end

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

if not Runtime then
	print("FAIL: Runtime returned nil")
	process.exit(1)
end

-- Register a test handler
Runtime:registerHandler({
	name = "echo",
	description = "Echo test",
	inputSchema = { type = "object", properties = {} },
	context = "both",
}, function(params)
	return { success = true, result = params }
end)

-- Load plugins (in real Studio, Plugin calls this)
Runtime:loadPlugins()

-- ======== Run Test (Plugin role) ========

local MockPlugin = require("../lib/mock-plugin")
local mockPlugin = MockPlugin.create(game, Runtime, port)

print("[test-connect] Connecting to port " .. port .. "...")
mockPlugin:connect()

-- Wait for connection
for i = 1, 50 do
	task.wait(0.1)
	if mockPlugin.isConnected then break end
end

if not mockPlugin.isConnected then
	print("FAIL: Timed out waiting for connection")
	process.exit(1)
end

print("[test-connect] Connected! studioId: " .. tostring(mockPlugin.studioId))

if not mockPlugin.studioId or mockPlugin.studioId == "" then
	print("FAIL: No studioId received")
	process.exit(1)
end

local methods = Runtime:getAvailableMethods()
print("[test-connect] Methods: " .. #methods)

-- Disconnect cleanly
mockPlugin:disconnect()

print("PASS: Connect test passed")
process.exit(0)
