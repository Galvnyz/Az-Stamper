namespace AzStamper.Core.Services;

public interface ITagService
{
    Task<Dictionary<string, string>?> GetTagsAsync(string resourceId, CancellationToken cancellationToken = default);
    Task<bool> SetTagsAsync(string resourceId, Dictionary<string, string> tags, CancellationToken cancellationToken = default);
}
