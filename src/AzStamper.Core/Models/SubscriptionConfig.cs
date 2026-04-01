namespace AzStamper.Core.Models;

public class SubscriptionConfig
{
    public string DisplayName { get; set; } = string.Empty;
    public bool Enabled { get; set; } = true;
    public Dictionary<string, TagEntry> TagOverrides { get; set; } = new();
    public Dictionary<string, ResourceTypeRule> ResourceTypeRules { get; set; } = new();
    public List<string> AdditionalIgnorePatterns { get; set; } = new();
    public List<CompliancePolicy> CompliancePolicies { get; set; } = new();
}
