local pathValue = Instance.new("StringValue")
pathValue.Name = "LocalPlacePath"
pathValue.Value = "D:/Projects/TestGame"
pathValue.Parent = workspace
return "Created LocalPlacePath: " .. pathValue.Value
