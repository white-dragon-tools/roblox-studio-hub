--!strict
--[[
	Hub Runtime Framework
	Pure framework: handler registration, WebSocket communication, plugin loading.
	All business logic lives in builtins/ and plugins/.
]]

local HttpService = game:GetService("HttpService")
local RunService = game:GetService("RunService")

local Runtime = {}
Runtime._handlers = {} :: { [string]: (params: { [string]: any }) -> any }
Runtime._methods = {} :: { [string]: { name: string, description: string, inputSchema: any, context: string? } }
Runtime._ws = nil :: any?
Runtime._wsEnabled = false
Runtime._reconnectThread = nil :: thread?
Runtime._baseUrl = ""
Runtime._port = 0
Runtime._pluginsLoaded = false
Runtime.isConnected = false
Runtime.studioId = nil :: string?
Runtime.debugMode = false
Runtime.gameState = "edit" :: "edit" | "play"

-- Event callbacks (set by plugin UI)
Runtime.onConnected = nil :: ((studioId: string) -> ())?
Runtime.onDisconnected = nil :: (() -> ())?
Runtime.onStatusChange = nil :: ((status: string, color: Color3?) -> ())?
Runtime.onGameStateChange = nil :: ((state: string) -> ())?

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

function Runtime:connect(port: number)
	-- Stop existing connection
	self:disconnect()

	self._port = port
	self._baseUrl = "http://localhost:" .. port

	if self.onStatusChange then
		self.onStatusChange("Connecting...", Color3.fromRGB(255, 200, 0))
	end

	-- Load plugins on first connect
	if not self._pluginsLoaded then
		self:_loadPlugins()
		self._pluginsLoaded = true
	end

	-- Detect initial gameState
	self.gameState = self:_detectGameState()

	-- Start WebSocket connection
	self._wsEnabled = true
	self:_wsConnect()
end

function Runtime:disconnect()
	self._wsEnabled = false

	if self._reconnectThread then
		task.cancel(self._reconnectThread)
		self._reconnectThread = nil
	end

	if self._ws then
		pcall(function()
			self._ws:Close()
		end)
		self._ws = nil
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

function Runtime:_detectGameState(): "edit" | "play"
	if RunService:IsEdit() then
		return "edit"
	end
	return "play"
end

function Runtime:_wsConnect()
	if not self._wsEnabled then return end

	local wsUrl = "ws://localhost:" .. self._port

	local ok, ws = pcall(function()
		return HttpService:CreateWebStreamClient(
			Enum.WebStreamClientType.WebSocket,
			{ Url = wsUrl }
		)
	end)

	if not ok or not ws then
		warn("[HubRuntime] WebSocket connection failed:", ws)
		self:_scheduleReconnect()
		return
	end

	self._ws = ws

	ws.MessageReceived:Connect(function(msg: string)
		self:_handleWsMessage(msg)
	end)

	ws.Closed:Connect(function()
		self:_handleWsClose()
	end)

	-- Send hello
	self:_sendHello()
end

function Runtime:_sendHello()
	local hello = HttpService:JSONEncode({
		type = "hello",
		studioInfo = self:_getStudioInfo(),
		methods = self:getAvailableMethods(),
		gameState = self.gameState,
	})

	pcall(function()
		self._ws:Send(hello)
	end)
end

function Runtime:_handleWsMessage(raw: string)
	local ok, msg = pcall(function()
		return HttpService:JSONDecode(raw)
	end)

	if not ok or not msg or not msg.type then
		warn("[HubRuntime] Invalid WS message:", raw)
		return
	end

	if msg.type == "welcome" then
		self.studioId = msg.studioId
		self.isConnected = true

		if self.onStatusChange then
			self.onStatusChange("Connected (WS)", Color3.fromRGB(100, 255, 100))
		end
		if self.onConnected then
			self.onConnected(msg.studioId)
		end

		-- Start monitoring gameState changes
		self:_monitorGameState()

	elseif msg.type == "command" then
		self:_dispatchCommand({
			id = msg.id,
			type = msg.method,
			params = msg.params,
		})

	elseif msg.type == "ping" then
		pcall(function()
			self._ws:Send(HttpService:JSONEncode({ type = "pong" }))
		end)

	elseif msg.type == "subscribe" then
		-- Phase 后续实现
		if self.debugMode then
			print("[HubRuntime] Subscribe:", msg.event)
		end

	elseif msg.type == "unsubscribe" then
		-- Phase 后续实现
		if self.debugMode then
			print("[HubRuntime] Unsubscribe:", msg.event)
		end
	end
end

function Runtime:_handleWsClose()
	self._ws = nil

	if self.isConnected then
		self.isConnected = false
		if self.onStatusChange then
			self.onStatusChange("Disconnected", Color3.fromRGB(200, 200, 200))
		end
		if self.onDisconnected then
			self.onDisconnected()
		end
	end

	self:_scheduleReconnect()
end

function Runtime:_scheduleReconnect()
	if not self._wsEnabled then return end

	if self._reconnectThread then
		task.cancel(self._reconnectThread)
	end

	self._reconnectThread = task.delay(3, function()
		self._reconnectThread = nil
		if self.onStatusChange then
			self.onStatusChange("Reconnecting...", Color3.fromRGB(255, 200, 0))
		end
		self:_wsConnect()
	end)
end

function Runtime:_sendResult(id: string, payload: { [string]: any })
	if not self._ws then return end

	local ok, err = pcall(function()
		self._ws:Send(HttpService:JSONEncode({
			type = "result",
			id = id,
			payload = payload,
		}))
	end)

	if not ok then
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

function Runtime:_monitorGameState()
	-- Check gameState periodically
	task.spawn(function()
		while self.isConnected and self._ws do
			local newState = self:_detectGameState()
			if newState ~= self.gameState then
				self.gameState = newState
				pcall(function()
					self._ws:Send(HttpService:JSONEncode({
						type = "state",
						gameState = newState,
					}))
				end)
				if self.onGameStateChange then
					self.onGameStateChange(newState)
				end
			end
			task.wait(1)
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
	}
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
