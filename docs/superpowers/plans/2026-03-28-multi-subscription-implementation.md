# Multi-Subscription Az-Stamper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable hub-and-spoke multi-subscription tagging with Deploy-to-Azure enrollment, per-subscription config overrides, and resource-type filtering.

**Architecture:** A centralized function app (hub) processes events from multiple subscriptions (spokes). Each spoke enrolls via a Deploy-to-Azure button that deploys Event Grid + RBAC. An optional `stamper.json` blob provides per-subscription tag overrides and resource-type rules. Unknown subscriptions auto-discover with global defaults.

**Tech Stack:** C# .NET 8, Azure Functions Isolated Worker, Azure.Storage.Blobs, Bicep, xUnit + Moq, PowerShell 7.x

---

## File Map

### New Files

| File | Responsibility |
|------|---------------|
| `src/AzStamper.Core/Models/SubscriptionConfig.cs` | Per-subscription config: enabled flag, tag overrides, resource-type rules, additional ignore patterns |
| `src/AzStamper.Core/Models/ResourceTypeRule.cs` | Resource-type filtering: additional tags to add, tag names to exclude |
| `src/AzStamper.Core/Models/StamperRuleSet.cs` | Merged config for a single event (result of resolution pipeline) |
| `src/AzStamper.Core/Models/SubscriptionConfigRoot.cs` | Root deserialization target for `stamper.json` |
| `src/AzStamper.Core/Services/ISubscriptionConfigProvider.cs` | Interface for loading per-subscription config |
| `src/AzStamper.Core/Services/BlobSubscriptionConfigProvider.cs` | Reads `stamper.json` from blob, caches with TTL |
| `src/AzStamper.Core/Services/ConfigResolver.cs` | Merges global defaults + sub overrides + resource-type rules into a `StamperRuleSet` |
| `tests/AzStamper.Core.Tests/ConfigResolverTests.cs` | Tests for config resolution logic |
| `tests/AzStamper.Core.Tests/BlobSubscriptionConfigProviderTests.cs` | Tests for blob config loading and caching |
| `tests/AzStamper.Core.Tests/StampOrchestratorMultiSubTests.cs` | End-to-end orchestrator tests with multi-sub config |
| `infra/enroll.bicep` | Subscription-scoped spoke enrollment template |
| `infra/modules/enrollment.bicep` | Shared module: Event Grid System Topic + Event Subscription |
| `scripts/unenroll.ps1` | PowerShell script to remove spoke enrollment |
| `stamper.schema.json` | JSON Schema for `stamper.json` config validation |

### Modified Files

| File | Change |
|------|--------|
| `src/AzStamper.Core/AzStamper.Core.csproj` | Add `Azure.Storage.Blobs` and `System.Text.Json` NuGet references |
| `src/AzStamper.Core/StampOrchestrator.cs` | Accept `ConfigResolver` + `ISubscriptionConfigProvider`. Use resolved `StamperRuleSet` per event. |
| `src/AzStamper.Core/Models/ResourceEvent.cs` | Add `SubscriptionId` property (extracted from ResourceId) |
| `src/AzStamper.Functions/Program.cs` | Register `ISubscriptionConfigProvider` → `BlobSubscriptionConfigProvider` in DI |
| `src/AzStamper.Functions/Functions/ResourceStamperFunction.cs` | Extract subscription ID from event data |
| `infra/main.bicep` | Output `functionAppId` and `principalId` (already outputs these) |
| `infra/modules/storage.bicep` | Add `config` blob container |
| `infra/modules/functionApp.bicep` | Add `StamperConfig__ConfigBlobUri` app setting |

---

### Task 1: Add Per-Subscription Config Models

**Files:**
- Create: `src/AzStamper.Core/Models/SubscriptionConfig.cs`
- Create: `src/AzStamper.Core/Models/ResourceTypeRule.cs`
- Create: `src/AzStamper.Core/Models/StamperRuleSet.cs`
- Create: `src/AzStamper.Core/Models/SubscriptionConfigRoot.cs`

- [ ] **Step 1: Create `SubscriptionConfig.cs`**

```csharp
// src/AzStamper.Core/Models/SubscriptionConfig.cs
namespace AzStamper.Core.Models;

public class SubscriptionConfig
{
    public string DisplayName { get; set; } = string.Empty;
    public bool Enabled { get; set; } = true;
    public Dictionary<string, TagEntry> TagOverrides { get; set; } = new();
    public Dictionary<string, ResourceTypeRule> ResourceTypeRules { get; set; } = new();
    public List<string> AdditionalIgnorePatterns { get; set; } = new();
}
```

- [ ] **Step 2: Create `ResourceTypeRule.cs`**

```csharp
// src/AzStamper.Core/Models/ResourceTypeRule.cs
namespace AzStamper.Core.Models;

public class ResourceTypeRule
{
    public Dictionary<string, TagEntry> AdditionalTags { get; set; } = new();
    public List<string> ExcludeTags { get; set; } = new();
}
```

- [ ] **Step 3: Create `StamperRuleSet.cs`**

```csharp
// src/AzStamper.Core/Models/StamperRuleSet.cs
namespace AzStamper.Core.Models;

public class StamperRuleSet
{
    public Dictionary<string, TagEntry> TagMap { get; set; } = new();
    public List<string> IgnorePatterns { get; set; } = new();
    public bool Enabled { get; set; } = true;
    public string ConfigSource { get; set; } = "global";
}
```

- [ ] **Step 4: Create `SubscriptionConfigRoot.cs`**

```csharp
// src/AzStamper.Core/Models/SubscriptionConfigRoot.cs
namespace AzStamper.Core.Models;

public class SubscriptionConfigRoot
{
    public Dictionary<string, SubscriptionConfig> Subscriptions { get; set; } = new();
}
```

- [ ] **Step 5: Verify build**

Run: `dotnet build src/AzStamper.Core/AzStamper.Core.csproj`
Expected: Build succeeded

- [ ] **Step 6: Commit**

```bash
git add src/AzStamper.Core/Models/SubscriptionConfig.cs src/AzStamper.Core/Models/ResourceTypeRule.cs src/AzStamper.Core/Models/StamperRuleSet.cs src/AzStamper.Core/Models/SubscriptionConfigRoot.cs
git commit -m "feat: add per-subscription config models

Add SubscriptionConfig, ResourceTypeRule, StamperRuleSet, and
SubscriptionConfigRoot models to support multi-subscription
tag configuration with per-sub overrides and resource-type rules."
```

---

### Task 2: Add ConfigResolver with Tests (TDD)

**Files:**
- Create: `src/AzStamper.Core/Services/ConfigResolver.cs`
- Create: `tests/AzStamper.Core.Tests/ConfigResolverTests.cs`

- [ ] **Step 1: Write the failing tests**

