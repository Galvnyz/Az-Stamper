namespace AzStamper.Core.Models;

public class StamperConfig
{
    public Dictionary<string, TagEntry> TagMap { get; set; } = new();
    public List<string> IgnorePatterns { get; set; } = new();
}
