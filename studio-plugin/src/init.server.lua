--!strict
--[[
	Studio Hub Plugin
	Connects to Studio Hub via HTTP Long Polling for remote code execution
]]

local HttpService = game:GetService("HttpService")
local StudioService = game:GetService("StudioService")
local LogService = game:GetService("LogService")

local DEFAULT_PORT = 35888
local POLL_TIMEOUT = 30

local plugin = plugin or script:FindFirstAncestorWhichIsA("Plugin")
if not plugin then
	return
end

-- 清理旧的插件状态（热重载时）
local PLUGIN_KEY = "StudioHubPlugin_Cleanup"
local oldCleanup = plugin:GetSetting(PLUGIN_KEY) :: any
if oldCleanup then
	plugin:SetSetting(PLUGIN_KEY, nil)
end

local isConnected = false
local studioId: string? = nil
local pollEnabled = true
local pollThread: thread? = nil
local baseUrl = ""
local debugMode = false -- 调试模式开关

-- 调试打印函数
local function debugPrint(...)
	if debugMode then
		print("[StudioHub]", ...)
	end
end

-- UI Setup
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

local portLabel = Instance.new("TextLabel")
portLabel.Size = UDim2.new(1, 0, 0, 20)
portLabel.BackgroundTransparency = 1
portLabel.TextColor3 = Color3.fromRGB(200, 200, 200)
portLabel.TextXAlignment = Enum.TextXAlignment.Left
portLabel.Text = "Port:"
portLabel.LayoutOrder = 3
portLabel.Parent = frame

local portInput = Instance.new("TextBox")
portInput.Size = UDim2.new(1, 0, 0, 30)
portInput.BackgroundColor3 = Color3.fromRGB(60, 60, 60)
portInput.TextColor3 = Color3.fromRGB(255, 255, 255)
portInput.PlaceholderText = tostring(DEFAULT_PORT)
portInput.Text = tostring(DEFAULT_PORT)
portInput.LayoutOrder = 4
portInput.Parent = frame

local connectButton = Instance.new("TextButton")
connectButton.Size = UDim2.new(1, 0, 0, 30)
connectButton.BackgroundColor3 = Color3.fromRGB(0, 120, 215)
connectButton.TextColor3 = Color3.fromRGB(255, 255, 255)
connectButton.Text = "Connect"
connectButton.LayoutOrder = 5
connectButton.Parent = frame

-- Debug 模式复选框
local debugFrame = Instance.new("Frame")
debugFrame.Size = UDim2.new(1, 0, 0, 20)
debugFrame.BackgroundTransparency = 1
debugFrame.LayoutOrder = 6
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

local function updateDebugCheckbox()
	debugCheckbox.Text = debugMode and "✓" or ""
end

debugCheckbox.MouseButton1Click:Connect(function()
	debugMode = not debugMode
	updateDebugCheckbox()
	debugPrint("Debug mode:", debugMode and "ON" or "OFF")
end)

-- Forward declaration
local connect: (port: number) -> ()

-- Helper Functions
local function updateStatus(status: string, color: Color3?)
	statusLabel.Text = "Status: " .. status
	statusLabel.TextColor3 = color or Color3.fromRGB(200, 200, 200)
end

local function updateId(id: string?)
	idLabel.Text = "ID: " .. (id or "-")
	studioId = id
end

local function getStudioInfo(): {[string]: any}
	local userId = 0
	pcall(function()
		userId = StudioService:GetUserId()
	end)
	
	-- 获取游戏名称：云场景尝试获取 MarketplaceService 信息
	local placeName = game.Name
	local creatorName = nil
	local creatorType = nil
	
	if game.PlaceId > 0 then
		-- 云场景：尝试获取真实的 Place 名称
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
	end
	
	return {
		placeId = game.PlaceId,
		placeName = placeName,
		creatorName = creatorName,
		creatorType = creatorType,
		gameId = game.GameId,
		userId = userId,
	}
end

-- Send result back to hub
local function sendResult(id: string, payload: {[string]: any})
	local success, err = pcall(function()
		HttpService:PostAsync(
			baseUrl .. "/api/studio/result",
			HttpService:JSONEncode({
				id = id,
				payload = payload
			}),
			Enum.HttpContentType.ApplicationJson
		)
	end)
	if not success then
		warn("[StudioHub] Failed to send result:", err)
	end
end