```csharp
// tests/AzStamper.Core.Tests/ConfigResolverTests.cs
using AzStamper.Core.Models;
using AzStamper.Core.Services;
using Microsoft.Extensions.Options;

namespace AzStamper.Core.Tests;

public class ConfigResolverTests
{
    private static readonly StamperConfig GlobalConfig = new()
    {
        TagMap = new Dictionary<string, TagEntry>
        {
            ["Creator"] = new() { Value = "{caller}", Overwrite = false },
            ["LastModifiedBy"] = new() { Value = "{caller}", Overwrite = true },
            ["StampedBy"] = new() { Value = "Az-Stamper", Overwrite = false }
        },
        IgnorePatterns = new List<string>
        {
            "Microsoft.Resources/deployments",
            "Microsoft.Resources/tags"
        }
    };

    private ConfigResolver CreateResolver(StamperConfig? config = null)
    {
        return new ConfigResolver(Options.Create(config ?? GlobalConfig));
    }

    [Fact]
    public void Resolve_NoSubscriptionConfig_ReturnsGlobalDefaults()
    {
        var resolver = CreateResolver();

        var result = resolver.Resolve(subscriptionConfig: null, resourceType: "Microsoft.Compute/virtualMachines");

        Assert.Equal("global", result.ConfigSource);
        Assert.True(result.Enabled);
        Assert.Equal(3, result.TagMap.Count);
        Assert.Equal("{caller}", result.TagMap["Creator"].Value);
        Assert.Equal(2, result.IgnorePatterns.Count);
    }

    [Fact]
    public void Resolve_WithTagOverrides_MergesIntoGlobals()
    {
        var resolver = CreateResolver();
        var subConfig = new SubscriptionConfig
        {
            TagOverrides = new Dictionary<string, TagEntry>
            {
                ["Environment"] = new() { Value = "Production", Overwrite = false },
                ["Creator"] = new() { Value = "overridden-{caller}", Overwrite = false }
            }
        };

        var result = resolver.Resolve(subConfig, "Microsoft.Compute/virtualMachines");

        Assert.Equal("subscription-override", result.ConfigSource);
        Assert.Equal(4, result.TagMap.Count);
        Assert.Equal("Production", result.TagMap["Environment"].Value);
        Assert.Equal("overridden-{caller}", result.TagMap["Creator"].Value);
        Assert.Equal("{caller}", result.TagMap["LastModifiedBy"].Value);
    }

    [Fact]
    public void Resolve_WithResourceTypeAdditionalTags_AddsToTagMap()
    {
        var resolver = CreateResolver();
        var subConfig = new SubscriptionConfig
        {
            ResourceTypeRules = new Dictionary<string, ResourceTypeRule>
            {
                ["Microsoft.Compute/virtualMachines"] = new()
                {
                    AdditionalTags = new Dictionary<string, TagEntry>
                    {
                        ["ManagedBy"] = new() { Value = "InfraTeam", Overwrite = false }
                    }
                }
            }
        };

        var result = resolver.Resolve(subConfig, "Microsoft.Compute/virtualMachines");

        Assert.Equal(4, result.TagMap.Count);
        Assert.Equal("InfraTeam", result.TagMap["ManagedBy"].Value);
    }

    [Fact]
    public void Resolve_WithResourceTypeExcludeTags_RemovesFromTagMap()
    {
        var resolver = CreateResolver();
        var subConfig = new SubscriptionConfig
        {
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

        var result = resolver.Resolve(subConfig, "Microsoft.Storage/storageAccounts");

        Assert.False(result.TagMap.ContainsKey("CostCenter"));
        Assert.Equal(3, result.TagMap.Count);
    }

    [Fact]
    public void Resolve_ResourceTypeNotInRules_IgnoresResourceTypeRules()
    {
        var resolver = CreateResolver();
        var subConfig = new SubscriptionConfig
        {
            ResourceTypeRules = new Dictionary<string, ResourceTypeRule>
            {
                ["Microsoft.Compute/virtualMachines"] = new()
                {
                    AdditionalTags = new Dictionary<string, TagEntry>
                    {
                        ["ManagedBy"] = new() { Value = "InfraTeam", Overwrite = false }
                    }
                }
            }
        };

        var result = resolver.Resolve(subConfig, "Microsoft.Storage/storageAccounts");

        Assert.Equal(3, result.TagMap.Count);
        Assert.False(result.TagMap.ContainsKey("ManagedBy"));
    }

    [Fact]
    public void Resolve_DisabledSubscription_ReturnsDisabledRuleSet()
    {
        var resolver = CreateResolver();
        var subConfig = new SubscriptionConfig { Enabled = false };

        var result = resolver.Resolve(subConfig, "Microsoft.Compute/virtualMachines");

        Assert.False(result.Enabled);
    }

    [Fact]
    public void Resolve_WithAdditionalIgnorePatterns_CombinesWithGlobals()
    {
        var resolver = CreateResolver();
        var subConfig = new SubscriptionConfig
        {
            AdditionalIgnorePatterns = new List<string> { "Microsoft.Network/frontdoor" }
        };

        var result = resolver.Resolve(subConfig, "Microsoft.Compute/virtualMachines");

        Assert.Equal(3, result.IgnorePatterns.Count);
        Assert.Contains("Microsoft.Network/frontdoor", result.IgnorePatterns);
        Assert.Contains("Microsoft.Resources/deployments", result.IgnorePatterns);
    }

    [Fact]
    public void Resolve_ResourceTypeCaseInsensitive_MatchesRules()
    {
        var resolver = CreateResolver();
        var subConfig = new SubscriptionConfig
        {
            ResourceTypeRules = new Dictionary<string, ResourceTypeRule>
            {
                ["microsoft.compute/virtualmachines"] = new()
                {
                    AdditionalTags = new Dictionary<string, TagEntry>
                    {
                        ["ManagedBy"] = new() { Value = "InfraTeam", Overwrite = false }
                    }
                }
            }
        };

        var result = resolver.Resolve(subConfig, "Microsoft.Compute/virtualMachines");

        Assert.Equal(4, result.TagMap.Count);
        Assert.Equal("InfraTeam", result.TagMap["ManagedBy"].Value);
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `dotnet test tests/AzStamper.Core.Tests/ --filter "FullyQualifiedName~ConfigResolverTests" --no-restore`
Expected: FAIL — `ConfigResolver` class does not exist

- [ ] **Step 3: Implement ConfigResolver**

```csharp
// src/AzStamper.Core/Services/ConfigResolver.cs
using AzStamper.Core.Models;
using Microsoft.Extensions.Options;

namespace AzStamper.Core.Services;

public class ConfigResolver
{
    private readonly StamperConfig _globalConfig;

    public ConfigResolver(IOptions<StamperConfig> globalConfig)
    {
        _globalConfig = globalConfig.Value;
    }

