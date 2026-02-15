--[[
	inject-runtime.luau

	Injects a .rbxm model into a .rbxl place file under ReplicatedStorage.

	Usage: lune run scripts/inject-runtime -- <place.rbxl> <runtime.rbxm> [plugin1.rbxm ...]

	The runtime .rbxm is placed as ReplicatedStorage.__HubRuntime__
	Additional plugin .rbxm files are placed under __HubRuntime__.plugins
]]

local roblox = require("@lune/roblox")
local fs = require("@lune/fs")
local process = require("@lune/process")

local args = process.args
if #args < 2 then
	print("Usage: lune run scripts/inject-runtime -- <place.rbxl> <runtime.rbxm> [plugin1.rbxm ...]")
	process.exit(1)
end

local placePath = args[1]
local runtimeRbxmPath = args[2]
local pluginRbxmPaths = {}
for i = 3, #args do
	table.insert(pluginRbxmPaths, args[i])
end

-- Read place file
if not fs.isFile(placePath) then
	print("Error: Place file not found: " .. placePath)
	process.exit(1)
end

local placeData = fs.readFile(placePath)
local place = roblox.deserializePlace(placeData)

-- Read runtime model
if not fs.isFile(runtimeRbxmPath) then
	print("Error: Runtime .rbxm not found: " .. runtimeRbxmPath)
	process.exit(1)
end

local runtimeData = fs.readFile(runtimeRbxmPath)
local runtimeInstances = roblox.deserializeModel(runtimeData)

if #runtimeInstances == 0 then
	print("Error: Runtime .rbxm contains no instances")
	process.exit(1)
end

local runtimeRoot = runtimeInstances[1]

-- Find ReplicatedStorage
local replicatedStorage = nil
for _, child in place:GetChildren() do
	if child.ClassName == "ReplicatedStorage" then
		replicatedStorage = child
		break
	end
end

if not replicatedStorage then
	print("Error: ReplicatedStorage not found in place")
	process.exit(1)
end

-- Remove existing __HubRuntime__ if present
for _, child in replicatedStorage:GetChildren() do
	if child.Name == "__HubRuntime__" then
		child.Parent = nil
		break
	end
end

-- Insert runtime into ReplicatedStorage
runtimeRoot.Name = "__HubRuntime__"
runtimeRoot.Parent = replicatedStorage

-- Create or find plugins folder under __HubRuntime__
local pluginsFolder = nil
for _, child in runtimeRoot:GetChildren() do
	if child.Name == "plugins" then
		pluginsFolder = child
		break
	end
end

if not pluginsFolder then
	pluginsFolder = roblox.Instance.new("Folder")
	pluginsFolder.Name = "plugins"
	pluginsFolder.Parent = runtimeRoot
end

-- Inject plugin .rbxm files
for _, pluginPath in pluginRbxmPaths do
	if fs.isFile(pluginPath) then
		local pluginData = fs.readFile(pluginPath)
		local pluginInstances = roblox.deserializeModel(pluginData)
		for _, inst in pluginInstances do
			inst.Parent = pluginsFolder
		end
	else
		print("Warning: Plugin .rbxm not found, skipping: " .. pluginPath)
	end
end

-- Write back
local outputData = roblox.serializePlace(place)
fs.writeFile(placePath, outputData)

print("OK: Injected __HubRuntime__ into " .. placePath)
if #pluginRbxmPaths > 0 then
	print("  Plugins injected: " .. #pluginRbxmPaths)
end
