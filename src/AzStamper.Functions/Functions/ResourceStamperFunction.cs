using Azure.Messaging.EventGrid;
using AzStamper.Core;
using AzStamper.Core.Models;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;

namespace AzStamper.Functions.Functions;

public class ResourceStamperFunction
{
    private readonly StampOrchestrator _orchestrator;
    private readonly ILogger<ResourceStamperFunction> _logger;

    public ResourceStamperFunction(StampOrchestrator orchestrator, ILogger<ResourceStamperFunction> logger)
    {
        _orchestrator = orchestrator;
        _logger = logger;
    }

    [Function("ResourceStamper")]
    public async Task Run(
        [EventGridTrigger] EventGridEvent eventGridEvent,
        CancellationToken cancellationToken)
    {
        _logger.LogInformation("Event received: {Subject} ({EventType})", eventGridEvent.Subject, eventGridEvent.EventType);

        var data = eventGridEvent.Data?.ToObjectFromJson<Dictionary<string, object>>();
        if (data is null)
        {
            _logger.LogWarning("Event data is null — skipping");
            return;
        }

        var evt = new ResourceEvent
        {
            ResourceId = data.TryGetValue("resourceUri", out var uri) ? uri?.ToString() : null,
            PrincipalType = GetNestedValue(data, "authorization", "evidence", "principalType"),
            PrincipalId = GetNestedValue(data, "authorization", "evidence", "principalId"),
            Caller = GetClaimValue(data, "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn")
        };

        await _orchestrator.ProcessAsync(evt, cancellationToken);
    }

    private static string? GetNestedValue(Dictionary<string, object> data, params string[] keys)
    {
        object? current = data;
        foreach (var key in keys)
        {
            if (current is Dictionary<string, object> dict && dict.TryGetValue(key, out var next))
                current = next;
            else
                return null;
        }
        return current?.ToString();
    }

    private static string? GetClaimValue(Dictionary<string, object> data, string claimType)
    {
        if (data.TryGetValue("claims", out var claimsObj) &&
            claimsObj is Dictionary<string, object> claims &&
            claims.TryGetValue(claimType, out var value))
        {
            return value?.ToString();
        }
        return null;
    }
}