    public StamperRuleSet Resolve(SubscriptionConfig? subscriptionConfig, string resourceType)
    {
        // Start with global defaults (deep copy tag map)
        var tagMap = new Dictionary<string, TagEntry>();
        foreach (var (key, entry) in _globalConfig.TagMap)
        {
            tagMap[key] = new TagEntry { Value = entry.Value, Overwrite = entry.Overwrite };
        }

        var ignorePatterns = new List<string>(_globalConfig.IgnorePatterns);
        var configSource = "global";

        if (subscriptionConfig is null)
        {
            return new StamperRuleSet
            {
                TagMap = tagMap,
                IgnorePatterns = ignorePatterns,
                Enabled = true,
                ConfigSource = configSource
            };
        }

        if (!subscriptionConfig.Enabled)
        {
            return new StamperRuleSet { Enabled = false, ConfigSource = "subscription-override" };
        }

        configSource = "subscription-override";

        // Merge subscription tag overrides
        foreach (var (key, entry) in subscriptionConfig.TagOverrides)
        {
            tagMap[key] = new TagEntry { Value = entry.Value, Overwrite = entry.Overwrite };
        }

        // Apply resource-type rules
        var matchingRule = subscriptionConfig.ResourceTypeRules
            .FirstOrDefault(r => string.Equals(r.Key, resourceType, StringComparison.OrdinalIgnoreCase));

        if (matchingRule.Value is not null)
        {
            foreach (var (key, entry) in matchingRule.Value.AdditionalTags)
            {
                tagMap[key] = new TagEntry { Value = entry.Value, Overwrite = entry.Overwrite };
            }

            foreach (var excludeKey in matchingRule.Value.ExcludeTags)
            {
                tagMap.Remove(excludeKey);
            }
        }

        // Combine ignore patterns
        ignorePatterns.AddRange(subscriptionConfig.AdditionalIgnorePatterns);

        return new StamperRuleSet
        {
            TagMap = tagMap,
            IgnorePatterns = ignorePatterns,
            Enabled = true,
            ConfigSource = configSource
        };
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `dotnet test tests/AzStamper.Core.Tests/ --filter "FullyQualifiedName~ConfigResolverTests" -v normal`
Expected: All 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/AzStamper.Core/Services/ConfigResolver.cs tests/AzStamper.Core.Tests/ConfigResolverTests.cs
git commit -m "feat: add ConfigResolver with TDD tests

Implements the config resolution pipeline: global defaults →
subscription overrides → resource-type rules → merged StamperRuleSet.
Supports case-insensitive resource-type matching and tag exclusion."
```

---

### Task 3: Add ISubscriptionConfigProvider Interface and BlobSubscriptionConfigProvider with Tests (TDD)

**Files:**
- Create: `src/AzStamper.Core/Services/ISubscriptionConfigProvider.cs`
- Create: `src/AzStamper.Core/Services/BlobSubscriptionConfigProvider.cs`
- Create: `tests/AzStamper.Core.Tests/BlobSubscriptionConfigProviderTests.cs`
- Modify: `src/AzStamper.Core/AzStamper.Core.csproj`

- [ ] **Step 1: Add `Azure.Storage.Blobs` NuGet reference to Core project**

Edit `src/AzStamper.Core/AzStamper.Core.csproj` — add inside the `<ItemGroup>` with other PackageReferences:

```xml
    <PackageReference Include="Azure.Storage.Blobs" Version="12.23.0" />
```

- [ ] **Step 2: Create `ISubscriptionConfigProvider.cs`**

```csharp
// src/AzStamper.Core/Services/ISubscriptionConfigProvider.cs
using AzStamper.Core.Models;

namespace AzStamper.Core.Services;

public interface ISubscriptionConfigProvider
{
    Task<SubscriptionConfig?> GetConfigAsync(string subscriptionId, CancellationToken cancellationToken = default);
}
```

- [ ] **Step 3: Write the failing tests for BlobSubscriptionConfigProvider**

```csharp
// tests/AzStamper.Core.Tests/BlobSubscriptionConfigProviderTests.cs
using System.Text;
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
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `dotnet test tests/AzStamper.Core.Tests/ --filter "FullyQualifiedName~BlobSubscriptionConfigProviderTests" --no-restore`
Expected: FAIL — `BlobSubscriptionConfigProvider` class does not exist

- [ ] **Step 5: Implement BlobSubscriptionConfigProvider**

```csharp
// src/AzStamper.Core/Services/BlobSubscriptionConfigProvider.cs
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
                _cacheExpiry = DateTime.UtcNow.Add(TimeSpan.FromSeconds(30)); // Short retry interval on failure
            }

            return _cachedConfig;
        }
        finally
        {
            _loadLock.Release();
        }
    }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `dotnet test tests/AzStamper.Core.Tests/ --filter "FullyQualifiedName~BlobSubscriptionConfigProviderTests" -v normal`
Expected: All 5 tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/AzStamper.Core/AzStamper.Core.csproj src/AzStamper.Core/Services/ISubscriptionConfigProvider.cs src/AzStamper.Core/Services/BlobSubscriptionConfigProvider.cs tests/AzStamper.Core.Tests/BlobSubscriptionConfigProviderTests.cs
git commit -m "feat: add BlobSubscriptionConfigProvider with caching

Implements ISubscriptionConfigProvider backed by a configurable loader
function with in-memory caching and configurable TTL. Fails gracefully
when config cannot be loaded — all subscriptions get global defaults."
```

---

### Task 4: Add SubscriptionId to ResourceEvent and Extract from ResourceId

**Files:**
- Modify: `src/AzStamper.Core/Models/ResourceEvent.cs`
- Test inline in existing test patterns

- [ ] **Step 1: Add `SubscriptionId` property to `ResourceEvent`**

Edit `src/AzStamper.Core/Models/ResourceEvent.cs` — replace the entire file:

```csharp
namespace AzStamper.Core.Models;

public class ResourceEvent
{
    public string? ResourceId { get; set; }
    public string? Caller { get; set; }
    public string? PrincipalType { get; set; }
    public string? PrincipalId { get; set; }

    public string? SubscriptionId => ExtractSubscriptionId(ResourceId);

    public string? ResourceType => ExtractResourceType(ResourceId);

    private static string? ExtractSubscriptionId(string? resourceId)
    {
        if (string.IsNullOrEmpty(resourceId))
            return null;

        // Format: /subscriptions/{subscriptionId}/resourceGroups/...
        const string prefix = "/subscriptions/";
        var startIndex = resourceId.IndexOf(prefix, StringComparison.OrdinalIgnoreCase);
        if (startIndex < 0)
            return null;

        startIndex += prefix.Length;
        var endIndex = resourceId.IndexOf('/', startIndex);
        return endIndex < 0 ? resourceId[startIndex..] : resourceId[startIndex..endIndex];
    }

    private static string? ExtractResourceType(string? resourceId)
    {
        if (string.IsNullOrEmpty(resourceId))
            return null;

        // Format: .../providers/{namespace}/{type}/{name}
        const string providers = "/providers/";
        var providerIndex = resourceId.LastIndexOf(providers, StringComparison.OrdinalIgnoreCase);
        if (providerIndex < 0)
            return null;

        var afterProvider = resourceId[(providerIndex + providers.Length)..];
        // Take namespace/type (first two segments)
        var segments = afterProvider.Split('/');
        return segments.Length >= 2 ? $"{segments[0]}/{segments[1]}" : null;
    }
}
```

- [ ] **Step 2: Verify existing tests still pass**

Run: `dotnet test tests/AzStamper.Core.Tests/ -v normal`
Expected: All existing tests PASS (new properties are computed, no breaking changes)

- [ ] **Step 3: Commit**

```bash
git add src/AzStamper.Core/Models/ResourceEvent.cs
git commit -m "feat: add SubscriptionId and ResourceType computed properties to ResourceEvent

Extracts subscription ID and resource type from the Azure resource ID
string. Both are computed properties with null-safe parsing."
```

---

### Task 5: Refactor StampOrchestrator for Multi-Subscription Config with Tests (TDD)

**Files:**
- Modify: `src/AzStamper.Core/StampOrchestrator.cs`
- Create: `tests/AzStamper.Core.Tests/StampOrchestratorMultiSubTests.cs`
- Modify: `tests/AzStamper.Core.Tests/StampOrchestratorTests.cs` (update constructor)

- [ ] **Step 1: Write the failing multi-sub tests**

```csharp
// tests/AzStamper.Core.Tests/StampOrchestratorMultiSubTests.cs
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `dotnet test tests/AzStamper.Core.Tests/ --filter "FullyQualifiedName~StampOrchestratorMultiSubTests" --no-restore`
Expected: FAIL — `StampOrchestrator` constructor doesn't accept `ConfigResolver` and `ISubscriptionConfigProvider`

- [ ] **Step 3: Refactor StampOrchestrator**

Replace the entire file `src/AzStamper.Core/StampOrchestrator.cs`:

```csharp
using AzStamper.Core.Models;
using AzStamper.Core.Services;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace AzStamper.Core;

public class StampOrchestrator
{
    private readonly ICallerResolver _callerResolver;
    private readonly ITagService _tagService;
    private readonly StamperConfig _globalConfig;
    private readonly ConfigResolver _configResolver;
    private readonly ISubscriptionConfigProvider _subscriptionConfigProvider;
    private readonly ILogger<StampOrchestrator> _logger;

    public StampOrchestrator(
        ICallerResolver callerResolver,
        ITagService tagService,
        IOptions<StamperConfig> globalConfig,
        ConfigResolver configResolver,
        ISubscriptionConfigProvider subscriptionConfigProvider,
        ILogger<StampOrchestrator> logger)
    {
        _callerResolver = callerResolver;
        _tagService = tagService;
        _globalConfig = globalConfig.Value;
        _configResolver = configResolver;
        _subscriptionConfigProvider = subscriptionConfigProvider;
        _logger = logger;
    }

    public async Task ProcessAsync(ResourceEvent evt, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrEmpty(evt.ResourceId))
        {
            _logger.LogWarning("Event has null or empty ResourceId — skipping");
            return;
        }

        // Resolve per-subscription config
        var subscriptionId = evt.SubscriptionId;
        var resourceType = evt.ResourceType ?? "Unknown";
        SubscriptionConfig? subConfig = null;

        if (!string.IsNullOrEmpty(subscriptionId))
        {
            subConfig = await _subscriptionConfigProvider.GetConfigAsync(subscriptionId, cancellationToken);
        }

        var ruleSet = _configResolver.Resolve(subConfig, resourceType);

        if (!ruleSet.Enabled)
        {
            _logger.LogInformation("Subscription {SubscriptionId} is disabled — skipping {ResourceId}",
                subscriptionId, evt.ResourceId);
            return;
        }

        // Check ignore list (using resolved ignore patterns)
        foreach (var pattern in ruleSet.IgnorePatterns)
        {
            if (evt.ResourceId.Contains(pattern, StringComparison.OrdinalIgnoreCase))
            {
                _logger.LogInformation("Skipping {ResourceId} — matches ignore pattern: {Pattern}", evt.ResourceId, pattern);
                return;
            }
        }

        // Resolve caller identity
        var caller = evt.Caller;
        if (string.IsNullOrEmpty(caller))
        {
            if (!string.IsNullOrEmpty(evt.PrincipalId) &&
                string.Equals(evt.PrincipalType, "ServicePrincipal", StringComparison.OrdinalIgnoreCase))
            {
                caller = await _callerResolver.ResolveDisplayNameAsync(evt.PrincipalId, cancellationToken);
                caller ??= evt.PrincipalId;
            }
            else
            {
                _logger.LogWarning("Cannot resolve caller for {ResourceId} — skipping", evt.ResourceId);
                return;
            }
        }

        _logger.LogInformation("Processing {ResourceId} — caller: {Caller}, config: {ConfigSource}",
            evt.ResourceId, caller, ruleSet.ConfigSource);

        if (ruleSet.TagMap.Count == 0)
        {
            _logger.LogInformation("Tag map is empty — nothing to stamp");
            return;
        }

        // Read existing tags
        var existingTags = await _tagService.GetTagsAsync(evt.ResourceId, cancellationToken);
        if (existingTags is null)
        {
            _logger.LogWarning("Could not read tags for {ResourceId} — skipping", evt.ResourceId);
            return;
        }

        // Build tag set to apply
        var tagsToApply = new Dictionary<string, string>();
        var timestamp = DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ");

        foreach (var (key, entry) in ruleSet.TagMap)
        {
            if (existingTags.ContainsKey(key) && !entry.Overwrite)
            {
                _logger.LogInformation("Tag '{Key}' already exists on {ResourceId} — skipping (overwrite=false)", key, evt.ResourceId);
                continue;
            }

            var value = ResolveTemplate(entry.Value, caller, timestamp, evt.PrincipalType);
            tagsToApply[key] = value;
        }

        if (tagsToApply.Count == 0)
        {
            _logger.LogInformation("No new tags to apply to {ResourceId}", evt.ResourceId);
            return;
        }

        var success = await _tagService.SetTagsAsync(evt.ResourceId, tagsToApply, cancellationToken);
        if (success)
        {
            _logger.LogInformation("Stamped {Count} tag(s) on {ResourceId}", tagsToApply.Count, evt.ResourceId);
        }
        else
        {
            _logger.LogWarning("Failed to stamp tags on {ResourceId}", evt.ResourceId);
        }
    }

    private static string ResolveTemplate(string template, string caller, string timestamp, string? principalType)
    {
        return template
            .Replace("{caller}", caller)
            .Replace("{timestamp}", timestamp)
            .Replace("{principalType}", principalType ?? "Unknown");
    }
}
```

- [ ] **Step 4: Update existing StampOrchestratorTests to use new constructor**

Edit `tests/AzStamper.Core.Tests/StampOrchestratorTests.cs` — replace the `CreateOrchestrator` method and add the `_configProvider` field:

Add this field after line 13 (`private readonly Mock<ILogger<StampOrchestrator>> _logger;`):

```csharp
    private readonly Mock<ISubscriptionConfigProvider> _configProvider;
```

Add this line in the constructor after `_logger = new Mock<ILogger<StampOrchestrator>>();`:

```csharp
        _configProvider = new Mock<ISubscriptionConfigProvider>();
```

Replace the `CreateOrchestrator` method (lines 38-42):

```csharp
    private StampOrchestrator CreateOrchestrator(StamperConfig? config = null)
    {
        var options = Options.Create(config ?? DefaultConfig);
        var configResolver = new ConfigResolver(options);
        return new StampOrchestrator(
            _callerResolver.Object,
            _tagService.Object,
            options,
            configResolver,
            _configProvider.Object,
            _logger.Object);
    }
```

Add the missing `using` directive at the top of the file:

```csharp
using AzStamper.Core.Services;
```

Note: The existing `using` for `AzStamper.Core.Services` is already present (for `ICallerResolver` and `ITagService`), so only the `_configProvider` field and constructor changes are needed.

- [ ] **Step 5: Run ALL tests to verify they pass**

Run: `dotnet test tests/AzStamper.Core.Tests/ -v normal`
Expected: All tests PASS (existing + new multi-sub tests)

- [ ] **Step 6: Commit**

```bash
git add src/AzStamper.Core/StampOrchestrator.cs tests/AzStamper.Core.Tests/StampOrchestratorTests.cs tests/AzStamper.Core.Tests/StampOrchestratorMultiSubTests.cs
git commit -m "feat: refactor StampOrchestrator for per-subscription config resolution

StampOrchestrator now resolves per-event config via ConfigResolver and
ISubscriptionConfigProvider. Unknown subscriptions auto-discover with
global defaults. Disabled subscriptions are skipped. Existing tests
updated to use new constructor signature."
```

---

### Task 6: Wire Up DI in Functions Project

**Files:**
- Modify: `src/AzStamper.Functions/Program.cs`

- [ ] **Step 1: Update `Program.cs` to register new services**

Replace the entire file `src/AzStamper.Functions/Program.cs`:

```csharp
using System.Text.Json;
using Azure.Identity;
using Azure.ResourceManager;
using Azure.Storage.Blobs;
using AzStamper.Core;
using AzStamper.Core.Models;
using AzStamper.Core.Services;
using Microsoft.Azure.Functions.Worker.Builder;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Graph;

var builder = FunctionsApplication.CreateBuilder(args);

builder.Services.Configure<StamperConfig>(
    builder.Configuration.GetSection("StamperConfig"));

var credential = new DefaultAzureCredential();

builder.Services.AddSingleton(new ArmClient(credential));
builder.Services.AddSingleton(new GraphServiceClient(credential));
builder.Services.AddSingleton<IGraphServicePrincipalClient, GraphServicePrincipalClient>();
builder.Services.AddSingleton<IArmTagClient, ArmTagClient>();
builder.Services.AddSingleton<ICallerResolver, CallerResolver>();
builder.Services.AddSingleton<ITagService, TagService>();
builder.Services.AddSingleton<ConfigResolver>();

// Register subscription config provider
var configBlobUri = builder.Configuration["StamperConfig:ConfigBlobUri"];
if (!string.IsNullOrEmpty(configBlobUri))
{
    var blobClient = new BlobClient(new Uri(configBlobUri), credential);
    builder.Services.AddSingleton<ISubscriptionConfigProvider>(sp =>
        new BlobSubscriptionConfigProvider(
            configLoader: async () =>
            {
                if (!await blobClient.ExistsAsync())
                    return null;

                var response = await blobClient.DownloadContentAsync();
                return JsonSerializer.Deserialize<SubscriptionConfigRoot>(
                    response.Value.Content.ToString(),
                    new JsonSerializerOptions { PropertyNameCaseInsensitive = true });
            },
            cacheTtl: TimeSpan.FromMinutes(5),
            logger: sp.GetService<Microsoft.Extensions.Logging.ILogger<BlobSubscriptionConfigProvider>>()));
}
else
{
    // No config blob configured — all subscriptions get global defaults
    builder.Services.AddSingleton<ISubscriptionConfigProvider>(sp =>
        new BlobSubscriptionConfigProvider(
            configLoader: () => Task.FromResult<SubscriptionConfigRoot?>(null),
            cacheTtl: TimeSpan.FromMinutes(5)));
}

builder.Services.AddSingleton<StampOrchestrator>();

builder.Build().Run();
```

- [ ] **Step 2: Verify build succeeds**

Run: `dotnet build Az-Stamper.sln`
Expected: Build succeeded

- [ ] **Step 3: Commit**

```bash
git add src/AzStamper.Functions/Program.cs
git commit -m "feat: wire up multi-subscription DI in Functions host

Registers ConfigResolver and BlobSubscriptionConfigProvider in DI.
When StamperConfig:ConfigBlobUri is set, loads subscription config from
blob storage. When unset, all subscriptions get global defaults."
```

---

### Task 7: Update Infrastructure — Storage Config Container

**Files:**
- Modify: `infra/modules/storage.bicep`
- Modify: `infra/modules/functionApp.bicep`

- [ ] **Step 1: Add config container to storage module**

Edit `infra/modules/storage.bicep` — add after the `deploymentContainer` resource (after line 29):

```bicep

resource configContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: 'config'
}
```

Add a new output at the end of the file:

```bicep
output configContainerName string = configContainer.name
```

- [ ] **Step 2: Add ConfigBlobUri app setting to function app module**

Edit `infra/modules/functionApp.bicep` — add a new parameter after `appInsightsConnectionString`:

```bicep
param storageBlobEndpoint string
```

Wait — `storageBlobEndpoint` is not currently a parameter of functionApp.bicep. We need to add it. Actually, looking at main.bicep, it already passes `storageBlobEndpoint: storage.outputs.primaryBlobEndpoint` to the functionApp module. Let me check...

No, looking at the existing `functionApp.bicep` parameters, it has `storageAccountName` and builds the URL from `environment().suffixes.storage`. We need to add the config blob URI.

Edit `infra/modules/functionApp.bicep` — add this app setting entry inside the `appSettings` array, after the last `StamperConfig__IgnorePatterns__2` entry (after line 124, before the closing `]`):

```bicep
        {
          name: 'StamperConfig__ConfigBlobUri'
          value: 'https://${storageAccountName}.blob.${environment().suffixes.storage}/config/stamper.json'
        }
