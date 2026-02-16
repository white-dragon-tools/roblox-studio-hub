--[[
	mock-transport.luau

	Wraps Lune's net.socket() to look like Roblox's WebSocket event-based API:
	  - ws.MessageReceived:Connect(fn)
	  - ws.Closed:Connect(fn)
	  - ws:Send(msg)
	  - ws:Close()

	Roblox API:
	  HttpService:CreateWebStreamClient(Enum.WebStreamClientType.WebSocket, { Url = ... })
]]

local net = require("@lune/net")
local roblox = require("@lune/roblox")
local task = require("@lune/task")

local MockTransport = {}

-- Simple event implementation
local function createEvent()
	local connections: { (any) -> () } = {}

	local event = {}

	function event:Connect(fn: (any) -> ())
		table.insert(connections, fn)
		return {
			Disconnect = function()
				for i, c in connections do
					if c == fn then
						table.remove(connections, i)
						break
					end
				end
			end,
		}
	end

	function event:_fire(...)
		for _, fn in connections do
			task.spawn(fn, ...)
		end
	end

	return event
end

function MockTransport.install()
	-- Implement CreateWebStreamClient on HttpService
	roblox.implementMethod("HttpService", "CreateWebStreamClient", function(_self: any, _wsType: any, options: { Url: string })
		local url = options.Url

		-- Create event objects
		local messageReceived = createEvent()
		local closed = createEvent()

		-- Connect using Lune's net.socket
		local socket = net.socket(url)

		-- Wire up message handling
		-- Lune's socket:next() returns a plain string (text message) or nil (closed)
		local closed_fired = false
		task.spawn(function()
			while true do
				local message = socket:next()
				if message == nil then
					break
				end
				messageReceived:_fire(message)
			end
			if not closed_fired then
				closed_fired = true
				closed:_fire()
			end
		end)

		-- Return Roblox-style WS object
		local ws = {
			MessageReceived = messageReceived,
			Closed = closed,
		}

		function ws:Send(msg: string)
			socket:send(msg)
		end

		function ws:Close()
			socket:close()
		end

		return ws
	end)
end

return MockTransport
