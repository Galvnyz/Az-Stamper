using Azure;
using Azure.ResourceManager;
using Azure.ResourceManager.Resources;
using Azure.ResourceManager.Resources.Models;

namespace AzStamper.Core.Services;

/// <summary>
/// Concrete implementation of <see cref="IArmTagClient"/> that delegates to the
/// Azure.ResourceManager SDK.
/// </summary>
public class ArmTagClient : IArmTagClient
{
    private readonly ArmClient _armClient;

    public ArmTagClient(ArmClient armClient)
    {
        _armClient = armClient;
    }

    public async Task<Dictionary<string, string>?> GetTagsAsync(string resourceId, CancellationToken cancellationToken = default)
    {
        var tagResourceId = TagResource.CreateResourceIdentifier(resourceId);
        var tagResource = _armClient.GetTagResource(tagResourceId);
        var response = await tagResource.GetAsync(cancellationToken);
        return response.Value.Data.TagValues
            .ToDictionary(kvp => kvp.Key, kvp => kvp.Value);
    }

    public async Task SetTagsAsync(string resourceId, Dictionary<string, string> tags, CancellationToken cancellationToken = default)
    {
        var tagResourceId = TagResource.CreateResourceIdentifier(resourceId);
        var tagResource = _armClient.GetTagResource(tagResourceId);

        var tagPatch = new TagResourcePatch
        {
            PatchMode = TagPatchMode.Merge
        };
        foreach (var (key, value) in tags)
        {
            tagPatch.TagValues[key] = value;
        }
        await tagResource.UpdateAsync(WaitUntil.Completed, tagPatch, cancellationToken);
    }
}
