using System.Text.Json;
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

        if (eventGridEvent.Data is null)
        {
            _logger.LogWarning("Event data is null — skipping");
            return;
        }

        var data = eventGridEvent.Data.ToObjectFromJson<JsonElement>();

        var evt = new ResourceEvent
        {
            ResourceId = GetProperty(data, "resourceUri"),
            PrincipalType = GetNestedProperty(data, "authorization", "evidence", "principalType"),
            PrincipalId = GetNestedProperty(data, "authorization", "evidence", "principalId"),
            Caller = GetClaimValue(data, "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn")
        };

        _logger.LogInformation("Parsed event — ResourceId: {ResourceId}, Caller: {Caller}, PrincipalType: {PrincipalType}",
            evt.ResourceId, evt.Caller, evt.PrincipalType);

        await _orchestrator.ProcessAsync(evt, cancellationToken);
    }

    private static string? GetProperty(JsonElement element, string propertyName)
    {
        if (element.TryGetProperty(propertyName, out var value) && value.ValueKind != JsonValueKind.Null)
            return value.ToString();
        return null;
    }

    private static string? GetNestedProperty(JsonElement element, params string[] path)
    {
        var current = element;
        foreach (var key in path)
        {
            if (current.ValueKind != JsonValueKind.Object || !current.TryGetProperty(key, out current))
                return null;
        }
        return current.ValueKind != JsonValueKind.Null ? current.ToString() : null;
    }

    private static string? GetClaimValue(JsonElement data, string claimType)
    {
        if (data.TryGetProperty("claims", out var claims) &&
            claims.ValueKind == JsonValueKind.Object &&
            claims.TryGetProperty(claimType, out var value) &&
            value.ValueKind != JsonValueKind.Null)
        {
            return value.ToString();
        }
        return null;
    }
}
