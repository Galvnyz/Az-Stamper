namespace AzStamper.Core.Models;

public class ResourceEvent
{
    public string? ResourceId { get; set; }
    public string? Caller { get; set; }
    public string? PrincipalType { get; set; }
    public string? PrincipalId { get; set; }

    public string? SubscriptionId => ExtractSubscriptionId(ResourceId);

    public string? ResourceType => ExtractResourceType(ResourceId);

    private static string? ExtractSubscriptionId(string? resourceId)
    {
        if (string.IsNullOrEmpty(resourceId))
            return null;

        // Format: /subscriptions/{subscriptionId}/resourceGroups/...
        const string prefix = "/subscriptions/";
        var startIndex = resourceId.IndexOf(prefix, StringComparison.OrdinalIgnoreCase);
        if (startIndex < 0)
            return null;

        startIndex += prefix.Length;
        var endIndex = resourceId.IndexOf('/', startIndex);
        return endIndex < 0 ? resourceId[startIndex..] : resourceId[startIndex..endIndex];
    }

    private static string? ExtractResourceType(string? resourceId)
    {
        if (string.IsNullOrEmpty(resourceId))
            return null;

        // Format: .../providers/{namespace}/{type}/{name}
        const string providers = "/providers/";
        var providerIndex = resourceId.LastIndexOf(providers, StringComparison.OrdinalIgnoreCase);
        if (providerIndex < 0)
            return null;

        var afterProvider = resourceId[(providerIndex + providers.Length)..];
        // Take namespace/type (first two segments)
        var segments = afterProvider.Split('/');
        return segments.Length >= 2 ? $"{segments[0]}/{segments[1]}" : null;
    }
}
