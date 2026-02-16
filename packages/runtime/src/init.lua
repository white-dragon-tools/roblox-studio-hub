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
Runtime._notifications = {} :: { [string]: { setup: (any) -> any, cleanup: (any?) -> () } }
Runtime._notifySink = nil :: ((event: string, data: any) -> ())?
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

function Runtime:call(method: string, params: { [string]: any }?): any
	local handler = self._handlers[method]
	if not handler then
		error("Unknown method: " .. tostring(method))
	end
	return handler(params or {})
end

-- === Notification API ===

--[[
	Register a notification that plugins can emit.
	setupFn is called when the first subscriber subscribes (returns cleanup handle).
	The plugin calls runtime:notify(event, data) to emit.
]]
function Runtime:registerNotification(event: string, setupFn: (any) -> any)
	self._notifications[event] = { setup = setupFn, cleanup = nil :: any }
end

--[[
	Called by Hub (via Plugin bridge) when a client subscribes.
	Calls the setup function registered by the plugin.
]]
function Runtime:activateNotification(event: string)
	local entry = self._notifications[event]
	if not entry then
		warn("[HubRuntime] No notification registered for event:", event)
		return
	end
	if entry.cleanup then return end -- already active

	local ok, cleanup = pcall(entry.setup, self)
	if ok then
		entry.cleanup = cleanup
	else
		warn("[HubRuntime] Notification setup failed:", event, cleanup)
	end
end

--[[
	Called by Hub (via Plugin bridge) when last subscriber unsubscribes.
	Calls the cleanup function if it exists.
]]
function Runtime:deactivateNotification(event: string)
	local entry = self._notifications[event]
	if not entry or not entry.cleanup then return end

	if type(entry.cleanup) == "function" then
		pcall(entry.cleanup)
	end
	entry.cleanup = nil
end

--[[
	Set the sink function for outgoing notifications.
	Called by Plugin to wire notify → WS send.
]]
function Runtime:setNotifySink(sink: (event: string, data: any) -> ())
	self._notifySink = sink
end

--[[
	Emit a notification to all subscribers (via the sink).
	Called by plugins when an event fires.
]]
function Runtime:notify(event: string, data: any)
	if self._notifySink then
		self._notifySink(event, data)
	end
end

--[[
	Get all registered notification events.
]]
function Runtime:getRegisteredNotifications(): { string }
	local events = {}
	for event in self._notifications do
		table.insert(events, event)
	end
	return events
end

--[[
	Topological sort for plugin dependency ordering.
	Each plugin can be:
	  - Old format: return function(runtime) ... end
	  - New format: return { dependencies = {"dep1"}, init = function(runtime) ... end }
]]
function Runtime:_topoSort(pluginEntries: { { name: string, deps: { string }, init: (any) -> () } }): { { name: string, init: (any) -> () } }
	-- Build adjacency + in-degree
	local entryMap: { [string]: { name: string, deps: { string }, init: (any) -> () } } = {}
	for _, entry in pluginEntries do
		entryMap[entry.name] = entry
	end

	local inDegree: { [string]: number } = {}
	local adjacency: { [string]: { string } } = {}
	for _, entry in pluginEntries do
		inDegree[entry.name] = inDegree[entry.name] or 0
		adjacency[entry.name] = adjacency[entry.name] or {}
		for _, dep in entry.deps do
			adjacency[dep] = adjacency[dep] or {}
			table.insert(adjacency[dep], entry.name)
			inDegree[entry.name] = (inDegree[entry.name] or 0) + 1
		end
	end

	-- Kahn's algorithm
	local queue: { string } = {}
	for _, entry in pluginEntries do
		if inDegree[entry.name] == 0 then
			table.insert(queue, entry.name)
		end
	end

	local sorted: { { name: string, init: (any) -> () } } = {}
	while #queue > 0 do
		local name = table.remove(queue, 1) :: string
		local entry = entryMap[name]
		if entry then
			table.insert(sorted, { name = entry.name, init = entry.init })
		end
		for _, neighbor in (adjacency[name] or {}) do
			inDegree[neighbor] = inDegree[neighbor] - 1
			if inDegree[neighbor] == 0 then
				table.insert(queue, neighbor)
			end
		end
	end

	-- Detect cycle
	if #sorted < #pluginEntries then
		local remaining = {}
		for _, entry in pluginEntries do
			if inDegree[entry.name] > 0 then
				table.insert(remaining, entry.name)
			end
		end
		error("[HubRuntime] Circular dependency detected: " .. table.concat(remaining, ", "))
	end

	return sorted
end

function Runtime:_loadModuleFolder(folder: any)
	if not folder then return end

	local entries: { { name: string, deps: { string }, init: (any) -> () } } = {}

	for _, mod in folder:GetChildren() do
		if mod:IsA("ModuleScript") then
			local ok, result = pcall(require, mod)
			if not ok then
				warn("[HubRuntime] Failed to load plugin:", mod.Name, result)
				continue
			end

			-- Old format: return function(runtime) ... end
			if type(result) == "function" then
				table.insert(entries, {
					name = mod.Name,
					deps = {},
					init = result,
				})
			-- New format: return { dependencies = {...}, init = function(runtime) ... end }
			elseif type(result) == "table" and type(result.init) == "function" then
				local deps = {}
				if type(result.dependencies) == "table" then
					for _, d in result.dependencies do
						if type(d) == "string" then
							table.insert(deps, d)
						end
					end
				end
				table.insert(entries, {
					name = mod.Name,
					deps = deps,
					init = result.init,
				})
			else
				warn("[HubRuntime] Invalid plugin format:", mod.Name)
			end
		end
	end

	-- Sort by dependencies and initialize
	local sorted = self:_topoSort(entries)
	for _, entry in sorted do
		local ok, err = pcall(entry.init, self)
		if not ok then
			warn("[HubRuntime] Plugin init failed:", entry.name, err)
		end
	end
end

function Runtime:loadPlugins()
	if self._pluginsLoaded then return end
	self._pluginsLoaded = true

	-- 1. Load builtin plugins (builtins/) — topo sorted
	self:_loadModuleFolder(script:FindFirstChild("builtins"))

	-- 2. Load user plugins (~/.roblox-studio-hub/plugins/) — topo sorted
	self:_loadModuleFolder(script:FindFirstChild("plugins"))
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
