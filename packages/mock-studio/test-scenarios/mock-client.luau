--[[
	mock-client.luau

	Long-lived mock Studio client for behavioral contract testing.

	Loads real runtime + real plugins (execute, getStudioInfo).
	Registers _setGameState test helper for gameState control.
	Stays alive until killed by parent process.

	Usage: lune run packages/mock-studio/test-scenarios/mock-client -- <port>

	Outputs:
	  "READY:<studioId>" when connected and ready for commands.
	  "FAIL: <reason>" and exits 1 on setup error.
]]

local roblox = require("@lune/roblox")
local fs = require("@lune/fs")
local process = require("@lune/process")
local task = require("@lune/task")

-- Parse args
local port = tonumber(process.args[1])
if not port then
	print("FAIL: Usage: lune run mock-client <port>")
	process.exit(1)
end

-- ======== Setup Mock Environment ========

local MockTransport = require("../lib/mock-transport")
MockTransport.install()

local MockRoblox = require("../lib/mock-roblox")
local rawGame, controller = MockRoblox.create({
	placeName = "ContractTestPlace",
	localPath = "/tmp/contract-test.rbxl",
})

-- ======== LogService Mock ========
-- execute plugin requires LogService.MessageOut:Connect()

local function createEvent()
	local connections: { (any) -> () } = {}
	local event = {}

	function event:Connect(fn: (any) -> ())
		table.insert(connections, fn)
		return {
			Disconnect = function()
				for i, c in connections do
					if c == fn then
						table.remove(connections, i)
						break
					end
				end
			end,
		}
	end

	function event:_fire(...)
		for _, fn in connections do
			task.spawn(fn, ...)
		end
	end

	return event
end

local messageOutEvent = createEvent()

local mockLogService = {
	MessageOut = messageOutEvent,
}

-- Wrap game proxy to intercept LogService
local mockGame = setmetatable({}, {
	__index = function(_, key)
		if key == "GetService" then
			return function(_self: any, serviceName: string)
				if serviceName == "LogService" then
					return mockLogService
				end
				return rawGame:GetService(serviceName)
			end
		end
		return (rawGame :: any)[key]
	end,
	__newindex = function(_, key, value)
		(rawGame :: any)[key] = value
	end,
	__tostring = function()
		return tostring(rawGame)
	end,
})

-- ======== Load Runtime ========

local runtimeSrcPath = process.cwd .. "/packages/runtime/src/init.lua"
if not fs.isFile(runtimeSrcPath) then
	print("FAIL: Runtime source not found: " .. runtimeSrcPath)
	process.exit(1)
end

local runtimeSource = fs.readFile(runtimeSrcPath)

local scriptInstance = roblox.Instance.new("ModuleScript")
scriptInstance.Name = "__HubRuntime__"
scriptInstance.Parent = rawGame:GetService("ReplicatedStorage")

local chunk, loadErr = loadstring(runtimeSource, "runtime/init.lua")
if not chunk then
	print("FAIL: Could not parse runtime: " .. tostring(loadErr))
	process.exit(1)
end

local realLoadstring = loadstring

local MockEnum = setmetatable({
	WebStreamClientType = { WebSocket = "WebSocket" },
	HttpContentType = { ApplicationJson = "application/json" },
	MessageType = { MessageOutput = 0, MessageInfo = 1, MessageWarning = 2, MessageError = 3 },
}, { __index = Enum })

local env: { [string]: any }
env = setmetatable({
	game = mockGame,
	script = scriptInstance,
	require = require,
	print = print,
	warn = warn,
	error = error,
	pcall = pcall,
	xpcall = xpcall,
	type = type,
	typeof = typeof,
	tostring = tostring,
	tonumber = tonumber,
	ipairs = ipairs,
	pairs = pairs,
	select = select,
	unpack = unpack,
	rawget = rawget,
	rawset = rawset,
	rawequal = rawequal,
	setmetatable = setmetatable,
	getmetatable = getmetatable,
	table = table,
	string = string,
	math = math,
	task = task,
	Enum = MockEnum,
	Color3 = (Color3 :: any),
	Instance = roblox.Instance,
	setfenv = setfenv,
	getfenv = getfenv,
	-- Custom loadstring: env-aware so loadstring'd code can access `game` etc.
	loadstring = function(code: string, name: string?)
		local fn, err = realLoadstring(code, name)
		if fn then
			setfenv(fn, env)
		end
		return fn, err
	end,
}, { __index = _G }) :: any

setfenv(chunk, env)
local Runtime = chunk()

if not Runtime then
	print("FAIL: Runtime returned nil")
	process.exit(1)
end

-- ======== Load Real Plugins ========

local function loadPlugin(srcPath: string, name: string)
	if not fs.isFile(srcPath) then
		print("FAIL: Plugin source not found: " .. srcPath)
		process.exit(1)
	end

	local src = fs.readFile(srcPath)
	local pluginChunk, err = realLoadstring(src, name)
	if not pluginChunk then
		print("FAIL: Could not parse plugin " .. name .. ": " .. tostring(err))
		process.exit(1)
	end

	setfenv(pluginChunk, env)
	local pluginResult = pluginChunk()

	-- Support old format (function) and new format ({dependencies, init})
	if type(pluginResult) == "function" then
		pluginResult(Runtime)
	elseif type(pluginResult) == "table" and type(pluginResult.init) == "function" then
		pluginResult.init(Runtime)
	else
		print("FAIL: Invalid plugin format: " .. name)
		process.exit(1)
	end
end

loadPlugin(process.cwd .. "/packages/plugins/execute/src/init.lua", "execute")
loadPlugin(process.cwd .. "/packages/plugins/get-studio-info/src/init.lua", "getStudioInfo")

-- ======== Register Test Helpers ========

Runtime:registerHandler({
	name = "_setGameState",
	description = "Test helper: change mock gameState",
	inputSchema = {
		type = "object",
		properties = {
			state = { type = "string", enum = { "edit", "play" } },
		},
		required = { "state" },
	},
	context = "both",
}, function(params: { state: string })
	controller:setGameState(params.state)
	return { success = true }
end)

-- ======== Connect via MockPlugin ========

local MockPlugin = require("../lib/mock-plugin")
local mockPlugin = MockPlugin.create(mockGame, Runtime, port)

mockPlugin:connect()

-- Wait for connection
for _ = 1, 50 do
	task.wait(0.1)
	if mockPlugin.isConnected then
		break
	end
end

if not mockPlugin.isConnected then
	print("FAIL: Connection timeout")
	process.exit(1)
end

print("READY:" .. tostring(mockPlugin.studioId))

-- Stay alive until killed by parent process
while true do
	task.wait(1)
end
