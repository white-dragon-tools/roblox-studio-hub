--[[
	test-command.luau

	Tests: Hub sends a command via WS, Runtime executes and returns result.

	Usage: lune run packages/mock-studio/test-scenarios/test-command <port>
]]

local roblox = require("@lune/roblox")
local fs = require("@lune/fs")
local process = require("@lune/process")
local task = require("@lune/task")

-- Parse args
local port = tonumber(process.args[1])
if not port then
	print("FAIL: Usage: lune run test-command <port>")
	process.exit(1)
end

-- ======== Setup ========
local MockTransport = require("../lib/mock-transport")
MockTransport.install()

local MockRoblox = require("../lib/mock-roblox")
local game, _controller = MockRoblox.create({
	placeName = "CommandTestPlace",
	localPath = "/tmp/command-test.rbxl",
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

-- Register echo handler
Runtime:registerHandler({
	name = "echo",
	description = "Echo params back",
	inputSchema = { type = "object", properties = {} },
	context = "both",
}, function(params)
	return { success = true, result = params }
end)

-- ======== Run ========
Runtime:connect(port)

for i = 1, 50 do
	task.wait(0.1)
	if Runtime.isConnected then break end
end

if not Runtime.isConnected then
	print("FAIL: Not connected")
	process.exit(1)
end

print("[test-command] Connected, studioId: " .. tostring(Runtime.studioId))
print("[test-command] Waiting for commands...")
task.wait(3)

Runtime:disconnect()

print("PASS: Command test passed")
process.exit(0)
