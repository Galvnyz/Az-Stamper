namespace AzStamper.Core.Models;

public class SubscriptionConfigRoot
{
    public Dictionary<string, SubscriptionConfig> Subscriptions { get; set; } = new();
}
