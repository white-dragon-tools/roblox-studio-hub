--[[
	Client Runner Template
	用于 play 模式的客户端脚本模板
	
	占位符:
	  {{CODE}} - 用户代码
	  {{DEBUG}} - 调试模式 (true/false)
	
	执行完成后通过 RemoteEvent 通知服务端
]]

local ReplicatedStorage = game:GetService("ReplicatedStorage")
local HttpService = game:GetService("HttpService")
local ScriptContext = game:GetService("ScriptContext")

local DEBUG = {{DEBUG}}

local function debugPrint(...)
	if DEBUG then
		print("[StudioHubTestRunner]", ...)
	end
end

debugPrint("Client script started!")

-- 等待服务端创建的 RemoteEvent
local clientResultEvent = ReplicatedStorage:WaitForChild("StudioHubClientResult", 10)

-- 结果数据
local clientError = nil
local clientResult = nil
local hasError = false
local codeFinished = false

-- 监听错误事件
local errorConnection
errorConnection = ScriptContext.Error:Connect(function(message, stackTrace, scriptInstance)
	if scriptInstance == script then
		debugPrint("Client error detected:", message)
		debugPrint("Stack trace:", stackTrace)
		clientError = {
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
	clientResult = (function()
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
	debugPrint("Client code timeout!")
	hasError = true
	clientError = { message = "Code execution timeout", stackTrace = "" }
end

-- 断开错误监听
errorConnection:Disconnect()

debugPrint("Client code finished, hasError:", hasError)

-- 构建客户端结果
local clientResultData = {
	success = not hasError
}

if not hasError then
	if clientResult ~= nil then
		local canSerialize = pcall(function()
			HttpService:JSONEncode(clientResult)
		end)
		if canSerialize then
			clientResultData.result = clientResult
		else
			clientResultData.result = tostring(clientResult)
		end
	end
else
	clientResultData.error = clientError.message .. "\n" .. (clientError.stackTrace or "")
end

-- 通知服务端
if clientResultEvent then
	debugPrint("Sending result to server...")
	clientResultEvent:FireServer(clientResultData)
	debugPrint("Result sent to server!")
else
	warn("[StudioHubTestRunner] Could not find StudioHubClientResult RemoteEvent!")
end
