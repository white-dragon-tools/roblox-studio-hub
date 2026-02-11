local ws = game:GetService("Workspace")
local props = {}

-- 尝试读取一些可能的属性
local tryProps = {"LocalPlacePath", "PlaceId", "Name", "ClassName"}
for _, prop in ipairs(tryProps) do
    local success, value = pcall(function()
        return ws[prop]
    end)
    if success then
        props[prop] = tostring(value)
    else
        props[prop] = "ERROR: " .. tostring(value)
    end
end

return props
