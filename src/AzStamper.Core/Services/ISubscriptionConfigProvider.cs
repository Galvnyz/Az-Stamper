using AzStamper.Core.Models;

namespace AzStamper.Core.Services;

public interface ISubscriptionConfigProvider
{
    Task<SubscriptionConfig?> GetConfigAsync(string subscriptionId, CancellationToken cancellationToken = default);
}
