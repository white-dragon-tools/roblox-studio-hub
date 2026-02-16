--!strict
--[[
	Hub Runtime Framework
	Pure handler registry: plugin loading, handler registration, command execution.
	WS communication is owned by the Studio Plugin.
]]

local RunService = game:GetService("RunService")

local Runtime = {}
Runtime._handlers = {} :: { [string]: (params: { [string]: any }) -> any }
Runtime._methods = {} :: { [string]: { name: string, description: string, inputSchema: any, context: string? } }
Runtime._pluginsLoaded = false
Runtime.debugMode = false

-- === Public API ===

function Runtime:registerHandler(descriptor: { name: string, description: string, inputSchema: any, context: string? }, handler: (params: { [string]: any }) -> any)
	local name = descriptor.name
	self._handlers[name] = handler
	self._methods[name] = {
		name = descriptor.name,
		description = descriptor.description,
		inputSchema = descriptor.inputSchema,
		context = descriptor.context or "both",
	}
end

function Runtime:getAvailableMethods(): { { name: string, description: string, inputSchema: any, context: string? } }
	local methods = {}
	for _, method in self._methods do
		table.insert(methods, method)
	end
	return methods
end

function Runtime:executeHandler(method: string, params: { [string]: any }): (boolean, any)
	local handler = self._handlers[method]
	if not handler then
		return false, "Unknown method: " .. tostring(method)
	end
	return pcall(handler, params or {})
end

function Runtime:loadPlugins()
	if self._pluginsLoaded then return end
	self._pluginsLoaded = true

	-- 1. Load builtin plugins (builtins/)
	local builtins = script:FindFirstChild("builtins")
	if builtins then
		for _, mod in builtins:GetChildren() do
			if mod:IsA("ModuleScript") then
				local ok, init = pcall(require, mod)
				if ok and type(init) == "function" then
					init(self)
				elseif not ok then
					warn("[HubRuntime] Failed to load builtin:", mod.Name, init)
				end
			end
		end
	end

	-- 2. Load user plugins (~/.roblox-studio-hub/plugins/)
	local plugins = script:FindFirstChild("plugins")
	if plugins then
		for _, mod in plugins:GetChildren() do
			if mod:IsA("ModuleScript") then
				local ok, init = pcall(require, mod)
				if ok and type(init) == "function" then
					init(self)
				elseif not ok then
					warn("[HubRuntime] Failed to load plugin:", mod.Name, init)
				end
			end
		end
	end
end

function Runtime:detectGameState(): "edit" | "play"
	if RunService:IsEdit() then
		return "edit"
	end
	return "play"
end

function Runtime:getStudioInfo(): { [string]: any }
	local StudioService = game:GetService("StudioService")

	local userId = 0
	pcall(function()
		userId = StudioService:GetUserId()
	end)

	local placeName = game.Name
	local creatorName = nil
	local creatorType = nil
	local localPath = nil

	if game.PlaceId > 0 then
		pcall(function()
			local MarketplaceService = game:GetService("MarketplaceService")
			local info = MarketplaceService:GetProductInfo(game.PlaceId)
			if info then
				if info.Name then
					placeName = info.Name
				end
				if info.Creator then
					creatorName = info.Creator.Name
					creatorType = info.Creator.CreatorType
				end
			end
		end)
	else
		pcall(function()
			local workspace = game:GetService("Workspace")
			localPath = workspace:GetAttribute("LocalPlacePath")
		end)
	end

	return {
		placeId = game.PlaceId,
		placeName = placeName,
		creatorName = creatorName,
		creatorType = creatorType,
		gameId = game.GameId,
		userId = userId,
		localPath = localPath,
	}
end

return Runtime
