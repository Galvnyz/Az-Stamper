using AzStamper.Core.Models;
using Microsoft.Extensions.Logging;

namespace AzStamper.Core.Services;

public class BlobSubscriptionConfigProvider : ISubscriptionConfigProvider
{
    private readonly Func<Task<SubscriptionConfigRoot?>> _configLoader;
    private readonly TimeSpan _cacheTtl;
    private readonly ILogger<BlobSubscriptionConfigProvider>? _logger;

    private SubscriptionConfigRoot? _cachedConfig;
    private DateTime _cacheExpiry = DateTime.MinValue;
    private readonly SemaphoreSlim _loadLock = new(1, 1);

    public BlobSubscriptionConfigProvider(
        Func<Task<SubscriptionConfigRoot?>> configLoader,
        TimeSpan cacheTtl,
        ILogger<BlobSubscriptionConfigProvider>? logger = null)
    {
        _configLoader = configLoader;
        _cacheTtl = cacheTtl;
        _logger = logger;
    }

    public async Task<SubscriptionConfig?> GetConfigAsync(string subscriptionId, CancellationToken cancellationToken = default)
    {
        var root = await GetOrLoadConfigAsync(cancellationToken);
        if (root is null)
            return null;

        return root.Subscriptions.TryGetValue(subscriptionId, out var config) ? config : null;
    }

    private async Task<SubscriptionConfigRoot?> GetOrLoadConfigAsync(CancellationToken cancellationToken)
    {
        if (_cachedConfig is not null && DateTime.UtcNow < _cacheExpiry)
            return _cachedConfig;

        await _loadLock.WaitAsync(cancellationToken);
        try
        {
            // Double-check after acquiring lock
            if (_cachedConfig is not null && DateTime.UtcNow < _cacheExpiry)
                return _cachedConfig;

            try
            {
                _cachedConfig = await _configLoader();
                _cacheExpiry = DateTime.UtcNow.Add(_cacheTtl);
                _logger?.LogInformation("Loaded subscription config with {Count} subscription(s)",
                    _cachedConfig?.Subscriptions.Count ?? 0);
            }
            catch (Exception ex)
            {
                _logger?.LogWarning(ex, "Failed to load subscription config — using defaults");
                _cachedConfig = null;
                _cacheExpiry = DateTime.UtcNow.Add(TimeSpan.FromSeconds(30));
            }

            return _cachedConfig;
        }
        finally
        {
            _loadLock.Release();
        }
    }
}
