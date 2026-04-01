namespace AzStamper.Core.Models;

public class CompliancePolicy
{
    public string Name { get; set; } = "Default";
    public bool Enabled { get; set; } = true;
    public List<RequiredTag> RequiredTags { get; set; } = new();
    public List<string> ResourceTypeScope { get; set; } = new();
    public string EnforcementMode { get; set; } = "audit";
}

public class RequiredTag
{
    public string Name { get; set; } = string.Empty;
    public List<string>? AllowedValues { get; set; }
    public string? Pattern { get; set; }
}
