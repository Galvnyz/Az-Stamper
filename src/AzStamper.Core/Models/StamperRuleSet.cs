namespace AzStamper.Core.Models;

public class StamperRuleSet
{
    public Dictionary<string, TagEntry> TagMap { get; set; } = new();
    public List<string> IgnorePatterns { get; set; } = new();
    public bool Enabled { get; set; } = true;
    public string ConfigSource { get; set; } = "global";
}
