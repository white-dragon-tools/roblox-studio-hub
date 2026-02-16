--[[
	mock-plugin.luau

	Simulates the Studio Plugin's WS connection behavior for testing.
	In real Studio, the Plugin owns the WS; in tests, this module fills that role.

	Usage:
		local MockPlugin = require("../lib/mock-plugin")
		local mockPlugin = MockPlugin.create(game, Runtime, port)
		mockPlugin:connect()
		-- ... run tests ...
		mockPlugin:disconnect()
]]

local task = require("@lune/task")

local MockPlugin = {}

export type MockPluginInstance = {
	isConnected: boolean,
	studioId: string?,
	gameState: string,
	connect: (self: MockPluginInstance) -> (),
	disconnect: (self: MockPluginInstance) -> (),
	onConnected: ((studioId: string) -> ())?,
	onDisconnected: (() -> ())?,
	onGameStateChange: ((state: string) -> ())?,
}

function MockPlugin.create(game: any, Runtime: any, port: number): MockPluginInstance
	local HttpService = game:GetService("HttpService")

	local self = {
		isConnected = false,
		studioId = nil :: string?,
		gameState = Runtime:detectGameState(),
		onConnected = nil :: ((studioId: string) -> ())?,
		onDisconnected = nil :: (() -> ())?,
		onGameStateChange = nil :: ((state: string) -> ())?,
	}

	local ws: any = nil
	local wsEnabled = false
	local reconnectThread: thread? = nil

	local function sendMessage(msg: { [string]: any })
		if not ws then return end
		pcall(function()
			ws:Send(HttpService:JSONEncode(msg))
		end)
	end

	local function sendHello()
		sendMessage({
			type = "hello",
			studioInfo = Runtime:getStudioInfo(),
			methods = Runtime:getAvailableMethods(),
			gameState = self.gameState,
		})
	end

	local function sendResult(id: string, payload: { [string]: any })
		sendMessage({
			type = "result",
			id = id,
			payload = payload,
		})
	end

	local function dispatchCommand(id: string?, method: string, params: { [string]: any }?)
		local ok, result = Runtime:executeHandler(method, params or {})
		if id then
			if ok then
				sendResult(id, result or { success = true })
			else
				sendResult(id, { success = false, error = tostring(result) })
			end
		end
	end

	local function monitorGameState()
		task.spawn(function()
			while self.isConnected and ws do
				local newState = Runtime:detectGameState()
				if newState ~= self.gameState then
					self.gameState = newState
					sendMessage({
						type = "state",
						gameState = newState,
					})
					if self.onGameStateChange then
						self.onGameStateChange(newState)
					end
				end
				task.wait(1)
			end
		end)
	end

	local function handleWsMessage(raw: string)
		local ok, msg = pcall(function()
			return HttpService:JSONDecode(raw)
		end)

		if not ok or not msg or not msg.type then
			warn("[MockPlugin] Invalid WS message:", raw)
			return
		end

		if msg.type == "welcome" then
			self.studioId = msg.studioId
			self.isConnected = true
			if self.onConnected then
				self.onConnected(msg.studioId)
			end
			monitorGameState()

		elseif msg.type == "command" then
			task.spawn(dispatchCommand, msg.id, msg.method, msg.params)

		elseif msg.type == "ping" then
			sendMessage({ type = "pong" })

		elseif msg.type == "subscribe" then
			-- placeholder
		elseif msg.type == "unsubscribe" then
			-- placeholder
		end
	end

	local function scheduleReconnect()
		if not wsEnabled then return end

		if reconnectThread then
			task.cancel(reconnectThread)
		end

		reconnectThread = task.delay(3, function()
			reconnectThread = nil
			self:connect()
		end)
	end

	function self:connect()
		self:disconnect()
		wsEnabled = true

		local wsUrl = "ws://localhost:" .. port

		local ok, newWs = pcall(function()
			return HttpService:CreateWebStreamClient(
				"WebSocket",
				{ Url = wsUrl }
			)
		end)

		if not ok or not newWs then
			warn("[MockPlugin] WebSocket connection failed:", newWs)
			scheduleReconnect()
			return
		end

		ws = newWs

		ws.MessageReceived:Connect(function(msg: string)
			handleWsMessage(msg)
		end)

		ws.Closed:Connect(function()
			ws = nil
			if self.isConnected then
				self.isConnected = false
				if self.onDisconnected then
					self.onDisconnected()
				end
			end
			scheduleReconnect()
		end)

		sendHello()
	end

	function self:disconnect()
		wsEnabled = false

		if reconnectThread then
			task.cancel(reconnectThread)
			reconnectThread = nil
		end

		if ws then
			pcall(function()
				ws:Close()
			end)
			ws = nil
		end

		self.isConnected = false
		self.studioId = nil

		if self.onDisconnected then
			self.onDisconnected()
		end
	end

	return self
end

return MockPlugin
