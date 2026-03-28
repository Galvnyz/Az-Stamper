using System.Text.Json;
using AzStamper.Core.Models;
using AzStamper.Core.Services;

namespace AzStamper.Core.Tests;

public class BlobSubscriptionConfigProviderTests
{
    private static readonly string ValidJson = JsonSerializer.Serialize(new SubscriptionConfigRoot
    {
        Subscriptions = new Dictionary<string, SubscriptionConfig>
        {
            ["sub-111"] = new()
            {
                DisplayName = "Production",
                Enabled = true,
                TagOverrides = new Dictionary<string, TagEntry>
                {
                    ["Environment"] = new() { Value = "Production", Overwrite = false }
                }
            },
            ["sub-222"] = new()
            {
                DisplayName = "Development",
                Enabled = false
            }
        }
    }, new JsonSerializerOptions { PropertyNamingPolicy = JsonNamingPolicy.CamelCase });

    [Fact]
    public async Task GetConfig_KnownSubscription_ReturnsConfig()
    {
        var provider = new BlobSubscriptionConfigProvider(
            configLoader: () => Task.FromResult<SubscriptionConfigRoot?>(
                JsonSerializer.Deserialize<SubscriptionConfigRoot>(ValidJson,
                    new JsonSerializerOptions { PropertyNameCaseInsensitive = true })),
            cacheTtl: TimeSpan.FromMinutes(5));

        var config = await provider.GetConfigAsync("sub-111");

        Assert.NotNull(config);
        Assert.Equal("Production", config.DisplayName);
        Assert.True(config.Enabled);
        Assert.Equal("Production", config.TagOverrides["Environment"].Value);
    }

    [Fact]
    public async Task GetConfig_UnknownSubscription_ReturnsNull()
    {
        var provider = new BlobSubscriptionConfigProvider(
            configLoader: () => Task.FromResult<SubscriptionConfigRoot?>(
                JsonSerializer.Deserialize<SubscriptionConfigRoot>(ValidJson,
                    new JsonSerializerOptions { PropertyNameCaseInsensitive = true })),
            cacheTtl: TimeSpan.FromMinutes(5));

        var config = await provider.GetConfigAsync("sub-999");

        Assert.Null(config);
    }

    [Fact]
    public async Task GetConfig_LoaderReturnsNull_ReturnsNull()
    {
        var provider = new BlobSubscriptionConfigProvider(
            configLoader: () => Task.FromResult<SubscriptionConfigRoot?>(null),
            cacheTtl: TimeSpan.FromMinutes(5));

        var config = await provider.GetConfigAsync("sub-111");

        Assert.Null(config);
    }

    [Fact]
    public async Task GetConfig_CachesResult_DoesNotReloadWithinTtl()
    {
        var loadCount = 0;
        var root = JsonSerializer.Deserialize<SubscriptionConfigRoot>(ValidJson,
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
        var provider = new BlobSubscriptionConfigProvider(
            configLoader: () =>
            {
                loadCount++;
                return Task.FromResult<SubscriptionConfigRoot?>(root);
            },
            cacheTtl: TimeSpan.FromMinutes(5));

        await provider.GetConfigAsync("sub-111");
        await provider.GetConfigAsync("sub-111");
        await provider.GetConfigAsync("sub-222");

        Assert.Equal(1, loadCount);
    }

    [Fact]
    public async Task GetConfig_LoaderThrows_ReturnsNull()
    {
        var provider = new BlobSubscriptionConfigProvider(
            configLoader: () => throw new InvalidOperationException("Blob not found"),
            cacheTtl: TimeSpan.FromMinutes(5));

        var config = await provider.GetConfigAsync("sub-111");

        Assert.Null(config);
    }
}
