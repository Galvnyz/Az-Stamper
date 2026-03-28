namespace AzStamper.Core.Services;

/// <summary>
/// Thin abstraction over the Microsoft Graph SDK's ServicePrincipals endpoint,
/// enabling unit testing without needing to mock the complex GraphServiceClient chain.
/// </summary>
public interface IGraphServicePrincipalClient
{
    Task<string?> GetDisplayNameAsync(string principalId, CancellationToken cancellationToken = default);
}
