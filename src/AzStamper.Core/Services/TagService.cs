using Azure;
using Microsoft.Extensions.Logging;

namespace AzStamper.Core.Services;

public class TagService : ITagService
{
    private readonly IArmTagClient _armTagClient;
    private readonly ILogger<TagService> _logger;

    public TagService(IArmTagClient armTagClient, ILogger<TagService> logger)
    {
        _armTagClient = armTagClient;
        _logger = logger;
    }

    public async Task<Dictionary<string, string>?> GetTagsAsync(string resourceId, CancellationToken cancellationToken = default)
    {
        try
        {
            return await _armTagClient.GetTagsAsync(resourceId, cancellationToken);
        }
        catch (RequestFailedException ex)
        {
            _logger.LogWarning(ex, "Failed to read tags for {ResourceId}", resourceId);
            return null;
        }
    }

    public async Task<bool> SetTagsAsync(string resourceId, Dictionary<string, string> tags, CancellationToken cancellationToken = default)
    {
        try
        {
            await _armTagClient.SetTagsAsync(resourceId, tags, cancellationToken);
            return true;
        }
        catch (RequestFailedException ex)
        {
            _logger.LogWarning(ex, "Failed to write tags to {ResourceId}", resourceId);
            return false;
        }
    }
}
