using AzStamper.Core.Models;
using AzStamper.Core.Services;
using Microsoft.Extensions.Options;

namespace AzStamper.Core.Tests;

public class ConfigResolverTests
{
    private static readonly StamperConfig GlobalConfig = new()
    {
        TagMap = new Dictionary<string, TagEntry>
        {
            ["Creator"] = new() { Value = "{caller}", Overwrite = false },
            ["LastModifiedBy"] = new() { Value = "{caller}", Overwrite = true },
            ["StampedBy"] = new() { Value = "Az-Stamper", Overwrite = false }
        },
        IgnorePatterns = new List<string>
        {
            "Microsoft.Resources/deployments",
            "Microsoft.Resources/tags"
        }
    };

    private ConfigResolver CreateResolver(StamperConfig? config = null)
    {
        return new ConfigResolver(Options.Create(config ?? GlobalConfig));
    }

    [Fact]
    public void Resolve_NoSubscriptionConfig_ReturnsGlobalDefaults()
    {
        var resolver = CreateResolver();
        var result = resolver.Resolve(subscriptionConfig: null, resourceType: "Microsoft.Compute/virtualMachines");
        Assert.Equal("global", result.ConfigSource);
        Assert.True(result.Enabled);
        Assert.Equal(3, result.TagMap.Count);
        Assert.Equal("{caller}", result.TagMap["Creator"].Value);
        Assert.Equal(2, result.IgnorePatterns.Count);
    }

    [Fact]
    public void Resolve_WithTagOverrides_MergesIntoGlobals()
    {
        var resolver = CreateResolver();
        var subConfig = new SubscriptionConfig
        {
            TagOverrides = new Dictionary<string, TagEntry>
            {
                ["Environment"] = new() { Value = "Production", Overwrite = false },
                ["Creator"] = new() { Value = "overridden-{caller}", Overwrite = false }
            }
        };
        var result = resolver.Resolve(subConfig, "Microsoft.Compute/virtualMachines");
        Assert.Equal("subscription-override", result.ConfigSource);
        Assert.Equal(4, result.TagMap.Count);
        Assert.Equal("Production", result.TagMap["Environment"].Value);
        Assert.Equal("overridden-{caller}", result.TagMap["Creator"].Value);
        Assert.Equal("{caller}", result.TagMap["LastModifiedBy"].Value);
    }

    [Fact]
    public void Resolve_WithResourceTypeAdditionalTags_AddsToTagMap()
    {
        var resolver = CreateResolver();
        var subConfig = new SubscriptionConfig
        {
            ResourceTypeRules = new Dictionary<string, ResourceTypeRule>
            {
                ["Microsoft.Compute/virtualMachines"] = new()
                {
                    AdditionalTags = new Dictionary<string, TagEntry>
                    {
                        ["ManagedBy"] = new() { Value = "InfraTeam", Overwrite = false }
                    }
                }
            }
        };
        var result = resolver.Resolve(subConfig, "Microsoft.Compute/virtualMachines");
        Assert.Equal(4, result.TagMap.Count);
        Assert.Equal("InfraTeam", result.TagMap["ManagedBy"].Value);
    }

    [Fact]
    public void Resolve_WithResourceTypeExcludeTags_RemovesFromTagMap()
    {
        var resolver = CreateResolver();
        var subConfig = new SubscriptionConfig
        {
            TagOverrides = new Dictionary<string, TagEntry>
            {
                ["CostCenter"] = new() { Value = "CC-1234", Overwrite = false }
            },
            ResourceTypeRules = new Dictionary<string, ResourceTypeRule>
            {
                ["Microsoft.Storage/storageAccounts"] = new()
                {
                    ExcludeTags = new List<string> { "CostCenter" }
                }
            }
        };
        var result = resolver.Resolve(subConfig, "Microsoft.Storage/storageAccounts");
        Assert.False(result.TagMap.ContainsKey("CostCenter"));
        Assert.Equal(3, result.TagMap.Count);
    }

    [Fact]
    public void Resolve_ResourceTypeNotInRules_IgnoresResourceTypeRules()
    {
        var resolver = CreateResolver();
        var subConfig = new SubscriptionConfig
        {
            ResourceTypeRules = new Dictionary<string, ResourceTypeRule>
            {
                ["Microsoft.Compute/virtualMachines"] = new()
                {
                    AdditionalTags = new Dictionary<string, TagEntry>
                    {
                        ["ManagedBy"] = new() { Value = "InfraTeam", Overwrite = false }
                    }
                }
            }
        };
        var result = resolver.Resolve(subConfig, "Microsoft.Storage/storageAccounts");
        Assert.Equal(3, result.TagMap.Count);
        Assert.False(result.TagMap.ContainsKey("ManagedBy"));
    }

    [Fact]
    public void Resolve_DisabledSubscription_ReturnsDisabledRuleSet()
    {
        var resolver = CreateResolver();
        var subConfig = new SubscriptionConfig { Enabled = false };
        var result = resolver.Resolve(subConfig, "Microsoft.Compute/virtualMachines");
        Assert.False(result.Enabled);
    }

    [Fact]
    public void Resolve_WithAdditionalIgnorePatterns_CombinesWithGlobals()
    {
        var resolver = CreateResolver();
        var subConfig = new SubscriptionConfig
        {
            AdditionalIgnorePatterns = new List<string> { "Microsoft.Network/frontdoor" }
        };
        var result = resolver.Resolve(subConfig, "Microsoft.Compute/virtualMachines");
        Assert.Equal(3, result.IgnorePatterns.Count);
        Assert.Contains("Microsoft.Network/frontdoor", result.IgnorePatterns);
        Assert.Contains("Microsoft.Resources/deployments", result.IgnorePatterns);
    }

    [Fact]
    public void Resolve_ResourceTypeCaseInsensitive_MatchesRules()
    {
        var resolver = CreateResolver();
        var subConfig = new SubscriptionConfig
        {
            ResourceTypeRules = new Dictionary<string, ResourceTypeRule>
            {
                ["microsoft.compute/virtualmachines"] = new()
                {
                    AdditionalTags = new Dictionary<string, TagEntry>
                    {
                        ["ManagedBy"] = new() { Value = "InfraTeam", Overwrite = false }
                    }
                }
            }
        };
        var result = resolver.Resolve(subConfig, "Microsoft.Compute/virtualMachines");
        Assert.Equal(4, result.TagMap.Count);
        Assert.Equal("InfraTeam", result.TagMap["ManagedBy"].Value);
    }
}
