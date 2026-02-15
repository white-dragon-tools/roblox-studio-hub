--!strict
--[[
	Hub Runtime Framework
	Pure framework: handler registration, HTTP communication, plugin loading.
	All business logic lives in builtins/ and plugins/.
]]

local HttpService = game:GetService("HttpService")

local Runtime = {}
Runtime._handlers = {} :: { [string]: (params: { [string]: any }) -> any }
Runtime._methods = {} :: { [string]: { name: string, description: string, inputSchema: any } }
Runtime._pollEnabled = false
Runtime._pollThread = nil :: thread?
Runtime._baseUrl = ""
Runtime._pluginsLoaded = false
Runtime.isConnected = false
Runtime.studioId = nil :: string?
Runtime.debugMode = false

-- Event callbacks (set by plugin UI)
Runtime.onConnected = nil :: ((studioId: string) -> ())?
Runtime.onDisconnected = nil :: (() -> ())?
Runtime.onStatusChange = nil :: ((status: string, color: Color3?) -> ())?

-- === Public API ===

function Runtime:registerHandler(descriptor: { name: string, description: string, inputSchema: any }, handler: (params: { [string]: any }) -> any)
	local name = descriptor.name
	self._handlers[name] = handler
	self._methods[name] = {
		name = descriptor.name,
		description = descriptor.description,
		inputSchema = descriptor.inputSchema,
	}
end

function Runtime:getAvailableMethods(): { { name: string, description: string, inputSchema: any } }
	local methods = {}
	for _, method in self._methods do
		table.insert(methods, method)
	end
	return methods
end

function Runtime:connect(port: number)
	-- Stop existing poll
	self._pollEnabled = false
	if self._pollThread then
		task.cancel(self._pollThread)
		self._pollThread = nil
	end

	self._baseUrl = "http://localhost:" .. port

	if self.onStatusChange then
		self.onStatusChange("Connecting...", Color3.fromRGB(255, 200, 0))
	end

	-- Load plugins on first connect
	if not self._pluginsLoaded then
		self:_loadPlugins()
		self._pluginsLoaded = true
	end

	-- Start polling
	self._pollEnabled = true
	self._pollThread = task.spawn(function()
		self:_pollLoop()
	end)
end

function Runtime:disconnect()
	self._pollEnabled = false

	if self._pollThread then
		task.cancel(self._pollThread)
		self._pollThread = nil
	end

	self.isConnected = false
	self.studioId = nil

	if self.onStatusChange then
		self.onStatusChange("Disconnected", Color3.fromRGB(200, 200, 200))
	end
	if self.onDisconnected then
		self.onDisconnected()
	end
end

-- === Internal Methods ===

function Runtime:_sendResult(id: string, payload: { [string]: any })
	local success, err = pcall(function()
		HttpService:PostAsync(
			self._baseUrl .. "/api/studio/result",
			HttpService:JSONEncode({
				id = id,
				payload = payload,
			}),
			Enum.HttpContentType.ApplicationJson
		)
	end)
	if not success then
		warn("[HubRuntime] Failed to send result:", err)
	end
end

function Runtime:_dispatchCommand(command: { [string]: any })
	local handler = self._handlers[command.type]
	if not handler then
		if command.type ~= "disconnect" then
			warn("[HubRuntime] Unknown method: " .. tostring(command.type))
		end
		return
	end

	task.spawn(function()
		local ok, result = pcall(handler, command.params or {})
		if command.id then
			if ok then
				self:_sendResult(command.id, result or { success = true })
			else
				self:_sendResult(command.id, { success = false, error = tostring(result) })
			end
		end
	end)
end

function Runtime:_getStudioInfo(): { [string]: any }
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
		methods = self:getAvailableMethods(),
	}
end

function Runtime:_pollLoop()
	local POLL_TIMEOUT = 30

	while self._pollEnabled do
		local studioInfo = self:_getStudioInfo()
		local bodyJson = HttpService:JSONEncode({
			studioInfo = studioInfo,
			timeout = POLL_TIMEOUT,
		})

		local success, response = pcall(function()
			return HttpService:PostAsync(
				self._baseUrl .. "/api/studio/poll",
				bodyJson,
				Enum.HttpContentType.ApplicationJson
			)
		end)

		if success then
			if not self.isConnected then
				self.isConnected = true
				if self.onStatusChange then
					self.onStatusChange("Connected", Color3.fromRGB(100, 255, 100))
				end
			end

			local parseSuccess, data = pcall(function()
				return HttpService:JSONDecode(response)
			end)

			if parseSuccess and data then
				if data.studioId then
					self.studioId = data.studioId
					if self.onConnected then
						self.onConnected(data.studioId)
					end
				end

				if data.commands then
					for _, command in ipairs(data.commands) do
						self:_dispatchCommand(command)
					end
				end
			end
		else
			if self.isConnected then
				self.isConnected = false
				if self.onStatusChange then
					self.onStatusChange("Disconnected", Color3.fromRGB(200, 200, 200))
				end
				if self.onDisconnected then
					self.onDisconnected()
				end
			end

			-- Wait before retry
			if self._pollEnabled then
				if self.onStatusChange then
					self.onStatusChange("Reconnecting...", Color3.fromRGB(255, 200, 0))
				end
				task.wait(2)
			end
		end
	end
end

function Runtime:_loadPlugins()
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

return Runtime