```

- [ ] **Step 3: Validate Bicep builds**

Run: `az bicep build --file infra/main.bicep`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add infra/modules/storage.bicep infra/modules/functionApp.bicep
git commit -m "chore: add config blob container and ConfigBlobUri app setting

Storage module creates a 'config' container for stamper.json.
Function app gets StamperConfig__ConfigBlobUri setting pointing to
the blob location for per-subscription config overrides."
```

---

### Task 8: Create Enrollment Bicep Template

**Files:**
- Create: `infra/modules/enrollment.bicep`
- Create: `infra/enroll.bicep`

- [ ] **Step 1: Create the enrollment module**

```bicep
// infra/modules/enrollment.bicep
param systemTopicName string
param eventSubscriptionName string
param functionAppId string
param subscriptionId string
param location string = 'global'

resource systemTopic 'Microsoft.EventGrid/systemTopics@2022-06-15' = {
  name: systemTopicName
  location: location
  properties: {
    source: '/subscriptions/${subscriptionId}'
    topicType: 'Microsoft.Resources.Subscriptions'
  }
}

resource eventSubscription 'Microsoft.EventGrid/systemTopics/eventSubscriptions@2022-06-15' = {
  parent: systemTopic
  name: eventSubscriptionName
  properties: {
    destination: {
      endpointType: 'AzureFunction'
      properties: {
        resourceId: '${functionAppId}/functions/ResourceStamper'
      }
    }
    filter: {
      includedEventTypes: [
        'Microsoft.Resources.ResourceWriteSuccess'
      ]
      advancedFilters: [
        {
          operatorType: 'StringNotContains'
          key: 'data.operationName'
          values: [
            'Microsoft.Resources/deployments'
          ]
        }
      ]
    }
  }
}
```

