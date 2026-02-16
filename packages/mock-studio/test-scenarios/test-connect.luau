--[[
	test-connect.luau

	Tests: Runtime connects to Hub via WebSocket, sends hello, receives welcome.

	Usage: lune run packages/mock-studio/test-scenarios/test-connect <port>

	Exit code 0 = success, 1 = failure
]]

local roblox = require("@lune/roblox")
local fs = require("@lune/fs")
local process = require("@lune/process")
local task = require("@lune/task")
local serde = require("@lune/serde")

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
local game = MockRoblox.create({
	placeName = "ConnectTestPlace",
	localPath = "/tmp/connect-test.rbxl",
})

-- ======== Load Runtime via loadstring ========

-- Read the runtime source
local runtimeSrcPath = process.cwd .. "/packages/runtime/src/init.lua"
if not fs.isFile(runtimeSrcPath) then
	print("FAIL: Runtime source not found: " .. runtimeSrcPath)
	process.exit(1)
end

local runtimeSource = fs.readFile(runtimeSrcPath)

-- Create a mock 'script' object (ModuleScript) for the runtime
local scriptInstance = roblox.Instance.new("ModuleScript")
scriptInstance.Name = "__HubRuntime__"
scriptInstance.Parent = game:GetService("ReplicatedStorage")

-- Load and execute with proper environment
local chunk, loadErr = loadstring(runtimeSource, "runtime/init.lua")
if not chunk then
	print("FAIL: Could not parse runtime source: " .. tostring(loadErr))
	process.exit(1)
end

-- Mock Enum.WebStreamClientType (not available in Lune)
local MockEnum = setmetatable({
	WebStreamClientType = { WebSocket = "WebSocket" },
	HttpContentType = { ApplicationJson = "application/json" },
}, { __index = Enum })

-- Set up environment with game and script globals
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

-- ======== Run Test ========

print("[test-connect] Connecting to port " .. port .. "...")
Runtime:connect(port)

-- Wait for connection
for i = 1, 50 do
	task.wait(0.1)
	if Runtime.isConnected then break end
end

if not Runtime.isConnected then
	print("FAIL: Timed out waiting for connection")
	process.exit(1)
end

print("[test-connect] Connected! studioId: " .. tostring(Runtime.studioId))

if not Runtime.studioId or Runtime.studioId == "" then
	print("FAIL: No studioId received")
	process.exit(1)
end

local methods = Runtime:getAvailableMethods()
print("[test-connect] Methods: " .. #methods)

-- Disconnect cleanly
Runtime:disconnect()

print("PASS: Connect test passed")
process.exit(0)
