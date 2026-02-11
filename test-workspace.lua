local result = {}
for _, child in ipairs(workspace:GetChildren()) do
    table.insert(result, child.Name .. " (" .. child.ClassName .. ")")
end
return result
