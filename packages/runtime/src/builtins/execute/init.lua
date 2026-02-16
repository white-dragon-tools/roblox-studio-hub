--!strict
--[[
	Execute Builtin Plugin
	Executes Lua code in Roblox Studio.
	Supports three modes: eval (direct loadstring), run (server-side via StudioTestService), play (full client+server test).
]]

return function(runtime)
	runtime:registerHandler({
		name = "execute",
		description = "Execute Lua code in Roblox Studio. Supports three modes: eval (direct loadstring), run (server-side via StudioTestService), play (full client+server test).",
		inputSchema = {
			type = "object",
			properties = {
				code = { type = "string", description = "Lua source code to execute" },
				mode = {
					type = "string",
					enum = { "eval", "run", "play" },
					description = "Execution mode. eval: direct loadstring, run: server test via StudioTestService, play: full Play mode test",
				},
				timeout = { type = "number", description = "Execution timeout in seconds", default = 30 },
			},
			required = { "code" },
		},
	}, function(params)
		local HttpService = game:GetService("HttpService")
		local LogService = game:GetService("LogService")

		local code = params.code :: string
		local mode = params.mode or "eval" :: string
		local debugMode = runtime.debugMode

		local function debugPrint(...)
			if debugMode then
				print("[HubRuntime:execute]", ...)
			end
		end

		debugPrint("Executing code, mode:", mode)

		local result = {
			success = false,
			result = nil,
			logs = { server = {} },
			errors = {},
		}

		if mode == "eval" then
			-- Direct execution via loadstring
			local MAX_LOGS = 1000
			local logs: { string } = {}

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

			-- Wait a few frames to let log events fire
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

			-- Templates are children of the execute module
			local serverTemplate = script:FindFirstChild("server-runner")
			local clientTemplate = script:FindFirstChild("client-runner")

			if not serverTemplate then
				result.errors.server = "Server template not found"
				return result
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
			local capturedLogs: { string } = {}
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
		return result
	end)
end
