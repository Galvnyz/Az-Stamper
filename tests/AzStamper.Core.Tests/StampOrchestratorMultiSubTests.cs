using AzStamper.Core.Models;
using AzStamper.Core.Services;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Moq;

namespace AzStamper.Core.Tests;

public class StampOrchestratorMultiSubTests
{
    private readonly Mock<ICallerResolver> _callerResolver = new();
    private readonly Mock<ITagService> _tagService = new();
    private readonly Mock<ISubscriptionConfigProvider> _configProvider = new();
    private readonly Mock<ILogger<StampOrchestrator>> _logger = new();

    private static readonly StamperConfig GlobalConfig = new()
    {
        TagMap = new Dictionary<string, TagEntry>
        {
            ["Creator"] = new() { Value = "{caller}", Overwrite = false },
            ["StampedBy"] = new() { Value = "Az-Stamper", Overwrite = false }
        },
        IgnorePatterns = new List<string>
        {
            "Microsoft.Resources/deployments"
        }
    };

    private StampOrchestrator CreateOrchestrator()
    {
        var configResolver = new ConfigResolver(Options.Create(GlobalConfig));
        return new StampOrchestrator(
            _callerResolver.Object,
            _tagService.Object,
            Options.Create(GlobalConfig),
            configResolver,
            _configProvider.Object,
            _logger.Object);
    }

    [Fact]
    public async Task UnknownSubscription_UsesGlobalDefaults()
    {
        var resourceId = "/subscriptions/unknown-sub/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm1";
        _configProvider.Setup(x => x.GetConfigAsync("unknown-sub", It.IsAny<CancellationToken>()))
            .ReturnsAsync((SubscriptionConfig?)null);
        _tagService.Setup(x => x.GetTagsAsync(resourceId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Dictionary<string, string>());
        _tagService.Setup(x => x.SetTagsAsync(resourceId, It.IsAny<Dictionary<string, string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(true);

        var orchestrator = CreateOrchestrator();
        var evt = new ResourceEvent { ResourceId = resourceId, Caller = "alice@contoso.com" };

        await orchestrator.ProcessAsync(evt);

        _tagService.Verify(x => x.SetTagsAsync(
            resourceId,
            It.Is<Dictionary<string, string>>(d =>
                d["Creator"] == "alice@contoso.com" &&
                d["StampedBy"] == "Az-Stamper"),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task KnownSubscription_AppliesOverrideTags()
    {
        var resourceId = "/subscriptions/sub-prod/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm1";
        var subConfig = new SubscriptionConfig
        {
            Enabled = true,
            TagOverrides = new Dictionary<string, TagEntry>
            {
                ["Environment"] = new() { Value = "Production", Overwrite = false }
            }
        };
        _configProvider.Setup(x => x.GetConfigAsync("sub-prod", It.IsAny<CancellationToken>()))
            .ReturnsAsync(subConfig);
        _tagService.Setup(x => x.GetTagsAsync(resourceId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Dictionary<string, string>());
        _tagService.Setup(x => x.SetTagsAsync(resourceId, It.IsAny<Dictionary<string, string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(true);

        var orchestrator = CreateOrchestrator();
        var evt = new ResourceEvent { ResourceId = resourceId, Caller = "alice@contoso.com" };

        await orchestrator.ProcessAsync(evt);

        _tagService.Verify(x => x.SetTagsAsync(
            resourceId,
            It.Is<Dictionary<string, string>>(d =>
                d["Creator"] == "alice@contoso.com" &&
                d["Environment"] == "Production" &&
                d["StampedBy"] == "Az-Stamper"),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task DisabledSubscription_SkipsProcessing()
    {
        var resourceId = "/subscriptions/sub-disabled/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm1";
        var subConfig = new SubscriptionConfig { Enabled = false };
        _configProvider.Setup(x => x.GetConfigAsync("sub-disabled", It.IsAny<CancellationToken>()))
            .ReturnsAsync(subConfig);

        var orchestrator = CreateOrchestrator();
        var evt = new ResourceEvent { ResourceId = resourceId, Caller = "alice@contoso.com" };

        await orchestrator.ProcessAsync(evt);

        _tagService.Verify(x => x.SetTagsAsync(
            It.IsAny<string>(), It.IsAny<Dictionary<string, string>>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task SubscriptionAdditionalIgnorePatterns_AreApplied()
    {
        var resourceId = "/subscriptions/sub-prod/resourceGroups/rg/providers/Microsoft.Network/frontdoor/myFd";
        var subConfig = new SubscriptionConfig
        {
            Enabled = true,
            AdditionalIgnorePatterns = new List<string> { "Microsoft.Network/frontdoor" }
        };
        _configProvider.Setup(x => x.GetConfigAsync("sub-prod", It.IsAny<CancellationToken>()))
            .ReturnsAsync(subConfig);

        var orchestrator = CreateOrchestrator();
        var evt = new ResourceEvent { ResourceId = resourceId, Caller = "alice@contoso.com" };

        await orchestrator.ProcessAsync(evt);

        _tagService.Verify(x => x.SetTagsAsync(
            It.IsAny<string>(), It.IsAny<Dictionary<string, string>>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task ResourceTypeRules_ExcludeTagsForSpecificTypes()
    {
        var resourceId = "/subscriptions/sub-prod/resourceGroups/rg/providers/Microsoft.Storage/storageAccounts/sa1";
        var subConfig = new SubscriptionConfig
        {
            Enabled = true,
            TagOverrides = new Dictionary<string, TagEntry>
            {
                ["CostCenter"] = new() { Value = "CC-1234", Overwrite = false }
            },
            ResourceTypeRules = new Dictionary<string, ResourceTypeRule>
            {
                ["Microsoft.Storage/storageAccounts"] = new()
                {
                    ExcludeTags = new List<string> { "CostCenter" }
                }
            }
        };
        _configProvider.Setup(x => x.GetConfigAsync("sub-prod", It.IsAny<CancellationToken>()))
            .ReturnsAsync(subConfig);
        _tagService.Setup(x => x.GetTagsAsync(resourceId, It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Dictionary<string, string>());
        _tagService.Setup(x => x.SetTagsAsync(resourceId, It.IsAny<Dictionary<string, string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(true);

        var orchestrator = CreateOrchestrator();
        var evt = new ResourceEvent { ResourceId = resourceId, Caller = "alice@contoso.com" };

        await orchestrator.ProcessAsync(evt);

        _tagService.Verify(x => x.SetTagsAsync(
            resourceId,
            It.Is<Dictionary<string, string>>(d =>
                !d.ContainsKey("CostCenter") &&
                d.ContainsKey("Creator")),
            It.IsAny<CancellationToken>()), Times.Once);
    }
}
