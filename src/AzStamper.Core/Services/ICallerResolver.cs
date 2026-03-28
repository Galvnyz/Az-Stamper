namespace AzStamper.Core.Services;

public interface ICallerResolver
{
    Task<string?> ResolveDisplayNameAsync(string principalId, CancellationToken cancellationToken = default);
}
