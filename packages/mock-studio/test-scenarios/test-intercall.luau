--[[
	test-intercall.luau

	Tests: Runtime:call() for inter-plugin communication.
	Plugin A registers "add", Plugin B calls it via runtime:call().

	Usage: lune run packages/mock-studio/test-scenarios/test-intercall
]]

local roblox = require("@lune/roblox")
local fs = require("@lune/fs")
local process = require("@lune/process")
local task = require("@lune/task")

-- ======== Setup ========
local MockRoblox = require("../lib/mock-roblox")
local game, _controller = MockRoblox.create({
	placeName = "InterCallTestPlace",
})

-- Load runtime via loadstring
local runtimeSrcPath = process.cwd .. "/packages/runtime/src/init.lua"
local runtimeSource = fs.readFile(runtimeSrcPath)

local scriptInstance = roblox.Instance.new("ModuleScript")
scriptInstance.Name = "__HubRuntime__"
scriptInstance.Parent = game:GetService("ReplicatedStorage")

local chunk = assert(loadstring(runtimeSource, "runtime/init.lua"))

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
	Enum = Enum,
}, { __index = _G })

setfenv(chunk, env)
local Runtime = chunk()

-- ======== Test 1: Basic call ========
print("[test-intercall] Test 1: Basic runtime:call()")

-- Plugin A: "add" method
Runtime:registerHandler({
	name = "add",
	description = "Add two numbers",
	inputSchema = { type = "object", properties = { a = { type = "number" }, b = { type = "number" } } },
	context = "both",
}, function(params)
	return params.a + params.b
end)

local result1 = Runtime:call("add", { a = 3, b = 4 })
assert(result1 == 7, "Expected 7, got " .. tostring(result1))
print("[test-intercall] Test 1 PASS: call('add', {a=3, b=4}) = 7")

-- ======== Test 2: Call with complex return ========
print("[test-intercall] Test 2: Complex return value")

Runtime:registerHandler({
	name = "getInfo",
	description = "Return structured data",
	inputSchema = { type = "object", properties = {} },
	context = "both",
}, function(_params)
	return { name = "test", version = "1.0", tags = { "a", "b" } }
end)

local result2 = Runtime:call("getInfo", {})
assert(type(result2) == "table", "Expected table")
assert(result2.name == "test", "Expected name=test")
assert(result2.version == "1.0", "Expected version=1.0")
assert(#result2.tags == 2, "Expected 2 tags")
print("[test-intercall] Test 2 PASS: complex return value preserved")

-- ======== Test 3: Unknown method throws ========
print("[test-intercall] Test 3: Unknown method error")

local ok3, err3 = pcall(function()
	Runtime:call("nonexistent", {})
end)
assert(not ok3, "Expected error for unknown method")
assert(string.find(tostring(err3), "Unknown method"), "Expected 'Unknown method' in error: " .. tostring(err3))
print("[test-intercall] Test 3 PASS: unknown method throws error")

-- ======== Test 4: Handler error propagates ========
print("[test-intercall] Test 4: Handler error propagation")

Runtime:registerHandler({
	name = "failHandler",
	description = "Always fails",
	inputSchema = { type = "object", properties = {} },
	context = "both",
}, function(_params)
	error("intentional failure")
end)

local ok4, err4 = pcall(function()
	Runtime:call("failHandler", {})
end)
assert(not ok4, "Expected error from failing handler")
assert(string.find(tostring(err4), "intentional failure"), "Expected 'intentional failure' in error")
print("[test-intercall] Test 4 PASS: handler error propagates")

-- ======== Test 5: Nil params defaults to empty table ========
print("[test-intercall] Test 5: Nil params")

Runtime:registerHandler({
	name = "noParams",
	description = "Accepts no params",
	inputSchema = { type = "object", properties = {} },
	context = "both",
}, function(params)
	return type(params) == "table"
end)

local result5 = Runtime:call("noParams")
assert(result5 == true, "Expected params to be a table when nil is passed")
print("[test-intercall] Test 5 PASS: nil params defaults to empty table")

-- ======== Test 6: Inter-plugin call chain ========
print("[test-intercall] Test 6: Inter-plugin call chain")

-- Plugin C calls Plugin A's "add" method
Runtime:registerHandler({
	name = "doubleAdd",
	description = "Calls add twice and sums results",
	inputSchema = { type = "object", properties = { a = { type = "number" }, b = { type = "number" }, c = { type = "number" } } },
	context = "both",
}, function(params)
	local sum1 = Runtime:call("add", { a = params.a, b = params.b })
	local sum2 = Runtime:call("add", { a = sum1, b = params.c })
	return sum2
end)

local result6 = Runtime:call("doubleAdd", { a = 1, b = 2, c = 3 })
assert(result6 == 6, "Expected 6, got " .. tostring(result6))
print("[test-intercall] Test 6 PASS: inter-plugin call chain works (1+2+3=6)")

-- ======== Done ========
print("PASS: InterCall test passed (all 6 tests)")
process.exit(0)