- [ ] **Step 2: Create the subscription-scoped enrollment template**

```bicep
// infra/enroll.bicep
targetScope = 'subscription'

@description('Resource ID of the Az-Stamper function app (e.g., /subscriptions/.../Microsoft.Web/sites/func-az-stamper)')
param functionAppResourceId string

@description('Principal ID (object ID) of the Az-Stamper function app managed identity')
param functionAppPrincipalId string

@description('Name for the Event Grid system topic')
param systemTopicName string = 'evgt-az-stamper'

@description('Name for the Event Grid event subscription')
param eventSubscriptionName string = 'evgs-az-stamper'

@description('Resource group name in the target subscription for the Event Grid system topic')
param eventGridResourceGroupName string

@description('Location for the Event Grid resources')
param location string = 'global'

// Event Grid module deploys into the specified resource group
module eventGrid 'modules/enrollment.bicep' = {
  name: 'az-stamper-enrollment'
  scope: resourceGroup(eventGridResourceGroupName)
  params: {
    systemTopicName: systemTopicName
    eventSubscriptionName: eventSubscriptionName
    functionAppId: functionAppResourceId
    subscriptionId: subscription().subscriptionId
    location: location
  }
}

// Subscription-scoped RBAC: Reader
resource readerRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(subscription().id, functionAppPrincipalId, 'acdd72a7-3385-48ef-bd42-f606fba81ae7')
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'acdd72a7-3385-48ef-bd42-f606fba81ae7')
    principalId: functionAppPrincipalId
    principalType: 'ServicePrincipal'
  }
}

// Subscription-scoped RBAC: Tag Contributor
resource tagContributorRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(subscription().id, functionAppPrincipalId, '4a9ae827-6dc8-4573-8ac7-8239d42aa03f')
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4a9ae827-6dc8-4573-8ac7-8239d42aa03f')
    principalId: functionAppPrincipalId
    principalType: 'ServicePrincipal'
  }
}
```

