namespace AzStamper.Core.Services;

/// <summary>
/// Thin wrapper around the Azure.ResourceManager tag APIs to allow unit testing
/// without requiring a live ArmClient.
/// </summary>
public interface IArmTagClient
{
    Task<Dictionary<string, string>?> GetTagsAsync(string resourceId, CancellationToken cancellationToken = default);
    Task SetTagsAsync(string resourceId, Dictionary<string, string> tags, CancellationToken cancellationToken = default);
}
