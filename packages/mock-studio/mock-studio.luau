--[[
	mock-studio.luau

	Main entry point for Mock Studio.
	Sets up the complete simulated environment, then loads the real Runtime.

	Usage: lune run packages/mock-studio/mock-studio -- <port> [options]
]]

local process = require("@lune/process")
local task = require("@lune/task")

local MockRoblox = require("lib/mock-roblox")
local MockTransport = require("lib/mock-transport")

-- Parse args
local port = tonumber(process.args[1])
if not port then
	print("Usage: lune run mock-studio -- <port>")
	process.exit(1)
end

-- 1. Create mock game
local game = MockRoblox.create({
	placeName = "MockStudioPlace",
	localPath = "/tmp/mock-studio.rbxl",
})

-- 2. Install WS transport mock
MockTransport.install()

-- 3. Set global `game` (Runtime uses it directly)
-- In Lune, `game` is already available via Instance.new("DataModel")
-- The runtime references `game` as a global — we need to make our mock game the global
-- This is the tricky part: Lune's require() for runtime will use its own `game` global

print("[MockStudio] Environment ready, port: " .. port)
print("[MockStudio] game.Name: " .. game.Name)

-- 4. The real Runtime will be loaded by test scenarios
-- This module just exports the setup
return {
	game = game,
	port = port,
}
