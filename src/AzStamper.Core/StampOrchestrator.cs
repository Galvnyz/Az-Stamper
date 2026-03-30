using System.Text.Json;
using AzStamper.Core.Models;
using AzStamper.Core.Services;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace AzStamper.Core;

public class StampOrchestrator
{
    private readonly ICallerResolver _callerResolver;
    private readonly ITagService _tagService;
    private readonly StamperConfig _globalConfig;
    private readonly ConfigResolver _configResolver;
    private readonly ISubscriptionConfigProvider _subscriptionConfigProvider;
    private readonly ILogger<StampOrchestrator> _logger;

    public StampOrchestrator(
        ICallerResolver callerResolver,
        ITagService tagService,
        IOptions<StamperConfig> globalConfig,
        ConfigResolver configResolver,
        ISubscriptionConfigProvider subscriptionConfigProvider,
        ILogger<StampOrchestrator> logger)
    {
        _callerResolver = callerResolver;
        _tagService = tagService;
        _globalConfig = globalConfig.Value;
        _configResolver = configResolver;
        _subscriptionConfigProvider = subscriptionConfigProvider;
        _logger = logger;
    }

    public async Task ProcessAsync(ResourceEvent? evt, CancellationToken cancellationToken = default)
    {
        if (evt is null)
        {
            _logger.LogWarning("ResourceEvent is null — skipping");
            return;
        }

        if (string.IsNullOrEmpty(evt.ResourceId))
        {
            _logger.LogWarning("Event has null or empty ResourceId — skipping");
            return;
        }

        // Skip events triggered by our own managed identity (prevents recursive tag-write loop)
        if (!string.IsNullOrEmpty(_globalConfig.SelfPrincipalId) &&
            string.Equals(evt.PrincipalId, _globalConfig.SelfPrincipalId, StringComparison.OrdinalIgnoreCase))
        {
            _logger.LogInformation("Skipping self-triggered event for {ResourceId}", evt.ResourceId);
            return;
        }

        // Resolve per-subscription config
        var subscriptionId = evt.SubscriptionId;
        var resourceType = evt.ResourceType ?? "Unknown";
        SubscriptionConfig? subConfig = null;

        if (!string.IsNullOrEmpty(subscriptionId))
        {
            subConfig = await _subscriptionConfigProvider.GetConfigAsync(subscriptionId, cancellationToken);
        }

        var ruleSet = _configResolver.Resolve(subConfig, resourceType);

        if (!ruleSet.Enabled)
        {
            _logger.LogInformation("Subscription {SubscriptionId} is disabled — skipping {ResourceId}",
                subscriptionId, evt.ResourceId);
            return;
        }

        // Check ignore list (using resolved ignore patterns)
        foreach (var pattern in ruleSet.IgnorePatterns)
        {
            if (evt.ResourceId.Contains(pattern, StringComparison.OrdinalIgnoreCase))
            {
                _logger.LogInformation("Skipping {ResourceId} — matches ignore pattern: {Pattern}", evt.ResourceId, pattern);
                return;
            }
        }

        // Resolve caller identity
        var caller = evt.Caller;
        if (string.IsNullOrEmpty(caller))
        {
            if (!string.IsNullOrEmpty(evt.PrincipalId) &&
                string.Equals(evt.PrincipalType, "ServicePrincipal", StringComparison.OrdinalIgnoreCase))
            {
                caller = await _callerResolver.ResolveDisplayNameAsync(evt.PrincipalId, cancellationToken);
                caller ??= evt.PrincipalId;
            }
            else
            {
                _logger.LogWarning("Cannot resolve caller for {ResourceId} — skipping", evt.ResourceId);
                return;
            }
        }

        _logger.LogInformation("Processing {ResourceId} — caller: {Caller}, config: {ConfigSource}",
            evt.ResourceId, caller, ruleSet.ConfigSource);

        if (ruleSet.TagMap.Count == 0)
        {
            _logger.LogInformation("Tag map is empty — nothing to stamp");
            return;
        }

        // Read existing tags
        var existingTags = await _tagService.GetTagsAsync(evt.ResourceId, cancellationToken);
        if (existingTags is null)
        {
            _logger.LogWarning("Could not read tags for {ResourceId} — skipping", evt.ResourceId);
            return;
        }

        // Build tag set to apply
        var tagsToApply = new Dictionary<string, string>();
        var timestamp = DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ");

        // Detect first stamp: if no Overwrite=false tags exist yet, this is a creation event.
        // Skip Overwrite=true tags (LastModifiedBy/On) on creation to avoid confusing
        // identical CreatedOn and LastModifiedOn timestamps.
        var isFirstStamp = !ruleSet.TagMap
            .Where(t => !t.Value.Overwrite)
            .Any(t => existingTags.ContainsKey(t.Key));

        foreach (var (key, entry) in ruleSet.TagMap)
        {
            if (isFirstStamp && entry.Overwrite)
            {
                continue;
            }

            if (existingTags.ContainsKey(key) && !entry.Overwrite)
            {
                _logger.LogInformation("Tag '{Key}' already exists on {ResourceId} — skipping (overwrite=false)", key, evt.ResourceId);
                continue;
            }

            var value = ResolveTemplate(entry.Value, caller, timestamp, evt.PrincipalType);
            if (value.Length > 256)
            {
                _logger.LogWarning("Tag '{Key}' value exceeds 256 chars ({Length}) — truncating", key, value.Length);
                value = value[..256];
            }
            tagsToApply[key] = value;
        }

        if (tagsToApply.Count == 0)
        {
            _logger.LogInformation("No new tags to apply to {ResourceId}", evt.ResourceId);
            return;
        }

        // Azure enforces a 50-tag limit per resource
        var totalTagCount = existingTags.Count + tagsToApply.Count(t => !existingTags.ContainsKey(t.Key));
        if (totalTagCount > 50)
        {
            _logger.LogWarning("Skipping {ResourceId} — applying {NewCount} tag(s) would exceed the 50-tag limit (existing: {ExistingCount})",
                evt.ResourceId, tagsToApply.Count, existingTags.Count);
            return;
        }

        var success = await _tagService.SetTagsAsync(evt.ResourceId, tagsToApply, cancellationToken);
        if (success)
        {
            _logger.LogInformation(
                "Stamped {Count} tag(s) on {ResourceId} [Sub:{SubscriptionId}, Type:{ResourceType}, Config:{ConfigSource}] Tags:{AppliedTags}",
                tagsToApply.Count, evt.ResourceId, subscriptionId, resourceType, ruleSet.ConfigSource,
                JsonSerializer.Serialize(tagsToApply));
        }
        else
        {
            _logger.LogWarning(
                "Failed to stamp tags on {ResourceId} [Sub:{SubscriptionId}, Type:{ResourceType}]",
                evt.ResourceId, subscriptionId, resourceType);
        }
    }

    private static string ResolveTemplate(string template, string caller, string timestamp, string? principalType)
    {
        return template
            .Replace("{caller}", caller)
            .Replace("{timestamp}", timestamp)
            .Replace("{principalType}", principalType ?? "Unknown");
    }
}
