using Microsoft.Extensions.Logging;

namespace AzStamper.Core.Services;

public class CallerResolver : ICallerResolver
{
    private readonly IGraphServicePrincipalClient _graphPrincipalClient;
    private readonly ILogger<CallerResolver> _logger;

    public CallerResolver(IGraphServicePrincipalClient graphPrincipalClient, ILogger<CallerResolver> logger)
    {
        _graphPrincipalClient = graphPrincipalClient;
        _logger = logger;
    }

    public async Task<string?> ResolveDisplayNameAsync(string principalId, CancellationToken cancellationToken = default)
    {
        try
        {
            return await _graphPrincipalClient.GetDisplayNameAsync(principalId, cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to resolve display name for principal {PrincipalId}", principalId);
            return null;
        }
    }
}