-- Code Execution
local function executeCode(id: string, code: string, mode: string, target: string, timeout: number)
	debugPrint("Executing code, id:", id, "mode:", mode)
	
	local result = {
		success = false,
		result = nil,
		logs = { server = {} },
		errors = {}
	}
	
	if mode == "eval" then
		-- Direct execution via loadstring
		local MAX_LOGS = 1000
		local logs: {string} = {}
		
		local logConnection = LogService.MessageOut:Connect(function(message: string, messageType: Enum.MessageType)
			table.insert(logs, message)
			if #logs > MAX_LOGS then
				table.remove(logs, 1)
			end
		end)
		
		local success, execResult = pcall(function()
			local fn, compileErr = loadstring(code)
			if fn then
				return fn()
			else
				error("Failed to compile code: " .. tostring(compileErr))
			end
		end)
		
		-- 等待几帧让日志事件有机会触发
		task.wait(0.1)
		logConnection:Disconnect()
		
		result.success = success
		result.logs.server = logs
		
		if success then
			if execResult ~= nil then
				local serializeSuccess = pcall(function()
					HttpService:JSONEncode(execResult)
				end)
				if serializeSuccess then
					result.result = execResult
				else
					result.result = tostring(execResult)
				end
			end
		else
			result.errors.server = tostring(execResult)
		end
		
	elseif mode == "run" or mode == "play" then
		-- Execution via StudioTestService
		local StudioTestService = game:GetService("StudioTestService")
		local ServerScriptService = game:GetService("ServerScriptService")
		local StarterPlayer = game:GetService("StarterPlayer")
		local StarterPlayerScripts = StarterPlayer:FindFirstChild("StarterPlayerScripts")
		
		local templates = script:FindFirstChild("templates")
		local serverTemplate = templates and templates:FindFirstChild("server-runner")
		local clientTemplate = templates and templates:FindFirstChild("client-runner")
		
		if not serverTemplate then
			result.errors.server = "Server template not found"
			sendResult(id, result)
			return
		end
		
		local serverScriptSource = serverTemplate.Source
			:gsub("{{CODE}}", code)
			:gsub("{{DEBUG}}", tostring(debugMode))
			:gsub("{{MODE}}", mode)
		
		-- Cleanup any existing test scripts
		local existingServer = ServerScriptService:FindFirstChild("StudioHubTestRunner")
		if existingServer then
			existingServer:Destroy()
		end
		
		local existingClient = StarterPlayerScripts and StarterPlayerScripts:FindFirstChild("StudioHubTestRunner")
		if existingClient then
			existingClient:Destroy()
		end
		
		-- Create server script
		local serverScript = Instance.new("Script")
		serverScript.Name = "StudioHubTestRunner"
		serverScript.Source = serverScriptSource
		serverScript.Parent = ServerScriptService
		
		-- For play mode, also create client script
		if mode == "play" and StarterPlayerScripts and clientTemplate then
			local clientScriptSource = clientTemplate.Source
				:gsub("{{CODE}}", code)
				:gsub("{{DEBUG}}", tostring(debugMode))
			local clientScript = Instance.new("LocalScript")
			clientScript.Name = "StudioHubTestRunner"
			clientScript.Source = clientScriptSource
			clientScript.Parent = StarterPlayerScripts
			
			debugPrint("Test scripts created in ServerScriptService and StarterPlayerScripts")
		else
			debugPrint("Test script created in ServerScriptService")
		end
		
		-- Capture logs during execution
		local capturedLogs: {string} = {}
		local MAX_LOGS = 1000
		
		local logConnection = LogService.MessageOut:Connect(function(msg: string, msgType: Enum.MessageType)
			table.insert(capturedLogs, msg)
			if #capturedLogs > MAX_LOGS then
				table.remove(capturedLogs, 1)
			end
		end)
		
		local success, execResult = pcall(function()
			if mode == "run" then
				debugPrint("Calling ExecuteRunModeAsync...")
				return StudioTestService:ExecuteRunModeAsync("")
			else
				debugPrint("Calling ExecutePlayModeAsync...")
				return StudioTestService:ExecutePlayModeAsync("")
			end
		end)
		
		logConnection:Disconnect()
		
		-- Cleanup test scripts
		local scriptToClean = ServerScriptService:FindFirstChild("StudioHubTestRunner")
		if scriptToClean then
			scriptToClean:Destroy()
		end
		
		local clientToClean = StarterPlayerScripts and StarterPlayerScripts:FindFirstChild("StudioHubTestRunner")
		if clientToClean then
			clientToClean:Destroy()
		end
		
		result.logs.server = capturedLogs
		
		if success then
			result.success = true
			if execResult then
				local decodeSuccess, decoded = pcall(function()
					return HttpService:JSONDecode(execResult)
				end)
				if decodeSuccess and decoded then
					result.success = decoded.success ~= false
					result.result = decoded.result
					if decoded.error then
						result.errors.server = decoded.error
					end
				else
					result.result = execResult
				end
			end
		else
			result.errors.server = tostring(execResult)
		end
	else
		result.errors.server = "Unknown mode: " .. tostring(mode)
	end
	
	debugPrint("Execution finished, success:", result.success)
	sendResult(id, result)
