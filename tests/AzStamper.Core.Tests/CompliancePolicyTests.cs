using System.Text.Json;
using AzStamper.Core.Models;

namespace AzStamper.Core.Tests;

public class CompliancePolicyTests
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true
    };

    [Fact]
    public void OldJson_WithoutCompliancePolicies_DeserializesCleanly()
    {
        var json = """
        {
          "subscriptions": {
            "sub-1": {
              "displayName": "Test",
              "enabled": true,
              "tagOverrides": { "Env": { "value": "Dev", "overwrite": false } }
            }
          }
        }
        """;

        var root = JsonSerializer.Deserialize<SubscriptionConfigRoot>(json, JsonOptions)!;
        var sub = root.Subscriptions["sub-1"];

        Assert.Empty(sub.CompliancePolicies);
        Assert.Equal("Test", sub.DisplayName);
        Assert.Single(sub.TagOverrides);
    }

    [Fact]
    public void Json_WithCompliancePolicies_RoundTrips()
    {
        var root = new SubscriptionConfigRoot
        {
            Subscriptions = new Dictionary<string, SubscriptionConfig>
            {
                ["sub-1"] = new()
                {
                    DisplayName = "Production",
                    CompliancePolicies = new List<CompliancePolicy>
                    {
                        new()
                        {
                            Name = "Mandatory Tags",
                            Enabled = true,
                            EnforcementMode = "audit",
                            RequiredTags = new List<RequiredTag>
                            {
                                new() { Name = "Creator" },
                                new() { Name = "Environment", AllowedValues = new() { "Production", "Dev" } },
                                new() { Name = "CostCenter", Pattern = @"^CC-\d{4}$" }
                            },
                            ResourceTypeScope = new List<string> { "Microsoft.Compute/virtualMachines" }
                        }
                    }
                }
            }
        };

        var json = JsonSerializer.Serialize(root, JsonOptions);
        var deserialized = JsonSerializer.Deserialize<SubscriptionConfigRoot>(json, JsonOptions)!;

        var policy = deserialized.Subscriptions["sub-1"].CompliancePolicies[0];
        Assert.Equal("Mandatory Tags", policy.Name);
        Assert.True(policy.Enabled);
        Assert.Equal("audit", policy.EnforcementMode);
        Assert.Equal(3, policy.RequiredTags.Count);

        Assert.Equal("Creator", policy.RequiredTags[0].Name);
        Assert.Null(policy.RequiredTags[0].AllowedValues);

        Assert.Equal("Environment", policy.RequiredTags[1].Name);
        Assert.Equal(new[] { "Production", "Dev" }, policy.RequiredTags[1].AllowedValues);

        Assert.Equal("CostCenter", policy.RequiredTags[2].Name);
        Assert.Equal(@"^CC-\d{4}$", policy.RequiredTags[2].Pattern);

        Assert.Single(policy.ResourceTypeScope);
        Assert.Equal("Microsoft.Compute/virtualMachines", policy.ResourceTypeScope[0]);
    }

    [Fact]
    public void DefaultCompliancePolicy_HasCorrectDefaults()
    {
        var policy = new CompliancePolicy();

        Assert.Equal("Default", policy.Name);
        Assert.True(policy.Enabled);
        Assert.Equal("audit", policy.EnforcementMode);
        Assert.Empty(policy.RequiredTags);
        Assert.Empty(policy.ResourceTypeScope);
    }

    [Fact]
    public void RequiredTag_AllowsNullOptionalFields()
    {
        var tag = new RequiredTag { Name = "Creator" };

        Assert.Equal("Creator", tag.Name);
        Assert.Null(tag.AllowedValues);
        Assert.Null(tag.Pattern);
    }
}
