--!strict
--[[
	Studio Hub Plugin
	Owns the WebSocket connection to Hub.
	Loads Runtime as a pure handler registry, dispatches commands through it.
]]

local HttpService = game:GetService("HttpService")
local DEFAULT_PORT = 35888

local plugin = plugin or script:FindFirstAncestorWhichIsA("Plugin")
if not plugin then
	return
end

-- Clean up old plugin state (hot reload)
local PLUGIN_KEY = "StudioHubPlugin_Cleanup"
local oldCleanup = plugin:GetSetting(PLUGIN_KEY) :: any
if oldCleanup then
	plugin:SetSetting(PLUGIN_KEY, nil)
end

-- === State ===

local ws: any = nil
local wsEnabled = false
local reconnectThread: thread? = nil
local isConnected = false
local studioId: string? = nil
local gameState: "edit" | "play" = "edit"
local debugMode = false
local port = DEFAULT_PORT

-- === UI Setup ===

local toolbar = plugin:CreateToolbar("Studio Hub")
local toggleButton = toolbar:CreateButton("Hub", "Connect to Studio Hub", "rbxassetid://4458901886")

local widgetInfo = DockWidgetPluginGuiInfo.new(
	Enum.InitialDockState.Float,
	false,
	false,
	300,
	220,
	200,
	150
)
local widget = plugin:CreateDockWidgetPluginGui("StudioHubWidget", widgetInfo)
widget.Title = "Studio Hub"

local frame = Instance.new("Frame")
frame.Size = UDim2.new(1, 0, 1, 0)
frame.BackgroundColor3 = Color3.fromRGB(46, 46, 46)
frame.Parent = widget

local layout = Instance.new("UIListLayout")
layout.Padding = UDim.new(0, 8)
layout.SortOrder = Enum.SortOrder.LayoutOrder
layout.Parent = frame

local padding = Instance.new("UIPadding")
padding.PaddingTop = UDim.new(0, 10)
padding.PaddingBottom = UDim.new(0, 10)
padding.PaddingLeft = UDim.new(0, 10)
padding.PaddingRight = UDim.new(0, 10)
padding.Parent = frame

local statusLabel = Instance.new("TextLabel")
statusLabel.Size = UDim2.new(1, 0, 0, 20)
statusLabel.BackgroundTransparency = 1
statusLabel.TextColor3 = Color3.fromRGB(200, 200, 200)
statusLabel.TextXAlignment = Enum.TextXAlignment.Left
statusLabel.Text = "Status: Disconnected"
statusLabel.LayoutOrder = 1
statusLabel.Parent = frame

local idLabel = Instance.new("TextLabel")
idLabel.Size = UDim2.new(1, 0, 0, 20)
idLabel.BackgroundTransparency = 1
idLabel.TextColor3 = Color3.fromRGB(150, 150, 150)
idLabel.TextXAlignment = Enum.TextXAlignment.Left
idLabel.Text = "ID: -"
idLabel.LayoutOrder = 2
idLabel.Parent = frame

local gameStateLabel = Instance.new("TextLabel")
gameStateLabel.Size = UDim2.new(1, 0, 0, 20)
gameStateLabel.BackgroundTransparency = 1
gameStateLabel.TextColor3 = Color3.fromRGB(180, 180, 255)
gameStateLabel.TextXAlignment = Enum.TextXAlignment.Left
gameStateLabel.Text = "Mode: Edit"
gameStateLabel.LayoutOrder = 3
gameStateLabel.Parent = frame

local portLabel = Instance.new("TextLabel")
portLabel.Size = UDim2.new(1, 0, 0, 20)
portLabel.BackgroundTransparency = 1
portLabel.TextColor3 = Color3.fromRGB(200, 200, 200)
portLabel.TextXAlignment = Enum.TextXAlignment.Left
portLabel.Text = "Port:"
portLabel.LayoutOrder = 4
portLabel.Parent = frame

local portInput = Instance.new("TextBox")
portInput.Size = UDim2.new(1, 0, 0, 30)
portInput.BackgroundColor3 = Color3.fromRGB(60, 60, 60)
portInput.TextColor3 = Color3.fromRGB(255, 255, 255)
portInput.PlaceholderText = tostring(DEFAULT_PORT)
portInput.Text = tostring(DEFAULT_PORT)
portInput.LayoutOrder = 5
portInput.Parent = frame

local connectButton = Instance.new("TextButton")
connectButton.Size = UDim2.new(1, 0, 0, 30)
connectButton.BackgroundColor3 = Color3.fromRGB(0, 120, 215)
connectButton.TextColor3 = Color3.fromRGB(255, 255, 255)
connectButton.Text = "Connect"
connectButton.LayoutOrder = 6
connectButton.Parent = frame

-- Debug mode checkbox
local debugFrame = Instance.new("Frame")
debugFrame.Size = UDim2.new(1, 0, 0, 20)
debugFrame.BackgroundTransparency = 1
debugFrame.LayoutOrder = 7
debugFrame.Parent = frame

local debugCheckbox = Instance.new("TextButton")
debugCheckbox.Size = UDim2.new(0, 20, 0, 20)
debugCheckbox.Position = UDim2.new(0, 0, 0, 0)
debugCheckbox.BackgroundColor3 = Color3.fromRGB(60, 60, 60)
debugCheckbox.TextColor3 = Color3.fromRGB(255, 255, 255)
debugCheckbox.Text = ""
debugCheckbox.Parent = debugFrame

local debugLabel = Instance.new("TextLabel")
debugLabel.Size = UDim2.new(1, -28, 1, 0)
debugLabel.Position = UDim2.new(0, 28, 0, 0)
debugLabel.BackgroundTransparency = 1
debugLabel.TextColor3 = Color3.fromRGB(200, 200, 200)
debugLabel.TextXAlignment = Enum.TextXAlignment.Left
debugLabel.Text = "Debug Mode"
debugLabel.Parent = debugFrame

