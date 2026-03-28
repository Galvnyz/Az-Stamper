namespace AzStamper.Core.Models;

public class ResourceTypeRule
{
    public Dictionary<string, TagEntry> AdditionalTags { get; set; } = new();
    public List<string> ExcludeTags { get; set; } = new();
}