end

-- Handle command from hub
local function handleCommand(command: {[string]: any})
	if command.type == "execute" and command.payload then
		local payload = command.payload
		task.spawn(function()
			executeCode(
				command.id,
				payload.code,
				payload.mode or "eval",
				payload.target or "server",
				payload.timeout or 30
			)
		end)
	elseif command.type == "disconnect" then
		-- 旧的 poll 被新 poll 替代，忽略此命令（新 poll 会继续工作）
		debugPrint("Received disconnect command (ignored):", command.reason or "unknown")
	end
end

-- Long polling loop
local function pollLoop()
	while pollEnabled do
		local studioInfo = getStudioInfo()
		local studioInfoJson = HttpService:JSONEncode(studioInfo)
		local encodedInfo = HttpService:UrlEncode(studioInfoJson)
		local url = baseUrl .. "/api/studio/poll?studioInfo=" .. encodedInfo .. "&timeout=" .. POLL_TIMEOUT
		
		local success, response = pcall(function()
			return HttpService:GetAsync(url)
		end)
		
		if success then
			if not isConnected then
				isConnected = true
				updateStatus("Connected", Color3.fromRGB(100, 255, 100))
				connectButton.Text = "Disconnect"
			end
			
			local parseSuccess, data = pcall(function()
				return HttpService:JSONDecode(response)
			end)
			
			if parseSuccess and data then
				-- Update studioId from response
				if data.studioId then
					updateId(data.studioId)
				end
				
				-- Process commands
				if data.commands then
					for _, command in ipairs(data.commands) do
						handleCommand(command)
					end
				end
			end
		else
			if isConnected then
				isConnected = false
				updateStatus("Disconnected", Color3.fromRGB(200, 200, 200))
				updateId(nil)
				connectButton.Text = "Connect"
			end
			
			-- Wait before retry
			if pollEnabled then
				updateStatus("Reconnecting...", Color3.fromRGB(255, 200, 0))
				task.wait(2)
			end
		end
	end
end

-- Connection Management
connect = function(port: number)
	debugPrint("Connecting to port:", port)
	
	-- Stop existing poll
	pollEnabled = false
	if pollThread then
		task.cancel(pollThread)
		pollThread = nil
	end
	
	baseUrl = "http://localhost:" .. port
	updateStatus("Connecting...", Color3.fromRGB(255, 200, 0))
	updateId(nil)
	
	-- Start polling
	pollEnabled = true
	pollThread = task.spawn(pollLoop)
end

local function disconnect()
	debugPrint("Disconnecting...")
	pollEnabled = false
	
	if pollThread then
		task.cancel(pollThread)
		pollThread = nil
	end
	
	isConnected = false
	updateStatus("Disconnected", Color3.fromRGB(200, 200, 200))
	updateId(nil)
	connectButton.Text = "Connect"
end

-- Event Handlers
connectButton.MouseButton1Click:Connect(function()
	if isConnected or pollEnabled then
		disconnect()
	else
		local port = tonumber(portInput.Text) or DEFAULT_PORT
		connect(port)
	end
end)

toggleButton.Click:Connect(function()
	widget.Enabled = not widget.Enabled
end)

-- 插件卸载时清理
plugin.Unloading:Connect(function()
	debugPrint("Plugin unloading, cleaning up...")
	pollEnabled = false
	if pollThread then
		task.cancel(pollThread)
		pollThread = nil
	end
end)

-- Auto-connect on load
task.delay(1, function()
	debugPrint("Auto-connecting to default port:", DEFAULT_PORT)
	connect(DEFAULT_PORT)
end)

debugPrint("Plugin loaded (HTTP mode)")
