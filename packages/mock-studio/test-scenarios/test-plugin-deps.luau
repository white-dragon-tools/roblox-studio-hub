--[[
	test-plugin-deps.luau

	Tests: Plugin dependency topological sort (Runtime:_topoSort) and format support.
	Tests _topoSort directly since Lune's require() can't handle Roblox Instances.

	Usage: lune run packages/mock-studio/test-scenarios/test-plugin-deps
]]

local roblox = require("@lune/roblox")
local fs = require("@lune/fs")
local process = require("@lune/process")
local task = require("@lune/task")

-- ======== Setup: Load Runtime ========
local MockRoblox = require("../lib/mock-roblox")
local game, _controller = MockRoblox.create({
	placeName = "DepsTestPlace",
})

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

-- Helper: track init order
local initOrder = {}

local function makeInit(label: string)
	return function(_runtime)
		table.insert(initOrder, label)
	end
end

local function resetOrder()
	initOrder = {}
end

-- ======== Test 1: No dependencies — preserve order ========
print("[test-plugin-deps] Test 1: No dependencies")
resetOrder()

local sorted1 = Runtime:_topoSort({
	{ name = "A", deps = {}, init = makeInit("A") },
	{ name = "B", deps = {}, init = makeInit("B") },
	{ name = "C", deps = {}, init = makeInit("C") },
})

assert(#sorted1 == 3, "Expected 3 entries, got " .. #sorted1)
-- No deps → all should appear (order is Kahn's BFS, same as input since all have in-degree 0)
print("[test-plugin-deps] Test 1 PASS: 3 plugins sorted with no deps")

-- ======== Test 2: Linear chain A → B → C ========
print("[test-plugin-deps] Test 2: Linear chain")
resetOrder()

local sorted2 = Runtime:_topoSort({
	{ name = "C", deps = { "B" }, init = makeInit("C") },
	{ name = "A", deps = {}, init = makeInit("A") },
	{ name = "B", deps = { "A" }, init = makeInit("B") },
})

assert(#sorted2 == 3, "Expected 3 entries")
assert(sorted2[1].name == "A", "Expected A first, got " .. sorted2[1].name)
assert(sorted2[2].name == "B", "Expected B second, got " .. sorted2[2].name)
assert(sorted2[3].name == "C", "Expected C third, got " .. sorted2[3].name)
print("[test-plugin-deps] Test 2 PASS: A → B → C order correct")

-- ======== Test 3: Diamond dependency ========
print("[test-plugin-deps] Test 3: Diamond dependency")
resetOrder()

-- A → B, A → C, B → D, C → D
local sorted3 = Runtime:_topoSort({
	{ name = "D", deps = { "B", "C" }, init = makeInit("D") },
	{ name = "C", deps = { "A" }, init = makeInit("C") },
	{ name = "B", deps = { "A" }, init = makeInit("B") },
	{ name = "A", deps = {}, init = makeInit("A") },
})

assert(#sorted3 == 4, "Expected 4 entries, got " .. #sorted3)
assert(sorted3[1].name == "A", "Expected A first")

-- B and C can be in either order, but both before D
local indexMap = {}
for i, entry in sorted3 do
	indexMap[entry.name] = i
end
assert(indexMap["A"] < indexMap["B"], "A must come before B")
assert(indexMap["A"] < indexMap["C"], "A must come before C")
assert(indexMap["B"] < indexMap["D"], "B must come before D")
assert(indexMap["C"] < indexMap["D"], "C must come before D")
print("[test-plugin-deps] Test 3 PASS: diamond dependency resolved correctly")

-- ======== Test 4: Circular dependency error ========
print("[test-plugin-deps] Test 4: Circular dependency")

local ok4, err4 = pcall(function()
	Runtime:_topoSort({
		{ name = "X", deps = { "Y" }, init = makeInit("X") },
		{ name = "Y", deps = { "X" }, init = makeInit("Y") },
	})
end)

assert(not ok4, "Expected error for circular dependency")
local errStr = tostring(err4)
assert(string.find(errStr, "Circular dependency"), "Expected 'Circular dependency' in error: " .. errStr)
print("[test-plugin-deps] Test 4 PASS: circular dependency detected")

-- ======== Test 5: 3-node cycle ========
print("[test-plugin-deps] Test 5: 3-node cycle")

local ok5, err5 = pcall(function()
	Runtime:_topoSort({
		{ name = "A", deps = { "C" }, init = makeInit("A") },
		{ name = "B", deps = { "A" }, init = makeInit("B") },
		{ name = "C", deps = { "B" }, init = makeInit("C") },
	})
end)

assert(not ok5, "Expected error for 3-node cycle")
assert(string.find(tostring(err5), "Circular dependency"), "Expected 'Circular dependency' in error")
print("[test-plugin-deps] Test 5 PASS: 3-node cycle detected")

-- ======== Test 6: Empty list ========
print("[test-plugin-deps] Test 6: Empty list")

local sorted6 = Runtime:_topoSort({})
assert(#sorted6 == 0, "Expected 0 entries for empty input")
print("[test-plugin-deps] Test 6 PASS: empty list handled")

-- ======== Test 7: Single plugin with no deps ========
print("[test-plugin-deps] Test 7: Single plugin")

local sorted7 = Runtime:_topoSort({
	{ name = "solo", deps = {}, init = makeInit("solo") },
})
assert(#sorted7 == 1, "Expected 1 entry")
assert(sorted7[1].name == "solo", "Expected 'solo'")
print("[test-plugin-deps] Test 7 PASS: single plugin works")

-- ======== Test 8: Init functions actually run in order ========
print("[test-plugin-deps] Test 8: Init execution order")
resetOrder()

local sorted8 = Runtime:_topoSort({
	{ name = "last", deps = { "middle" }, init = makeInit("last") },
	{ name = "first", deps = {}, init = makeInit("first") },
	{ name = "middle", deps = { "first" }, init = makeInit("middle") },
})

-- Execute inits in sorted order
for _, entry in sorted8 do
	entry.init(Runtime)
end

assert(#initOrder == 3, "Expected 3 inits executed")
assert(initOrder[1] == "first", "Expected first init, got " .. initOrder[1])
assert(initOrder[2] == "middle", "Expected middle init, got " .. initOrder[2])
assert(initOrder[3] == "last", "Expected last init, got " .. initOrder[3])
print("[test-plugin-deps] Test 8 PASS: init execution follows topo order")

-- ======== Test 9: Dependency on non-existent plugin (still works) ========
print("[test-plugin-deps] Test 9: Dep on non-existent plugin")

-- A depends on "missing" which doesn't exist in entries
-- This is not a cycle — A just has an unresolvable dep
-- Kahn's algorithm: A has in-degree 1 (from "missing"), "missing" is never dequeued
-- So A is never dequeued → detected as cycle-like
local ok9, err9 = pcall(function()
	Runtime:_topoSort({
		{ name = "A", deps = { "missing" }, init = makeInit("A") },
	})
end)
assert(not ok9, "Expected error for unresolvable dependency")
print("[test-plugin-deps] Test 9 PASS: missing dependency detected")

-- ======== Done ========
print("PASS: Plugin dependency test passed (all 9 tests)")
process.exit(0)
