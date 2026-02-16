--!strict
--[[
	GetStudioInfo Builtin Plugin
	Returns current Roblox Studio environment information.
]]

return function(runtime)
	runtime:registerHandler({
		name = "getStudioInfo",
		description = "Get current Roblox Studio environment information including place ID, place name, creator info, and local path.",
		inputSchema = {
			type = "object",
			properties = {},
		},
	}, function(_params)
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
			success = true,
			placeId = game.PlaceId,
			placeName = placeName,
			creatorName = creatorName,
			creatorType = creatorType,
			gameId = game.GameId,
			userId = userId,
			localPath = localPath,
		}
	end)
end
