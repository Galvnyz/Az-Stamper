using AzStamper.Core.Models;
using Microsoft.Extensions.Options;

namespace AzStamper.Core.Services;

public class ConfigResolver
{
    private readonly StamperConfig _globalConfig;

    public ConfigResolver(IOptions<StamperConfig> globalConfig)
    {
        _globalConfig = globalConfig.Value;
    }

    public StamperRuleSet Resolve(SubscriptionConfig? subscriptionConfig, string resourceType)
    {
        // Start with global defaults (deep copy tag map)
        var tagMap = new Dictionary<string, TagEntry>();
        foreach (var (key, entry) in _globalConfig.TagMap)
        {
            tagMap[key] = new TagEntry { Value = entry.Value, Overwrite = entry.Overwrite };
        }

        var ignorePatterns = new List<string>(_globalConfig.IgnorePatterns);
        var configSource = "global";

        if (subscriptionConfig is null)
        {
            return new StamperRuleSet
            {
                TagMap = tagMap,
                IgnorePatterns = ignorePatterns,
                Enabled = true,
                ConfigSource = configSource
            };
        }

        if (!subscriptionConfig.Enabled)
        {
            return new StamperRuleSet { Enabled = false, ConfigSource = "subscription-override" };
        }

        configSource = "subscription-override";

        // Merge subscription tag overrides
        foreach (var (key, entry) in subscriptionConfig.TagOverrides)
        {
            tagMap[key] = new TagEntry { Value = entry.Value, Overwrite = entry.Overwrite };
        }

        // Apply resource-type rules
        var matchingRule = subscriptionConfig.ResourceTypeRules
            .FirstOrDefault(r => string.Equals(r.Key, resourceType, StringComparison.OrdinalIgnoreCase));

        if (matchingRule.Value is not null)
        {
            foreach (var (key, entry) in matchingRule.Value.AdditionalTags)
            {
                tagMap[key] = new TagEntry { Value = entry.Value, Overwrite = entry.Overwrite };
            }

            foreach (var excludeKey in matchingRule.Value.ExcludeTags)
            {
                tagMap.Remove(excludeKey);
            }
        }

        // Combine ignore patterns
        ignorePatterns.AddRange(subscriptionConfig.AdditionalIgnorePatterns);

        return new StamperRuleSet
        {
            TagMap = tagMap,
            IgnorePatterns = ignorePatterns,
            Enabled = true,
            ConfigSource = configSource
        };
    }
}