- [ ] **Step 3: Validate Bicep builds**

Run: `az bicep build --file infra/enroll.bicep`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add infra/enroll.bicep infra/modules/enrollment.bicep
git commit -m "feat: add enroll.bicep spoke enrollment template

Subscription-scoped Bicep template that creates Event Grid System Topic,
Event Subscription, and RBAC (Reader + Tag Contributor) for the
Az-Stamper function app's managed identity. Designed for Deploy-to-Azure
button usage."
```

---

### Task 9: Create Unenroll PowerShell Script

**Files:**
- Create: `scripts/unenroll.ps1`

- [ ] **Step 1: Create the unenrollment script**

```powershell
# scripts/unenroll.ps1
<#
.SYNOPSIS
    Removes Az-Stamper enrollment from a subscription.

.DESCRIPTION
    Deletes the Event Grid system topic and RBAC role assignments
    created by the Az-Stamper enrollment template (enroll.bicep).

.PARAMETER SubscriptionId
    The Azure subscription ID to unenroll.

.PARAMETER FunctionAppPrincipalId
    The managed identity principal ID of the Az-Stamper function app.

.PARAMETER SystemTopicName
    Name of the Event Grid system topic. Defaults to 'evgt-az-stamper'.

.PARAMETER ResourceGroupName
    Resource group containing the Event Grid system topic.

.PARAMETER WhatIf
    Show what would be removed without making changes.

.EXAMPLE
    ./unenroll.ps1 -SubscriptionId "00000000-0000-0000-0000-000000000000" `
                   -FunctionAppPrincipalId "11111111-1111-1111-1111-111111111111" `
                   -ResourceGroupName "rg-eventgrid"
#>
[CmdletBinding(SupportsShouldProcess)]
param(
    [Parameter(Mandatory)]
    [ValidatePattern('^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$')]
    [string]$SubscriptionId,

    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string]$FunctionAppPrincipalId,

    [Parameter(Mandatory)]
    [ValidateNotNullOrEmpty()]
    [string]$ResourceGroupName,

    [Parameter()]
    [string]$SystemTopicName = 'evgt-az-stamper'
)

$ErrorActionPreference = 'Stop'

Write-Host "Az-Stamper Unenrollment" -ForegroundColor Cyan
Write-Host "Subscription: $SubscriptionId"
Write-Host "System Topic: $SystemTopicName"
Write-Host "Resource Group: $ResourceGroupName"
Write-Host ""

# Set subscription context
az account set --subscription $SubscriptionId
if ($LASTEXITCODE -ne 0) {
    Write-Error "Failed to set subscription context. Ensure you are logged in with 'az login'."
    return
}

# Delete Event Grid system topic (cascades to event subscription)
Write-Host "Removing Event Grid system topic '$SystemTopicName'..." -ForegroundColor Yellow
if ($PSCmdlet.ShouldProcess("System topic '$SystemTopicName' in resource group '$ResourceGroupName'", "Delete")) {
    az eventgrid system-topic delete `
        --name $SystemTopicName `
        --resource-group $ResourceGroupName `
        --yes 2>$null

    if ($LASTEXITCODE -eq 0) {
        Write-Host "  Deleted system topic." -ForegroundColor Green
    }
    else {
        Write-Warning "  System topic not found or already deleted."
    }
}

# Remove RBAC role assignments
$scope = "/subscriptions/$SubscriptionId"
$roleIds = @(
    'acdd72a7-3385-48ef-bd42-f606fba81ae7'  # Reader
    '4a9ae827-6dc8-4573-8ac7-8239d42aa03f'  # Tag Contributor
)

foreach ($roleId in $roleIds) {
    $roleName = if ($roleId -eq 'acdd72a7-3385-48ef-bd42-f606fba81ae7') { 'Reader' } else { 'Tag Contributor' }
    Write-Host "Removing '$roleName' role assignment..." -ForegroundColor Yellow

    if ($PSCmdlet.ShouldProcess("$roleName role for principal $FunctionAppPrincipalId on $scope", "Delete")) {
        az role assignment delete `
            --assignee $FunctionAppPrincipalId `
            --role $roleId `
            --scope $scope 2>$null

        if ($LASTEXITCODE -eq 0) {
            Write-Host "  Removed $roleName role." -ForegroundColor Green
        }
        else {
            Write-Warning "  $roleName role assignment not found or already removed."
        }
    }
}

