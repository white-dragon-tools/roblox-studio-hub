--[[
	mock-roblox.luau

	Simulates the minimal Roblox Studio environment needed by Runtime init.lua.
	Creates game, injects Services and methods.

	Returns gameProxy + controller for dynamic state changes (e.g. play/edit).
]]

local roblox = require("@lune/roblox")
local serde = require("@lune/serde")

local Instance = roblox.Instance

local MockRoblox = {}

export type MockGame = any
export type MockController = {
	setGameState: (self: MockController, state: "edit" | "play") -> (),
}

-- Shared mutable state (implementMethod is global per class)
local _isEdit = true

function MockRoblox.create(options: {
	placeName: string?,
	placeId: number?,
	gameId: number?,
	localPath: string?,
}?): (MockGame, MockController)
	local opts = options or {}

	-- Reset state
	_isEdit = true

	-- Create DataModel (game)
	local game = Instance.new("DataModel")

	-- Set game properties
	if opts.placeName then
		game.Name = opts.placeName
	else
		game.Name = "MockPlace"
	end

	-- Create core services
	local replicatedStorage = Instance.new("ReplicatedStorage")
	replicatedStorage.Parent = game

	local runService = Instance.new("RunService")
	runService.Parent = game

	local workspace = Instance.new("Workspace")
	workspace.Parent = game

	-- StudioService
	local studioService = Instance.new("StudioService")
	studioService.Parent = game

	-- HttpService
	local httpService = Instance.new("HttpService")
	httpService.Parent = game

	-- Implement HttpService methods
	roblox.implementMethod("HttpService", "JSONEncode", function(_self: any, data: any)
		return serde.encode("json", data)
	end)

	roblox.implementMethod("HttpService", "JSONDecode", function(_self: any, json: string)
		return serde.decode("json", json)
	end)

	-- Implement RunService — reads from shared mutable _isEdit
	roblox.implementMethod("RunService", "IsEdit", function(_self: any)
		return _isEdit
	end)

	roblox.implementMethod("RunService", "IsRunning", function(_self: any)
		return not _isEdit
	end)

	-- Implement StudioService:GetUserId()
	roblox.implementMethod("StudioService", "GetUserId", function(_self: any)
		return 12345
	end)

	-- Set localPath attribute on workspace
	if opts.localPath then
		workspace:SetAttribute("LocalPlacePath", opts.localPath)
	end

	-- Wrap game in a proxy to provide PlaceId/GameId
	-- (Lune's implementProperty doesn't work for DataModel built-in properties)
	-- Must forward method calls with real game as self
	local gameProxy = setmetatable({}, {
		__index = function(_, key)
			if key == "PlaceId" then return opts.placeId or 0 end
			if key == "GameId" then return opts.gameId or 0 end
			local val = (game :: any)[key]
			-- Wrap methods to forward self as real game Instance
			if type(val) == "function" then
				return function(_selfProxy: any, ...)
					return val(game, ...)
				end
			end
			return val
		end,
		__newindex = function(_, key, value)
			(game :: any)[key] = value
		end,
		__tostring = function()
			return tostring(game)
		end,
	})

	-- Controller for dynamic state changes
	local controller = {}

	function controller:setGameState(state: "edit" | "play")
		_isEdit = (state == "edit")
	end

	return gameProxy, controller
end

return MockRoblox
