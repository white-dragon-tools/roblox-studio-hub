--[[
	Server Runner Template
	用于 run/play 模式的服务端脚本模板
	
	占位符: 
	  {{CODE}} - 用户代码
	  {{DEBUG}} - 调试模式 (true/false)
	  {{MODE}} - 执行模式 (run/play)
	
	Play 模式下会等待客户端完成后再结束测试
]]

local StudioTestService = game:GetService("StudioTestService")
local HttpService = game:GetService("HttpService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local Players = game:GetService("Players")
local ScriptContext = game:GetService("ScriptContext")

local DEBUG = {{DEBUG}}
local MODE = "{{MODE}}"

local function debugPrint(...)
	if DEBUG then
		print("[StudioHubTestRunner]", ...)
	end
end

debugPrint("Server script started! MODE=" .. MODE)

-- 检测是否是 Play 模式
local isPlayMode = (MODE == "play")

debugPrint("isPlayMode=" .. tostring(isPlayMode))

-- 创建用于客户端通信的 RemoteEvent（仅 play 模式需要）
local clientResultEvent = nil
if isPlayMode then
	clientResultEvent = Instance.new("RemoteEvent")
	clientResultEvent.Name = "StudioHubClientResult"
	clientResultEvent.Parent = ReplicatedStorage
	debugPrint("Created RemoteEvent for client communication")
end

-- 结果数据
local serverError = nil
local serverResult = nil
local hasError = false
local codeFinished = false

-- 监听错误事件
local errorConnection
errorConnection = ScriptContext.Error:Connect(function(message, stackTrace, scriptInstance)
	if scriptInstance == script then
		debugPrint("Server error detected:", message)
		debugPrint("Stack trace:", stackTrace)
		serverError = {
			message = message,
			stackTrace = stackTrace
		}
		hasError = true
		codeFinished = true
	end
end)

debugPrint("Executing user code...")

-- 用 task.spawn 执行用户代码，错误不会中断主脚本
task.spawn(function()
	serverResult = (function()
{{CODE}}
	end)()
	codeFinished = true
end)

-- 等待代码执行完成（成功或出错）
local codeTimeout = 30
local startCodeTime = tick()
while not codeFinished and (tick() - startCodeTime) < codeTimeout do
	task.wait(0.1)
end

if not codeFinished then
	debugPrint("User code timeout!")
	hasError = true
	serverError = { message = "Code execution timeout", stackTrace = "" }
end

debugPrint("User code finished, hasError:", hasError, "result type:", type(serverResult))

-- 断开错误监听
errorConnection:Disconnect()

-- 构建服务端结果
local serverResultData = {}
if not hasError then
	if serverResult ~= nil then
		local canSerialize = pcall(function()
			HttpService:JSONEncode(serverResult)
		end)
		if canSerialize then
			serverResultData.result = serverResult
		else
			serverResultData.result = tostring(serverResult)
		end
	end
end

-- 最终结果
local finalResult = {
	success = not hasError,
	result = {
		server = serverResultData.result
	},
	errors = {}
}

if hasError and serverError then
	finalResult.errors.server = serverError.message .. "\n" .. (serverError.stackTrace or "")
end

-- Play 模式：等待客户端完成
if isPlayMode and clientResultEvent then
	debugPrint("Play mode: waiting for client...")
	
	local clientCompleted = false
	local clientTimeout = 30
	local startTime = tick()
	
	clientResultEvent.OnServerEvent:Connect(function(player, clientData)
		debugPrint("Received client result from:", player.Name)
		
		if clientData then
			finalResult.result.client = clientData.result
			if clientData.error then
				finalResult.errors.client = clientData.error
				finalResult.success = false
			end
		end
		
		clientCompleted = true
	end)
	
	while not clientCompleted and (tick() - startTime) < clientTimeout do
		local playerCount = #Players:GetPlayers()
		if playerCount == 0 and (tick() - startTime) > 5 then
			debugPrint("No players connected after 5s, skipping client wait")
			break
		end
		task.wait(0.1)
	end
	
	if not clientCompleted and (tick() - startTime) >= clientTimeout then
		debugPrint("Client timeout!")
		finalResult.errors.client = "Client execution timeout"
	end
	
	clientResultEvent:Destroy()
	debugPrint("RemoteEvent destroyed")
else
	debugPrint("Run mode: skipping client wait")
end

debugPrint("Final result:", HttpService:JSONEncode(finalResult))
debugPrint("Calling EndTest...")
StudioTestService:EndTest(HttpService:JSONEncode(finalResult))
debugPrint("EndTest called!")
