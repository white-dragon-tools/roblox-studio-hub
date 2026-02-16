--[[
	test-notify.luau

	Tests: Runtime notification API (registerNotification, activateNotification,
	deactivateNotification, setNotifySink, notify, getRegisteredNotifications).

	Usage: lune run packages/mock-studio/test-scenarios/test-notify
]]

local roblox = require("@lune/roblox")
local fs = require("@lune/fs")
local process = require("@lune/process")
local task = require("@lune/task")

-- ======== Setup: Load Runtime ========
local MockRoblox = require("../lib/mock-roblox")
local game, _controller = MockRoblox.create({
	placeName = "NotifyTestPlace",
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

-- ======== Test 1: registerNotification + getRegisteredNotifications ========
print("[test-notify] Test 1: registerNotification + getRegisteredNotifications")

Runtime:registerNotification("event1", function(_runtime)
	return function() end -- cleanup
end)

Runtime:registerNotification("event2", function(_runtime)
	return function() end -- cleanup
end)

local registered = Runtime:getRegisteredNotifications()
assert(#registered == 2, "Expected 2 registered events, got " .. #registered)

local hasEvent1, hasEvent2 = false, false
for _, event in registered do
	if event == "event1" then hasEvent1 = true end
	if event == "event2" then hasEvent2 = true end
end
assert(hasEvent1, "Expected event1 in registered list")
assert(hasEvent2, "Expected event2 in registered list")

print("[test-notify] Test 1 PASS: registerNotification + getRegisteredNotifications")

-- ======== Test 2: activateNotification calls setup function ========
print("[test-notify] Test 2: activateNotification calls setup function")

local setupCalled = false
local cleanupFn = function()
	-- cleanup logic
end

Runtime:registerNotification("testActivate", function(_runtime)
	setupCalled = true
	return cleanupFn
end)

Runtime:activateNotification("testActivate")
assert(setupCalled, "Expected setup function to be called")
print("[test-notify] Test 2 PASS: activateNotification calls setup function")

-- ======== Test 3: activateNotification twice is no-op ========
print("[test-notify] Test 3: activateNotification twice is no-op")

local setupCount = 0
Runtime:registerNotification("testActivateTwice", function(_runtime)
	setupCount = setupCount + 1
	return function() end
end)

Runtime:activateNotification("testActivateTwice")
assert(setupCount == 1, "Expected setup to be called once, got " .. setupCount)

Runtime:activateNotification("testActivateTwice")
assert(setupCount == 1, "Expected setup to still be called once (no-op on second activate), got " .. setupCount)

print("[test-notify] Test 3 PASS: activateNotification twice is no-op")

-- ======== Test 4: deactivateNotification calls cleanup ========
print("[test-notify] Test 4: deactivateNotification calls cleanup")

local cleanupCalled = false
Runtime:registerNotification("testDeactivate", function(_runtime)
	return function()
		cleanupCalled = true
	end
end)

Runtime:activateNotification("testDeactivate")
assert(not cleanupCalled, "Cleanup should not be called yet")

Runtime:deactivateNotification("testDeactivate")
assert(cleanupCalled, "Expected cleanup function to be called")

print("[test-notify] Test 4 PASS: deactivateNotification calls cleanup")

-- ======== Test 5: deactivateNotification when not active is no-op ========
print("[test-notify] Test 5: deactivateNotification when not active is no-op")

Runtime:registerNotification("testDeactivateNoOp", function(_runtime)
	return function()
		error("Cleanup should not be called")
	end
end)

-- Never activate, just try to deactivate
Runtime:deactivateNotification("testDeactivateNoOp")
-- Should not error
print("[test-notify] Test 5 PASS: deactivateNotification when not active is no-op")

-- ======== Test 6: activateNotification for unregistered event warns ========
print("[test-notify] Test 6: activateNotification for unregistered event warns")

-- This should warn but not error
Runtime:activateNotification("nonexistentEvent")
-- If it doesn't error, test passes
print("[test-notify] Test 6 PASS: activateNotification for unregistered event warns but doesn't error")

-- ======== Test 7: setNotifySink + notify ========
print("[test-notify] Test 7: setNotifySink + notify")

local notifyEvents = {}
Runtime:setNotifySink(function(event, data)
	table.insert(notifyEvents, { event = event, data = data })
end)

Runtime:notify("customEvent", { key = "value" })
assert(#notifyEvents == 1, "Expected 1 notification, got " .. #notifyEvents)
assert(notifyEvents[1].event == "customEvent", "Expected event 'customEvent', got " .. notifyEvents[1].event)
assert(notifyEvents[1].data.key == "value", "Expected data.key='value'")

Runtime:notify("anotherEvent", { count = 42 })
assert(#notifyEvents == 2, "Expected 2 notifications, got " .. #notifyEvents)
assert(notifyEvents[2].event == "anotherEvent", "Expected event 'anotherEvent'")
assert(notifyEvents[2].data.count == 42, "Expected data.count=42")

print("[test-notify] Test 7 PASS: setNotifySink + notify")

-- ======== Test 8: notify without sink is no-op ========
print("[test-notify] Test 8: notify without sink is no-op")

-- Create fresh Runtime-like instance by reloading
local scriptInstance2 = roblox.Instance.new("ModuleScript")
scriptInstance2.Name = "__HubRuntime2__"
scriptInstance2.Parent = game:GetService("ReplicatedStorage")

local chunk2 = assert(loadstring(runtimeSource, "runtime/init.lua"))
local env2 = setmetatable({
	game = game,
	script = scriptInstance2,
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
setfenv(chunk2, env2)
local Runtime2 = chunk2()

-- No sink set, notify should not error
Runtime2:notify("noSinkEvent", { data = "test" })
print("[test-notify] Test 8 PASS: notify without sink is no-op")

-- ======== Test 9: Full lifecycle ========
print("[test-notify] Test 9: Full lifecycle")

local lifecycleEvents = {}
local lifecycleSetupCount = 0
local lifecycleCleanupCount = 0

Runtime:setNotifySink(function(event, data)
	table.insert(lifecycleEvents, { event = event, data = data })
end)

Runtime:registerNotification("lifecycleEvent", function(_runtime)
	lifecycleSetupCount = lifecycleSetupCount + 1
	return function()
		lifecycleCleanupCount = lifecycleCleanupCount + 1
	end
end)

-- Step 1: Activate
Runtime:activateNotification("lifecycleEvent")
assert(lifecycleSetupCount == 1, "Expected setup count=1, got " .. lifecycleSetupCount)

-- Step 2: Notify
Runtime:notify("lifecycleEvent", { phase = "active" })
assert(#lifecycleEvents == 1, "Expected 1 notification")
assert(lifecycleEvents[1].event == "lifecycleEvent", "Expected lifecycleEvent")
assert(lifecycleEvents[1].data.phase == "active", "Expected phase='active'")

-- Step 3: Deactivate
Runtime:deactivateNotification("lifecycleEvent")
assert(lifecycleCleanupCount == 1, "Expected cleanup count=1, got " .. lifecycleCleanupCount)

-- Step 4: Re-activate
Runtime:activateNotification("lifecycleEvent")
assert(lifecycleSetupCount == 2, "Expected setup count=2 after re-activate, got " .. lifecycleSetupCount)

-- Step 5: Notify again
Runtime:notify("lifecycleEvent", { phase = "reactivated" })
assert(#lifecycleEvents == 2, "Expected 2 notifications")
assert(lifecycleEvents[2].data.phase == "reactivated", "Expected phase='reactivated'")

print("[test-notify] Test 9 PASS: Full lifecycle (register → activate → notify → deactivate → re-activate → notify)")

-- ======== Test 10: Cleanup handle can be nil or non-function ========
print("[test-notify] Test 10: Cleanup handle can be nil or non-function")

Runtime:registerNotification("noCleanup", function(_runtime)
	return nil -- no cleanup
end)

Runtime:activateNotification("noCleanup")
Runtime:deactivateNotification("noCleanup") -- Should not error

Runtime:registerNotification("stringCleanup", function(_runtime)
	return "not a function" -- invalid cleanup, should not error
end)

Runtime:activateNotification("stringCleanup")
Runtime:deactivateNotification("stringCleanup") -- Should not error

print("[test-notify] Test 10 PASS: Cleanup handle can be nil or non-function")

-- ======== Test 11: Setup function error is caught ========
print("[test-notify] Test 11: Setup function error is caught")

Runtime:registerNotification("errorSetup", function(_runtime)
	error("setup failed")
end)

-- Should warn but not propagate error
Runtime:activateNotification("errorSetup")
print("[test-notify] Test 11 PASS: Setup function error is caught")

-- ======== Test 12: Cleanup function error is caught ========
print("[test-notify] Test 12: Cleanup function error is caught")

Runtime:registerNotification("errorCleanup", function(_runtime)
	return function()
		error("cleanup failed")
	end
end)

Runtime:activateNotification("errorCleanup")
-- Should warn but not propagate error
Runtime:deactivateNotification("errorCleanup")
print("[test-notify] Test 12 PASS: Cleanup function error is caught")

-- ======== Done ========
print("PASS: Notification API test passed (all 12 tests)")
process.exit(0)