Write-Host ""
Write-Host "Unenrollment complete." -ForegroundColor Green
```

- [ ] **Step 2: Verify script syntax**

Run: `pwsh -NoProfile -Command "Get-Command ./scripts/unenroll.ps1 | Select-Object -Property Name"`
Expected: Returns script name without syntax errors

- [ ] **Step 3: Commit**

```bash
git add scripts/unenroll.ps1
git commit -m "feat: add unenroll.ps1 spoke removal script

PowerShell script to remove Az-Stamper enrollment from a subscription.
Deletes Event Grid system topic and RBAC role assignments. Supports
-WhatIf for dry-run validation."
```

---

### Task 10: Add JSON Schema for Config Validation

**Files:**
- Create: `stamper.schema.json`

- [ ] **Step 1: Create the JSON Schema**

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://raw.githubusercontent.com/Galvnyz/Az-Stamper/main/stamper.schema.json",
  "title": "Az-Stamper Subscription Configuration",
  "description": "Per-subscription tag overrides and resource-type rules for Az-Stamper multi-subscription deployments.",
  "type": "object",
  "properties": {
    "subscriptions": {
      "type": "object",
      "description": "Map of subscription IDs to their configuration.",
      "additionalProperties": {
        "$ref": "#/$defs/subscriptionConfig"
      }
    }
  },
  "required": ["subscriptions"],
  "$defs": {
    "subscriptionConfig": {
      "type": "object",
      "properties": {
        "displayName": {
          "type": "string",
          "description": "Human-readable name for this subscription."
        },
        "enabled": {
          "type": "boolean",
          "default": true,
          "description": "Whether tagging is enabled for this subscription. Set to false to skip all events."
        },
        "tagOverrides": {
          "type": "object",
          "description": "Tags to add or override on top of global defaults.",
          "additionalProperties": {
            "$ref": "#/$defs/tagEntry"
          }
        },
        "resourceTypeRules": {
          "type": "object",
          "description": "Per-resource-type tag rules. Keys are Azure resource type strings (e.g., Microsoft.Compute/virtualMachines).",
          "additionalProperties": {
            "$ref": "#/$defs/resourceTypeRule"
          }
        },
        "additionalIgnorePatterns": {
          "type": "array",
          "description": "Additional resource ID patterns to ignore (combined with global ignore list).",
          "items": {
            "type": "string"
          }
        }
      }
    },
    "tagEntry": {
      "type": "object",
      "properties": {
        "value": {
          "type": "string",
          "description": "Tag value. Supports templates: {caller}, {timestamp}, {principalType}."
        },
        "overwrite": {
          "type": "boolean",
          "default": false,
          "description": "Whether to overwrite an existing tag with the same name."
        }
      },
      "required": ["value"]
    },
    "resourceTypeRule": {
      "type": "object",
      "properties": {
        "additionalTags": {
          "type": "object",
          "description": "Tags to add only for this resource type.",
          "additionalProperties": {
            "$ref": "#/$defs/tagEntry"
          }
        },
        "excludeTags": {
          "type": "array",
          "description": "Tag names to exclude from this resource type.",
          "items": {
            "type": "string"
          }
        }
      }
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add stamper.schema.json
git commit -m "feat: add stamper.schema.json for config validation

JSON Schema for the stamper.json subscription config file. Provides
IDE autocomplete and validation for per-subscription tag overrides
and resource-type rules."
```

---

### Task 11: Add Structured Logging with Custom Dimensions

**Files:**
- Modify: `src/AzStamper.Core/StampOrchestrator.cs`

- [ ] **Step 1: Add structured logging with custom dimensions**

Edit `src/AzStamper.Core/StampOrchestrator.cs` — replace the existing log statements to include structured custom dimensions.

Replace the `_logger.LogInformation("Stamped {Count} tag(s)..."` success block (the `if (success)` block near the end of `ProcessAsync`) with:

```csharp
        if (success)
        {
            _logger.LogInformation(
                "Stamped {Count} tag(s) on {ResourceId} [Sub:{SubscriptionId}, Type:{ResourceType}, Config:{ConfigSource}]",
                tagsToApply.Count, evt.ResourceId, subscriptionId, resourceType, ruleSet.ConfigSource);
        }
        else
        {
            _logger.LogWarning(
                "Failed to stamp tags on {ResourceId} [Sub:{SubscriptionId}, Type:{ResourceType}]",
                evt.ResourceId, subscriptionId, resourceType);
        }
```

- [ ] **Step 2: Verify all tests still pass**

Run: `dotnet test tests/AzStamper.Core.Tests/ -v normal`
Expected: All tests PASS

- [ ] **Step 3: Commit**

```bash
git add src/AzStamper.Core/StampOrchestrator.cs
git commit -m "feat: add structured logging with subscription and resource-type dimensions

Log entries now include SubscriptionId, ResourceType, and ConfigSource
as structured properties for Application Insights custom dimensions."
```

---

### Task 12: Documentation — Deploy-to-Azure and KQL Queries

**Files:**
- Modify: `README.md` (add enrollment section)

- [ ] **Step 1: Read current README.md**

Read `README.md` to find the right insertion point for the enrollment section.

- [ ] **Step 2: Add multi-subscription enrollment section to README**

Add a new section after the existing deployment section in `README.md`. The exact insertion point depends on the current structure, but it should include:

```markdown
## Multi-Subscription Enrollment

Az-Stamper supports monitoring multiple subscriptions from a single centralized function app.

### Enroll a Subscription

Click the button below to deploy the Event Grid and RBAC resources to your subscription:

[![Deploy to Azure](https://aka.ms/deploytoazurebutton)](https://portal.azure.com/#create/Microsoft.Template/uri/https%3A%2F%2Fraw.githubusercontent.com%2FGalvnyz%2FAz-Stamper%2Fmain%2Finfra%2Fenroll.json)

**Required parameters:**
- **functionAppResourceId** — The full resource ID of the Az-Stamper function app (from hub deployment outputs)
- **functionAppPrincipalId** — The managed identity principal ID (from hub deployment outputs)
- **eventGridResourceGroupName** — A resource group in the target subscription for Event Grid resources

### Unenroll a Subscription

```bash
pwsh scripts/unenroll.ps1 \
  -SubscriptionId "<subscription-id>" \
  -FunctionAppPrincipalId "<principal-id>" \
  -ResourceGroupName "<resource-group>"