-- === UI Helpers ===

local function updateStatus(status: string, color: Color3?)
	statusLabel.Text = "Status: " .. status
	statusLabel.TextColor3 = color or Color3.fromRGB(200, 200, 200)
end

local function updateId(id: string?)
	idLabel.Text = "ID: " .. (id or "-")
end

local function updateGameState(state: string)
	if state == "edit" then
		gameStateLabel.Text = "Mode: Edit"
		gameStateLabel.TextColor3 = Color3.fromRGB(180, 180, 255)
	else
		gameStateLabel.Text = "Mode: Play"
		gameStateLabel.TextColor3 = Color3.fromRGB(100, 255, 100)
	end
end

local function updateDebugCheckbox()
	debugCheckbox.Text = debugMode and "✓" or ""
end

-- === Load Runtime ===

local runtimeModule = game:GetService("ReplicatedStorage"):FindFirstChild("__HubRuntime__")
local Runtime = nil :: any

if runtimeModule and runtimeModule:IsA("ModuleScript") then
	local ok, result = pcall(require, runtimeModule)
	if ok then
		Runtime = result
	else
		warn("[StudioHub] Failed to require Runtime:", result)
	end
end

if not Runtime then
	updateStatus("Runtime not found", Color3.fromRGB(255, 100, 100))
	connectButton.Text = "No Runtime"
	connectButton.Active = false

	local hintLabel = Instance.new("TextLabel")
	hintLabel.Size = UDim2.new(1, 0, 0, 40)
	hintLabel.BackgroundTransparency = 1
	hintLabel.TextColor3 = Color3.fromRGB(255, 200, 100)
	hintLabel.TextXAlignment = Enum.TextXAlignment.Left
	hintLabel.TextWrapped = true
	hintLabel.Text = "Use 'roblox-studio-hub open <place>' to inject Runtime."
	hintLabel.LayoutOrder = 8
	hintLabel.Parent = frame

	toggleButton.Click:Connect(function()
		widget.Enabled = not widget.Enabled
	end)

	return
end

-- Load plugins once
Runtime:loadPlugins()

-- Detect initial gameState
gameState = Runtime:detectGameState()
updateGameState(gameState)

-- === WS Connection ===

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
		gameState = gameState,
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
		while isConnected and ws do
			local newState = Runtime:detectGameState()
			if newState ~= gameState then
				gameState = newState
				sendMessage({
					type = "state",
					gameState = newState,
				})
				updateGameState(newState)
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
		warn("[StudioHub] Invalid WS message:", raw)
		return
	end

	if msg.type == "welcome" then
		studioId = msg.studioId
		isConnected = true
		updateStatus("Connected (WS)", Color3.fromRGB(100, 255, 100))
		updateId(msg.studioId)
		connectButton.Text = "Disconnect"
		monitorGameState()

	elseif msg.type == "command" then
		task.spawn(dispatchCommand, msg.id, msg.method, msg.params)

	elseif msg.type == "ping" then
		sendMessage({ type = "pong" })

	elseif msg.type == "subscribe" then
		if debugMode then
			print("[StudioHub] Subscribe:", msg.event)
		end

	elseif msg.type == "unsubscribe" then
		if debugMode then
			print("[StudioHub] Unsubscribe:", msg.event)
		end
	end
end

local function scheduleReconnect()
	if not wsEnabled then return end

	if reconnectThread then
		task.cancel(reconnectThread)
	end

	reconnectThread = task.delay(3, function()
		reconnectThread = nil
		updateStatus("Reconnecting...", Color3.fromRGB(255, 200, 0))
		wsConnect()
	end)
end

-- Forward declaration fulfilled below
function wsConnect()
	if not wsEnabled then return end

	local wsUrl = "ws://localhost:" .. port

	local ok, newWs = pcall(function()
		return HttpService:CreateWebStreamClient(
			Enum.WebStreamClientType.WebSocket,
			{ Url = wsUrl }
		)
	end)

	if not ok or not newWs then
		warn("[StudioHub] WebSocket connection failed:", newWs)
		scheduleReconnect()
		return
	end

	ws = newWs

	ws.MessageReceived:Connect(function(msg: string)
		handleWsMessage(msg)
	end)

	ws.Closed:Connect(function()
		ws = nil
		if isConnected then
			isConnected = false
			updateStatus("Disconnected", Color3.fromRGB(200, 200, 200))
			updateId(nil)
			connectButton.Text = "Connect"
		end
		scheduleReconnect()
	end)

	sendHello()
end

local function connect(p: number)
	disconnect()
	port = p
	wsEnabled = true
	updateStatus("Connecting...", Color3.fromRGB(255, 200, 0))
	wsConnect()
end

function disconnect()
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

	isConnected = false
	studioId = nil
	updateStatus("Disconnected", Color3.fromRGB(200, 200, 200))
	updateId(nil)
	connectButton.Text = "Connect"
end

-- === UI Event Handlers ===

debugCheckbox.MouseButton1Click:Connect(function()
	debugMode = not debugMode
	updateDebugCheckbox()
	Runtime.debugMode = debugMode
end)

connectButton.MouseButton1Click:Connect(function()
	if isConnected or wsEnabled then
		disconnect()
	else
		local p = tonumber(portInput.Text) or DEFAULT_PORT
		connect(p)
	end
end)

toggleButton.Click:Connect(function()
	widget.Enabled = not widget.Enabled
end)

-- Cleanup on plugin unload
plugin.Unloading:Connect(function()
	disconnect()
end)

-- Auto-connect on load
task.delay(1, function()
	connect(DEFAULT_PORT)
end)
