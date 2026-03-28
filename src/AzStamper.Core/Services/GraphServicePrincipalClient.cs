using Microsoft.Graph;

namespace AzStamper.Core.Services;

/// <summary>
/// Concrete implementation of <see cref="IGraphServicePrincipalClient"/> that delegates
/// to the Microsoft Graph SDK.
/// </summary>
public class GraphServicePrincipalClient : IGraphServicePrincipalClient
{
    private readonly GraphServiceClient _graphClient;

    public GraphServicePrincipalClient(GraphServiceClient graphClient)
    {
        _graphClient = graphClient;
    }

    public async Task<string?> GetDisplayNameAsync(string principalId, CancellationToken cancellationToken = default)
    {
        var sp = await _graphClient.ServicePrincipals[principalId]
            .GetAsync(cancellationToken: cancellationToken);
        return sp?.DisplayName;
    }
}