```

### Per-Subscription Tag Overrides (Optional)

Upload a `stamper.json` file to the `config` container in the hub storage account:

```json
{
  "$schema": "https://raw.githubusercontent.com/Galvnyz/Az-Stamper/main/stamper.schema.json",
  "subscriptions": {
    "<subscription-id>": {
      "displayName": "Production",
      "enabled": true,
      "tagOverrides": {
        "Environment": { "value": "Production", "overwrite": false }
      }
    }
  }
}
```

Subscriptions not listed in `stamper.json` automatically receive global default tags.

### Monitoring Enrolled Subscriptions

Use these KQL queries in Application Insights → Logs:

```kql
// Active subscriptions (last 24h)
traces
| where timestamp > ago(24h)
| extend SubscriptionId = tostring(customDimensions.SubscriptionId)
| where isnotempty(SubscriptionId)
| summarize EventCount=count() by SubscriptionId
| order by EventCount desc

// Tag success/failure rate
traces
| where timestamp > ago(7d)
| extend Outcome = tostring(customDimensions.Outcome)
| summarize
    Tagged=countif(message contains "Stamped"),
    Skipped=countif(message contains "skipping"),
    Errors=countif(message contains "Failed")
  by bin(timestamp, 1d)
```
```

- [ ] **Step 3: Generate the ARM template from enroll.bicep**

Run: `az bicep build --file infra/enroll.bicep --outfile infra/enroll.json`
Expected: `infra/enroll.json` created (needed for Deploy-to-Azure button)

- [ ] **Step 4: Commit**

```bash
git add README.md infra/enroll.json
git commit -m "docs: add multi-subscription enrollment guide with Deploy-to-Azure button

Adds enrollment/unenrollment instructions, per-subscription config
examples, and KQL monitoring queries to README. Includes compiled
ARM template for Deploy-to-Azure button."
```

---

### Task 13: Create GitHub Milestone and Issues

- [ ] **Step 1: Create Sprint 2 milestone**

```bash
gh api repos/Galvnyz/Az-Stamper/milestones -f title="Sprint 2 - Multi-Subscription" -f description="Hub-and-spoke multi-subscription support with Deploy-to-Azure enrollment, per-subscription config overrides, and resource-type filtering." -f state="open"
```

- [ ] **Step 2: Create issues for Sprint 2**

Create these issues and assign them to the Sprint 2 milestone. Use the milestone number returned from Step 1.

```bash
gh issue create --repo Galvnyz/Az-Stamper --title "feat: add subscription config model and resolution logic" --body "Add SubscriptionConfig, ResourceTypeRule, StamperRuleSet models and ConfigResolver service. See spec: docs/superpowers/specs/2026-03-28-multi-subscription-design.md" --label "enhancement" --milestone "Sprint 2 - Multi-Subscription"

gh issue create --repo Galvnyz/Az-Stamper --title "feat: implement BlobSubscriptionConfigProvider with caching" --body "Read stamper.json from blob storage with in-memory caching and configurable TTL. Falls back to global defaults when blob missing." --label "enhancement" --milestone "Sprint 2 - Multi-Subscription"

gh issue create --repo Galvnyz/Az-Stamper --title "feat: update StampOrchestrator for per-subscription config" --body "Refactor StampOrchestrator to accept ConfigResolver and ISubscriptionConfigProvider. Resolve per-event config by subscription ID." --label "enhancement" --milestone "Sprint 2 - Multi-Subscription"

gh issue create --repo Galvnyz/Az-Stamper --title "feat: create enroll.bicep spoke enrollment template" --body "Subscription-scoped Bicep template with Event Grid System Topic, Event Subscription, and RBAC for Deploy-to-Azure button." --label "enhancement,infra" --milestone "Sprint 2 - Multi-Subscription"

gh issue create --repo Galvnyz/Az-Stamper --title "feat: create unenroll.ps1 spoke removal script" --body "PowerShell script to remove Event Grid and RBAC when unenrolling a subscription. Supports -WhatIf." --label "enhancement" --milestone "Sprint 2 - Multi-Subscription"

gh issue create --repo Galvnyz/Az-Stamper --title "feat: add Deploy-to-Azure button and enrollment docs" --body "Add multi-subscription section to README with Deploy-to-Azure button, config examples, and KQL monitoring queries." --label "enhancement,documentation" --milestone "Sprint 2 - Multi-Subscription"

gh issue create --repo Galvnyz/Az-Stamper --title "feat: add structured logging with subscription dimensions" --body "Add SubscriptionId, ResourceType, and ConfigSource as structured log properties for Application Insights." --label "enhancement" --milestone "Sprint 2 - Multi-Subscription"

gh issue create --repo Galvnyz/Az-Stamper --title "docs: provide KQL query templates for monitoring" --body "Ready-made KQL queries for active subscriptions, tag success/failure rates, and resource-type breakdowns." --label "documentation" --milestone "Sprint 2 - Multi-Subscription"

gh issue create --repo Galvnyz/Az-Stamper --title "feat: add stamper.schema.json for config validation" --body "JSON Schema for stamper.json with IDE autocomplete support." --label "enhancement" --milestone "Sprint 2 - Multi-Subscription"

gh issue create --repo Galvnyz/Az-Stamper --title "chore: update main.bicep for config container and enrollment outputs" --body "Add config blob container to storage module and ConfigBlobUri app setting to function app." --label "infra" --milestone "Sprint 2 - Multi-Subscription"
```

- [ ] **Step 3: Create future milestone placeholders**

```bash
gh api repos/Galvnyz/Az-Stamper/milestones -f title="Sprint 3 - Management & Observability" -f description="Azure Workbook dashboard, config management CLI tool." -f state="open"

gh api repos/Galvnyz/Az-Stamper/milestones -f title="Sprint 4 - Marketplace Preparation" -f description="createUiDefinition.json, managed app packaging, Microsoft Partner registration, pricing model." -f state="open"
```

- [ ] **Step 4: Commit plan document**

```bash
git add docs/superpowers/plans/2026-03-28-multi-subscription-implementation.md
git commit -m "docs: add multi-subscription implementation plan

Task-by-task TDD implementation plan for hub-and-spoke multi-subscription
support. 13 tasks covering models, config resolution, blob provider,
orchestrator refactor, infra templates, and documentation."
```

---

## Verification Checklist

After all tasks are complete:

- [ ] `dotnet build Az-Stamper.sln` — all projects compile
- [ ] `dotnet test Az-Stamper.sln` — all tests pass (existing + ~20 new)
- [ ] `dotnet format Az-Stamper.sln --verify-no-changes` — no formatting violations
- [ ] `az bicep build --file infra/main.bicep` — hub template validates
- [ ] `az bicep build --file infra/enroll.bicep` — enrollment template validates
- [ ] `pwsh -NoProfile -Command "Get-Help ./scripts/unenroll.ps1"` — script help renders
- [ ] Deploy-to-Azure button URL renders in README
- [ ] JSON Schema validates a sample `stamper.json` file
