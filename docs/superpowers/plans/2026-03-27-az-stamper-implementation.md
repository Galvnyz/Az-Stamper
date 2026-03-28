# Az-Stamper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a C# Azure Function that automatically stamps Azure resources with configurable metadata tags via Event Grid triggers.

**Architecture:** Two-project solution — `AzStamper.Core` (pure business logic behind interfaces) and `AzStamper.Functions` (thin Azure Functions adapter). Bicep modules for infrastructure. xUnit + Moq for testing.

**Tech Stack:** .NET 8 LTS, Azure Functions v4 isolated worker, Flex Consumption plan, Azure.ResourceManager SDK, Microsoft.Graph SDK, Bicep, xUnit, Moq, GitHub Actions

**Spec:** `docs/superpowers/specs/2026-03-27-az-stamper-design.md`

---

## File Map

### Source
| File | Responsibility |
|------|---------------|
| `Az-Stamper.sln` | Solution file linking all projects |
| `src/AzStamper.Core/AzStamper.Core.csproj` | Core library project (Azure.ResourceManager, Microsoft.Graph, ILogger) |
| `src/AzStamper.Core/Models/StamperConfig.cs` | Configuration POCO: tag map + ignore patterns |
| `src/AzStamper.Core/Models/TagEntry.cs` | Single tag definition: value template + overwrite flag |
| `src/AzStamper.Core/Models/ResourceEvent.cs` | Simplified event model extracted from Event Grid payload |
| `src/AzStamper.Core/Services/ICallerResolver.cs` | Interface for resolving principalId → display name |
| `src/AzStamper.Core/Services/CallerResolver.cs` | Graph API implementation of ICallerResolver |
| `src/AzStamper.Core/Services/ITagService.cs` | Interface for reading/writing resource tags |
| `src/AzStamper.Core/Services/TagService.cs` | Azure.ResourceManager implementation of ITagService |
| `src/AzStamper.Core/StampOrchestrator.cs` | Core logic: resolve caller → check ignore list → stamp tags |
| `src/AzStamper.Functions/AzStamper.Functions.csproj` | Functions project (isolated worker + EventGrid extension) |
| `src/AzStamper.Functions/Program.cs` | Host builder, DI registration, config binding |
| `src/AzStamper.Functions/Functions/ResourceStamperFunction.cs` | Event Grid trigger function |
| `src/AzStamper.Functions/host.json` | Functions host config |
| `src/AzStamper.Functions/local.settings.json` | Local dev settings with StamperConfig |

### Tests
| File | Responsibility |
|------|---------------|
| `tests/AzStamper.Core.Tests/AzStamper.Core.Tests.csproj` | Test project (xUnit, Moq) |
| `tests/AzStamper.Core.Tests/StampOrchestratorTests.cs` | Orchestrator logic tests |
| `tests/AzStamper.Core.Tests/CallerResolverTests.cs` | Identity resolution tests |
| `tests/AzStamper.Core.Tests/TagServiceTests.cs` | Tag operation tests |

### Infrastructure
| File | Responsibility |
|------|---------------|
| `infra/main.bicep` | Resource group-scoped orchestrator |
| `infra/main.sub.bicep` | Subscription-scoped deployment (Event Grid) |
| `infra/modules/storage.bicep` | Storage account + MI role assignments |
| `infra/modules/monitoring.bicep` | Log Analytics + App Insights |
| `infra/modules/functionApp.bicep` | Flex Consumption function app + MI + app settings |
| `infra/modules/eventGrid.bicep` | System topic + event subscription |
| `infra/parameters/dev.bicepparam` | Dev environment parameters |
| `infra/parameters/prod.bicepparam` | Prod environment parameters |

### CI/CD & Repo
| File | Responsibility |
|------|---------------|
| `.github/workflows/ci.yml` | Build, test, lint, Bicep validate |
| `.github/workflows/deploy.yml` | Deploy to Azure (workflow_dispatch + auto-dev) |
| `.github/dependabot.yml` | NuGet + Actions weekly updates |
| `.gitignore` | .NET + Azure Functions ignores |
| `CLAUDE.md` | AI and developer conventions |
| `README.md` | Project docs, setup, architecture |

---

## Task 1: Solution Scaffold & Project Structure

**Files:**
- Create: `Az-Stamper.sln`
- Create: `src/AzStamper.Core/AzStamper.Core.csproj`
- Create: `src/AzStamper.Functions/AzStamper.Functions.csproj`
- Create: `tests/AzStamper.Core.Tests/AzStamper.Core.Tests.csproj`
- Create: `.gitignore`

- [ ] **Step 1: Create solution and Core project**

```bash
cd C:/git/Az-Stamper
dotnet new sln --name Az-Stamper
dotnet new classlib -n AzStamper.Core -o src/AzStamper.Core -f net8.0
dotnet sln add src/AzStamper.Core/AzStamper.Core.csproj
```

- [ ] **Step 2: Create Functions project**

```bash
dotnet new worker -n AzStamper.Functions -o src/AzStamper.Functions -f net8.0
dotnet sln add src/AzStamper.Functions/AzStamper.Functions.csproj
```

- [ ] **Step 3: Create test project**

```bash
dotnet new xunit -n AzStamper.Core.Tests -o tests/AzStamper.Core.Tests -f net8.0
dotnet sln add tests/AzStamper.Core.Tests/AzStamper.Core.Tests.csproj
```

- [ ] **Step 4: Add project references**

```bash
dotnet add src/AzStamper.Functions/AzStamper.Functions.csproj reference src/AzStamper.Core/AzStamper.Core.csproj
dotnet add tests/AzStamper.Core.Tests/AzStamper.Core.Tests.csproj reference src/AzStamper.Core/AzStamper.Core.csproj
```

- [ ] **Step 5: Add NuGet packages to Core**

```bash
cd C:/git/Az-Stamper
dotnet add src/AzStamper.Core/AzStamper.Core.csproj package Azure.ResourceManager
dotnet add src/AzStamper.Core/AzStamper.Core.csproj package Azure.ResourceManager.Resources
dotnet add src/AzStamper.Core/AzStamper.Core.csproj package Azure.Identity
dotnet add src/AzStamper.Core/AzStamper.Core.csproj package Microsoft.Graph
dotnet add src/AzStamper.Core/AzStamper.Core.csproj package Microsoft.Extensions.Logging.Abstractions
dotnet add src/AzStamper.Core/AzStamper.Core.csproj package Microsoft.Extensions.Options
```

- [ ] **Step 6: Add NuGet packages to Functions**

```bash
dotnet add src/AzStamper.Functions/AzStamper.Functions.csproj package Microsoft.Azure.Functions.Worker
dotnet add src/AzStamper.Functions/AzStamper.Functions.csproj package Microsoft.Azure.Functions.Worker.Sdk
dotnet add src/AzStamper.Functions/AzStamper.Functions.csproj package Microsoft.Azure.Functions.Worker.Extensions.EventGrid
dotnet add src/AzStamper.Functions/AzStamper.Functions.csproj package Microsoft.Extensions.Options
```

- [ ] **Step 7: Add Moq to test project**

```bash
dotnet add tests/AzStamper.Core.Tests/AzStamper.Core.Tests.csproj package Moq
```

- [ ] **Step 8: Add .gitignore**

Create `.gitignore` at repo root:

```
bin/
obj/
*.user
*.suo
.vs/
*.zip
local.settings.json
.azure/
.claude/
```

- [ ] **Step 9: Clean up template files**

Delete auto-generated template files that we'll replace:
- `src/AzStamper.Core/Class1.cs`
- `src/AzStamper.Functions/Program.cs` (will rewrite)
- `tests/AzStamper.Core.Tests/UnitTest1.cs`

- [ ] **Step 10: Verify build**

```bash
dotnet build Az-Stamper.sln
```

Expected: Build succeeded with 0 errors.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "chore: scaffold solution with Core, Functions, and Tests projects"
```

---

## Task 2: Configuration Models

**Files:**
- Create: `src/AzStamper.Core/Models/StamperConfig.cs`
- Create: `src/AzStamper.Core/Models/TagEntry.cs`
- Create: `src/AzStamper.Core/Models/ResourceEvent.cs`

- [ ] **Step 1: Create TagEntry model**

Create `src/AzStamper.Core/Models/TagEntry.cs`:

```csharp
namespace AzStamper.Core.Models;

public class TagEntry
{
    public string Value { get; set; } = string.Empty;
    public bool Overwrite { get; set; } = false;
}
```

- [ ] **Step 2: Create StamperConfig model**

Create `src/AzStamper.Core/Models/StamperConfig.cs`:

```csharp
namespace AzStamper.Core.Models;

public class StamperConfig
{
    public Dictionary<string, TagEntry> TagMap { get; set; } = new();
    public List<string> IgnorePatterns { get; set; } = new();
}
```

- [ ] **Step 3: Create ResourceEvent model**

Create `src/AzStamper.Core/Models/ResourceEvent.cs`:

```csharp
namespace AzStamper.Core.Models;

public class ResourceEvent
{
    public string? ResourceId { get; set; }
    public string? Caller { get; set; }
    public string? PrincipalType { get; set; }
    public string? PrincipalId { get; set; }
}
```

- [ ] **Step 4: Verify build**

```bash
dotnet build Az-Stamper.sln
```

Expected: Build succeeded.

- [ ] **Step 5: Commit**

```bash
git add src/AzStamper.Core/Models/
git commit -m "feat: add configuration and event models"
```

---

## Task 3: CallerResolver — Interface, Tests, Implementation

**Files:**
- Create: `src/AzStamper.Core/Services/ICallerResolver.cs`
- Create: `tests/AzStamper.Core.Tests/CallerResolverTests.cs`
- Create: `src/AzStamper.Core/Services/CallerResolver.cs`

- [ ] **Step 1: Create ICallerResolver interface**

Create `src/AzStamper.Core/Services/ICallerResolver.cs`:

```csharp
namespace AzStamper.Core.Services;

public interface ICallerResolver
{
    Task<string?> ResolveDisplayNameAsync(string principalId, CancellationToken cancellationToken = default);
}
```

- [ ] **Step 2: Write failing tests**

Create `tests/AzStamper.Core.Tests/CallerResolverTests.cs`:

```csharp
using AzStamper.Core.Services;
using Microsoft.Extensions.Logging;
using Microsoft.Graph;
using Microsoft.Graph.Models;
using Moq;

namespace AzStamper.Core.Tests;

public class CallerResolverTests
{
    private readonly Mock<GraphServiceClient> _graphClientMock;
    private readonly Mock<ILogger<CallerResolver>> _loggerMock;
    private readonly CallerResolver _sut;

    public CallerResolverTests()
    {
        _graphClientMock = new Mock<GraphServiceClient>(MockBehavior.Strict, (Azure.Core.TokenCredential)null!, null);
        _loggerMock = new Mock<ILogger<CallerResolver>>();
        _sut = new CallerResolver(_graphClientMock.Object, _loggerMock.Object);
    }

    [Fact]
    public async Task ResolveDisplayNameAsync_ReturnsDisplayName_WhenServicePrincipalFound()
    {
        var sp = new ServicePrincipal { DisplayName = "MyApp" };
        _graphClientMock
            .Setup(c => c.ServicePrincipals[It.IsAny<string>()]
                .GetAsync(It.IsAny<Action<Microsoft.Graph.ServicePrincipals.Item.ServicePrincipalItemRequestBuilder.ServicePrincipalItemRequestBuilderGetRequestConfiguration>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(sp);

        var result = await _sut.ResolveDisplayNameAsync("sp-id-123");

        Assert.Equal("MyApp", result);
    }

    [Fact]
    public async Task ResolveDisplayNameAsync_ReturnsNull_WhenServicePrincipalNotFound()
    {
        _graphClientMock
            .Setup(c => c.ServicePrincipals[It.IsAny<string>()]
                .GetAsync(It.IsAny<Action<Microsoft.Graph.ServicePrincipals.Item.ServicePrincipalItemRequestBuilder.ServicePrincipalItemRequestBuilderGetRequestConfiguration>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((ServicePrincipal?)null);

        var result = await _sut.ResolveDisplayNameAsync("sp-id-456");

        Assert.Null(result);
    }

    [Fact]
    public async Task ResolveDisplayNameAsync_ReturnsNull_WhenExceptionThrown()
    {
        _graphClientMock
            .Setup(c => c.ServicePrincipals[It.IsAny<string>()]
                .GetAsync(It.IsAny<Action<Microsoft.Graph.ServicePrincipals.Item.ServicePrincipalItemRequestBuilder.ServicePrincipalItemRequestBuilderGetRequestConfiguration>>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new Exception("Access denied"));

        var result = await _sut.ResolveDisplayNameAsync("sp-id-789");

        Assert.Null(result);
    }
}
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
dotnet test tests/AzStamper.Core.Tests --filter "FullyQualifiedName~CallerResolverTests" -v n
```

Expected: FAIL — `CallerResolver` class does not exist.

- [ ] **Step 4: Implement CallerResolver**

Create `src/AzStamper.Core/Services/CallerResolver.cs`:

```csharp
using Microsoft.Extensions.Logging;
using Microsoft.Graph;

namespace AzStamper.Core.Services;

public class CallerResolver : ICallerResolver
{
    private readonly GraphServiceClient _graphClient;
    private readonly ILogger<CallerResolver> _logger;

    public CallerResolver(GraphServiceClient graphClient, ILogger<CallerResolver> logger)
    {
        _graphClient = graphClient;
        _logger = logger;
    }

    public async Task<string?> ResolveDisplayNameAsync(string principalId, CancellationToken cancellationToken = default)
    {
        try
        {
            var sp = await _graphClient.ServicePrincipals[principalId]
                .GetAsync(cancellationToken: cancellationToken);
            return sp?.DisplayName;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to resolve display name for principal {PrincipalId}", principalId);
            return null;
        }
    }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
dotnet test tests/AzStamper.Core.Tests --filter "FullyQualifiedName~CallerResolverTests" -v n
```

Expected: 3 tests passed. Note: The Graph SDK mock setup may need adjustment based on the actual SDK version's method signatures. If tests fail due to mock setup, adjust the mock to match the SDK's actual interface. The key behavior being tested is: returns DisplayName when found, returns null when not found, returns null on exception.

- [ ] **Step 6: Commit**

```bash
git add src/AzStamper.Core/Services/ICallerResolver.cs src/AzStamper.Core/Services/CallerResolver.cs tests/AzStamper.Core.Tests/CallerResolverTests.cs
git commit -m "feat: add CallerResolver with Graph API SP lookup and tests"
```

---

## Task 4: TagService — Interface, Tests, Implementation

**Files:**
- Create: `src/AzStamper.Core/Services/ITagService.cs`
- Create: `tests/AzStamper.Core.Tests/TagServiceTests.cs`
- Create: `src/AzStamper.Core/Services/TagService.cs`

- [ ] **Step 1: Create ITagService interface**

Create `src/AzStamper.Core/Services/ITagService.cs`:

```csharp
namespace AzStamper.Core.Services;

public interface ITagService
{
    Task<Dictionary<string, string>?> GetTagsAsync(string resourceId, CancellationToken cancellationToken = default);
    Task<bool> SetTagsAsync(string resourceId, Dictionary<string, string> tags, CancellationToken cancellationToken = default);
}
```

- [ ] **Step 2: Write failing tests**

Create `tests/AzStamper.Core.Tests/TagServiceTests.cs`:

```csharp
using AzStamper.Core.Services;
using Azure;
using Azure.ResourceManager;
using Azure.ResourceManager.Resources;
using Microsoft.Extensions.Logging;
using Moq;

namespace AzStamper.Core.Tests;

public class TagServiceTests
{
    private readonly Mock<ArmClient> _armClientMock;
    private readonly Mock<ILogger<TagService>> _loggerMock;
    private readonly TagService _sut;

    public TagServiceTests()
    {
        _armClientMock = new Mock<ArmClient>();
        _loggerMock = new Mock<ILogger<TagService>>();
        _sut = new TagService(_armClientMock.Object, _loggerMock.Object);
    }

    [Fact]
    public async Task GetTagsAsync_ReturnsNull_WhenExceptionThrown()
    {
        _armClientMock
            .Setup(c => c.GetTagResource(It.IsAny<Azure.Core.ResourceIdentifier>()))
            .Throws(new RequestFailedException("Not found"));

        var result = await _sut.GetTagsAsync("/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm1");

        Assert.Null(result);
    }

    [Fact]
    public async Task SetTagsAsync_ReturnsFalse_WhenExceptionThrown()
    {
        _armClientMock
            .Setup(c => c.GetTagResource(It.IsAny<Azure.Core.ResourceIdentifier>()))
            .Throws(new RequestFailedException("Forbidden"));

        var result = await _sut.SetTagsAsync(
            "/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm1",
            new Dictionary<string, string> { { "Creator", "test@contoso.com" } });

        Assert.False(result);
    }
}
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
dotnet test tests/AzStamper.Core.Tests --filter "FullyQualifiedName~TagServiceTests" -v n
```

Expected: FAIL — `TagService` class does not exist.

- [ ] **Step 4: Implement TagService**

Create `src/AzStamper.Core/Services/TagService.cs`:

```csharp
using Azure;
using Azure.ResourceManager;
using Azure.ResourceManager.Resources;
using Microsoft.Extensions.Logging;

namespace AzStamper.Core.Services;

public class TagService : ITagService
{
    private readonly ArmClient _armClient;
    private readonly ILogger<TagService> _logger;

    public TagService(ArmClient armClient, ILogger<TagService> logger)
    {
        _armClient = armClient;
        _logger = logger;
    }

    public async Task<Dictionary<string, string>?> GetTagsAsync(string resourceId, CancellationToken cancellationToken = default)
    {
        try
        {
            var tagResourceId = TagResource.CreateResourceIdentifier(resourceId);
            var tagResource = _armClient.GetTagResource(tagResourceId);
            var response = await tagResource.GetAsync(cancellationToken);
            return response.Value.Data.Properties.TagValues
                .ToDictionary(kvp => kvp.Key, kvp => kvp.Value);
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
            var tagResourceId = TagResource.CreateResourceIdentifier(resourceId);
            var tagResource = _armClient.GetTagResource(tagResourceId);
            var tagPatchable = new TagPatchResource();
            tagPatchable.Operation = TagPatchResourceOperation.Merge;
            foreach (var (key, value) in tags)
            {
                tagPatchable.Properties.TagValues[key] = value;
            }
            await tagResource.UpdateAsync(tagPatchable, cancellationToken);
            return true;
        }
        catch (RequestFailedException ex)
        {
            _logger.LogWarning(ex, "Failed to write tags to {ResourceId}", resourceId);
            return false;
        }
    }
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
dotnet test tests/AzStamper.Core.Tests --filter "FullyQualifiedName~TagServiceTests" -v n
```

Expected: 2 tests passed. Note: ArmClient mocking can be tricky — if mock setup fails, consider wrapping ArmClient behind a thin adapter. The important behavior is: returns null/false on exceptions.

- [ ] **Step 6: Commit**

```bash
git add src/AzStamper.Core/Services/ITagService.cs src/AzStamper.Core/Services/TagService.cs tests/AzStamper.Core.Tests/TagServiceTests.cs
git commit -m "feat: add TagService with ARM SDK tag read/write and tests"
```

---

## Task 5: StampOrchestrator — Tests and Implementation

**Files:**
- Create: `src/AzStamper.Core/StampOrchestrator.cs`
- Create: `tests/AzStamper.Core.Tests/StampOrchestratorTests.cs`

- [ ] **Step 1: Write failing tests**

Create `tests/AzStamper.Core.Tests/StampOrchestratorTests.cs`:

```csharp
using AzStamper.Core.Models;
using AzStamper.Core.Services;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Moq;

namespace AzStamper.Core.Tests;

public class StampOrchestratorTests
{
    private readonly Mock<ICallerResolver> _callerResolverMock;
    private readonly Mock<ITagService> _tagServiceMock;
    private readonly Mock<ILogger<StampOrchestrator>> _loggerMock;
    private readonly StamperConfig _config;
    private readonly StampOrchestrator _sut;

    public StampOrchestratorTests()
    {
        _callerResolverMock = new Mock<ICallerResolver>();
        _tagServiceMock = new Mock<ITagService>();
        _loggerMock = new Mock<ILogger<StampOrchestrator>>();
        _config = new StamperConfig
        {
            TagMap = new Dictionary<string, TagEntry>
            {
                ["Creator"] = new() { Value = "{caller}", Overwrite = false },
                ["CreatedOn"] = new() { Value = "{timestamp}", Overwrite = false },
                ["LastModifiedBy"] = new() { Value = "{caller}", Overwrite = true },
                ["StampedBy"] = new() { Value = "Az-Stamper", Overwrite = false }
            },
            IgnorePatterns = new List<string>
            {
                "Microsoft.Resources/deployments",
                "Microsoft.Resources/tags"
            }
        };
        _sut = new StampOrchestrator(
            _callerResolverMock.Object,
            _tagServiceMock.Object,
            Options.Create(_config),
            _loggerMock.Object);
    }

    [Fact]
    public async Task ProcessAsync_SkipsWhenResourceIdIsNull()
    {
        var evt = new ResourceEvent { ResourceId = null, Caller = "user@contoso.com" };

        await _sut.ProcessAsync(evt);

        _tagServiceMock.Verify(t => t.GetTagsAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task ProcessAsync_SkipsWhenResourceIdIsEmpty()
    {
        var evt = new ResourceEvent { ResourceId = "", Caller = "user@contoso.com" };

        await _sut.ProcessAsync(evt);

        _tagServiceMock.Verify(t => t.GetTagsAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task ProcessAsync_SkipsIgnoredResourceTypes()
    {
        var evt = new ResourceEvent
        {
            ResourceId = "/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Resources/deployments/deploy1",
            Caller = "user@contoso.com"
        };

        await _sut.ProcessAsync(evt);

        _tagServiceMock.Verify(t => t.GetTagsAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task ProcessAsync_UsesCallerDirectly_WhenCallerIsSet()
    {
        var evt = new ResourceEvent
        {
            ResourceId = "/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm1",
            Caller = "alice@contoso.com",
            PrincipalType = "User"
        };
        _tagServiceMock.Setup(t => t.GetTagsAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Dictionary<string, string>());
        _tagServiceMock.Setup(t => t.SetTagsAsync(It.IsAny<string>(), It.IsAny<Dictionary<string, string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(true);

        await _sut.ProcessAsync(evt);

        _tagServiceMock.Verify(t => t.SetTagsAsync(
            evt.ResourceId,
            It.Is<Dictionary<string, string>>(d => d["Creator"] == "alice@contoso.com"),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task ProcessAsync_ResolvesServicePrincipal_WhenCallerIsNull()
    {
        var evt = new ResourceEvent
        {
            ResourceId = "/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm1",
            Caller = null,
            PrincipalType = "ServicePrincipal",
            PrincipalId = "sp-id-123"
        };
        _callerResolverMock.Setup(r => r.ResolveDisplayNameAsync("sp-id-123", It.IsAny<CancellationToken>()))
            .ReturnsAsync("MyServiceApp");
        _tagServiceMock.Setup(t => t.GetTagsAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Dictionary<string, string>());
        _tagServiceMock.Setup(t => t.SetTagsAsync(It.IsAny<string>(), It.IsAny<Dictionary<string, string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(true);

        await _sut.ProcessAsync(evt);

        _tagServiceMock.Verify(t => t.SetTagsAsync(
            evt.ResourceId,
            It.Is<Dictionary<string, string>>(d => d["Creator"] == "MyServiceApp"),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task ProcessAsync_FallsBackToPrincipalId_WhenResolverReturnsNull()
    {
        var evt = new ResourceEvent
        {
            ResourceId = "/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm1",
            Caller = null,
            PrincipalType = "ServicePrincipal",
            PrincipalId = "sp-id-456"
        };
        _callerResolverMock.Setup(r => r.ResolveDisplayNameAsync("sp-id-456", It.IsAny<CancellationToken>()))
            .ReturnsAsync((string?)null);
        _tagServiceMock.Setup(t => t.GetTagsAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Dictionary<string, string>());
        _tagServiceMock.Setup(t => t.SetTagsAsync(It.IsAny<string>(), It.IsAny<Dictionary<string, string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(true);

        await _sut.ProcessAsync(evt);

        _tagServiceMock.Verify(t => t.SetTagsAsync(
            evt.ResourceId,
            It.Is<Dictionary<string, string>>(d => d["Creator"] == "sp-id-456"),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task ProcessAsync_SkipsWhenCallerCannotBeResolved()
    {
        var evt = new ResourceEvent
        {
            ResourceId = "/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm1",
            Caller = null,
            PrincipalType = null,
            PrincipalId = null
        };

        await _sut.ProcessAsync(evt);

        _tagServiceMock.Verify(t => t.SetTagsAsync(It.IsAny<string>(), It.IsAny<Dictionary<string, string>>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task ProcessAsync_DoesNotOverwrite_ExistingCreatorTag()
    {
        var evt = new ResourceEvent
        {
            ResourceId = "/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm1",
            Caller = "bob@contoso.com",
            PrincipalType = "User"
        };
        _tagServiceMock.Setup(t => t.GetTagsAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Dictionary<string, string> { { "Creator", "original@contoso.com" } });
        _tagServiceMock.Setup(t => t.SetTagsAsync(It.IsAny<string>(), It.IsAny<Dictionary<string, string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(true);

        await _sut.ProcessAsync(evt);

        _tagServiceMock.Verify(t => t.SetTagsAsync(
            evt.ResourceId,
            It.Is<Dictionary<string, string>>(d => !d.ContainsKey("Creator") && d["LastModifiedBy"] == "bob@contoso.com"),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task ProcessAsync_OverwritesLastModifiedBy_WhenOverwriteIsTrue()
    {
        var evt = new ResourceEvent
        {
            ResourceId = "/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm1",
            Caller = "carol@contoso.com",
            PrincipalType = "User"
        };
        _tagServiceMock.Setup(t => t.GetTagsAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Dictionary<string, string> { { "LastModifiedBy", "previous@contoso.com" } });
        _tagServiceMock.Setup(t => t.SetTagsAsync(It.IsAny<string>(), It.IsAny<Dictionary<string, string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(true);

        await _sut.ProcessAsync(evt);

        _tagServiceMock.Verify(t => t.SetTagsAsync(
            evt.ResourceId,
            It.Is<Dictionary<string, string>>(d => d["LastModifiedBy"] == "carol@contoso.com"),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task ProcessAsync_ResolvesTimestampVariable()
    {
        var evt = new ResourceEvent
        {
            ResourceId = "/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm1",
            Caller = "user@contoso.com",
            PrincipalType = "User"
        };
        _tagServiceMock.Setup(t => t.GetTagsAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Dictionary<string, string>());
        _tagServiceMock.Setup(t => t.SetTagsAsync(It.IsAny<string>(), It.IsAny<Dictionary<string, string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(true);

        await _sut.ProcessAsync(evt);

        _tagServiceMock.Verify(t => t.SetTagsAsync(
            evt.ResourceId,
            It.Is<Dictionary<string, string>>(d =>
                d.ContainsKey("CreatedOn") &&
                DateTime.TryParse(d["CreatedOn"], out _)),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task ProcessAsync_ResolvesStaticValue()
    {
        var evt = new ResourceEvent
        {
            ResourceId = "/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm1",
            Caller = "user@contoso.com",
            PrincipalType = "User"
        };
        _tagServiceMock.Setup(t => t.GetTagsAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(new Dictionary<string, string>());
        _tagServiceMock.Setup(t => t.SetTagsAsync(It.IsAny<string>(), It.IsAny<Dictionary<string, string>>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync(true);

        await _sut.ProcessAsync(evt);

        _tagServiceMock.Verify(t => t.SetTagsAsync(
            evt.ResourceId,
            It.Is<Dictionary<string, string>>(d => d["StampedBy"] == "Az-Stamper"),
            It.IsAny<CancellationToken>()), Times.Once);
    }

    [Fact]
    public async Task ProcessAsync_HandlesGetTagsFailure_Gracefully()
    {
        var evt = new ResourceEvent
        {
            ResourceId = "/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm1",
            Caller = "user@contoso.com"
        };
        _tagServiceMock.Setup(t => t.GetTagsAsync(It.IsAny<string>(), It.IsAny<CancellationToken>()))
            .ReturnsAsync((Dictionary<string, string>?)null);

        await _sut.ProcessAsync(evt);

        _tagServiceMock.Verify(t => t.SetTagsAsync(It.IsAny<string>(), It.IsAny<Dictionary<string, string>>(), It.IsAny<CancellationToken>()), Times.Never);
    }

    [Fact]
    public async Task ProcessAsync_SkipsWhenNoTagsToApply()
    {
        var emptyConfig = new StamperConfig { TagMap = new(), IgnorePatterns = new() };
        var sut = new StampOrchestrator(
            _callerResolverMock.Object,
            _tagServiceMock.Object,
            Options.Create(emptyConfig),
            _loggerMock.Object);

        var evt = new ResourceEvent
        {
            ResourceId = "/subscriptions/sub/resourceGroups/rg/providers/Microsoft.Compute/virtualMachines/vm1",
            Caller = "user@contoso.com"
        };

        await sut.ProcessAsync(evt);

        _tagServiceMock.Verify(t => t.SetTagsAsync(It.IsAny<string>(), It.IsAny<Dictionary<string, string>>(), It.IsAny<CancellationToken>()), Times.Never);
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
dotnet test tests/AzStamper.Core.Tests --filter "FullyQualifiedName~StampOrchestratorTests" -v n
```

Expected: FAIL — `StampOrchestrator` does not exist.

- [ ] **Step 3: Implement StampOrchestrator**

Create `src/AzStamper.Core/StampOrchestrator.cs`:

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
    private readonly StamperConfig _config;
    private readonly ILogger<StampOrchestrator> _logger;

    public StampOrchestrator(
        ICallerResolver callerResolver,
        ITagService tagService,
        IOptions<StamperConfig> config,
        ILogger<StampOrchestrator> logger)
    {
        _callerResolver = callerResolver;
        _tagService = tagService;
        _config = config.Value;
        _logger = logger;
    }

    public async Task ProcessAsync(ResourceEvent evt, CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrEmpty(evt.ResourceId))
        {
            _logger.LogWarning("Event has null or empty ResourceId — skipping");
            return;
        }

        // Check ignore list
        foreach (var pattern in _config.IgnorePatterns)
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

        _logger.LogInformation("Processing {ResourceId} — caller: {Caller}", evt.ResourceId, caller);

        if (_config.TagMap.Count == 0)
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

        foreach (var (key, entry) in _config.TagMap)
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

- [ ] **Step 4: Run all tests**

```bash
dotnet test tests/AzStamper.Core.Tests -v n
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/AzStamper.Core/StampOrchestrator.cs tests/AzStamper.Core.Tests/StampOrchestratorTests.cs
git commit -m "feat: add StampOrchestrator with template resolution and overwrite semantics"
```

---

## Task 6: Azure Functions Entry Point

**Files:**
- Create: `src/AzStamper.Functions/Program.cs`
- Create: `src/AzStamper.Functions/Functions/ResourceStamperFunction.cs`
- Create: `src/AzStamper.Functions/host.json`
- Create: `src/AzStamper.Functions/local.settings.json`

- [ ] **Step 1: Create Program.cs (host builder + DI)**

Create `src/AzStamper.Functions/Program.cs`:

```csharp
using Azure.Identity;
using Azure.ResourceManager;
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
builder.Services.AddSingleton<ICallerResolver, CallerResolver>();
builder.Services.AddSingleton<ITagService, TagService>();
builder.Services.AddSingleton<StampOrchestrator>();

builder.Build().Run();
```

- [ ] **Step 2: Create ResourceStamperFunction.cs**

Create `src/AzStamper.Functions/Functions/ResourceStamperFunction.cs`:

```csharp
using Azure.Messaging.EventGrid;
using AzStamper.Core;
using AzStamper.Core.Models;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Extensions.Logging;

namespace AzStamper.Functions.Functions;

public class ResourceStamperFunction
{
    private readonly StampOrchestrator _orchestrator;
    private readonly ILogger<ResourceStamperFunction> _logger;

    public ResourceStamperFunction(StampOrchestrator orchestrator, ILogger<ResourceStamperFunction> logger)
    {
        _orchestrator = orchestrator;
        _logger = logger;
    }

    [Function("ResourceStamper")]
    public async Task Run(
        [EventGridTrigger] EventGridEvent eventGridEvent,
        CancellationToken cancellationToken)
    {
        _logger.LogInformation("Event received: {Subject} ({EventType})", eventGridEvent.Subject, eventGridEvent.EventType);

        var data = eventGridEvent.Data?.ToObjectFromJson<Dictionary<string, object>>();
        if (data is null)
        {
            _logger.LogWarning("Event data is null — skipping");
            return;
        }

        var evt = new ResourceEvent
        {
            ResourceId = data.TryGetValue("resourceUri", out var uri) ? uri?.ToString() : null,
            PrincipalType = GetNestedValue(data, "authorization", "evidence", "principalType"),
            PrincipalId = GetNestedValue(data, "authorization", "evidence", "principalId"),
            Caller = GetClaimValue(data, "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/upn")
        };

        await _orchestrator.ProcessAsync(evt, cancellationToken);
    }

    private static string? GetNestedValue(Dictionary<string, object> data, params string[] keys)
    {
        object? current = data;
        foreach (var key in keys)
        {
            if (current is Dictionary<string, object> dict && dict.TryGetValue(key, out var next))
                current = next;
            else
                return null;
        }
        return current?.ToString();
    }

    private static string? GetClaimValue(Dictionary<string, object> data, string claimType)
    {
        if (data.TryGetValue("claims", out var claimsObj) &&
            claimsObj is Dictionary<string, object> claims &&
            claims.TryGetValue(claimType, out var value))
        {
            return value?.ToString();
        }
        return null;
    }
}
```

- [ ] **Step 3: Create host.json**

Create `src/AzStamper.Functions/host.json`:

```json
{
  "version": "2.0",
  "logging": {
    "applicationInsights": {
      "samplingSettings": {
        "isEnabled": true,
        "excludedTypes": "Request"
      },
      "enableLiveMetricsFilters": true
    },
    "logLevel": {
      "AzStamper": "Information",
      "Function": "Information",
      "Host.Results": "Information",
      "Host.Aggregator": "Warning"
    }
  }
}
```

- [ ] **Step 4: Create local.settings.json**

Create `src/AzStamper.Functions/local.settings.json`:

```json
{
  "IsEncrypted": false,
  "Values": {
    "AzureWebJobsStorage": "UseDevelopmentStorage=true",
    "FUNCTIONS_WORKER_RUNTIME": "dotnet-isolated",
    "StamperConfig__TagMap__Creator__Value": "{caller}",
    "StamperConfig__TagMap__Creator__Overwrite": "false",
    "StamperConfig__TagMap__CreatedOn__Value": "{timestamp}",
    "StamperConfig__TagMap__CreatedOn__Overwrite": "false",
    "StamperConfig__TagMap__LastModifiedBy__Value": "{caller}",
    "StamperConfig__TagMap__LastModifiedBy__Overwrite": "true",
    "StamperConfig__TagMap__LastModifiedOn__Value": "{timestamp}",
    "StamperConfig__TagMap__LastModifiedOn__Overwrite": "true",
    "StamperConfig__TagMap__StampedBy__Value": "Az-Stamper",
    "StamperConfig__TagMap__StampedBy__Overwrite": "false",
    "StamperConfig__IgnorePatterns__0": "Microsoft.Resources/deployments",
    "StamperConfig__IgnorePatterns__1": "Microsoft.Resources/tags",
    "StamperConfig__IgnorePatterns__2": "Microsoft.Network/frontdoor"
  }
}
```

- [ ] **Step 5: Verify build**

```bash
dotnet build Az-Stamper.sln
```

Expected: Build succeeded.

- [ ] **Step 6: Commit**

```bash
git add src/AzStamper.Functions/
git commit -m "feat: add Azure Functions entry point with Event Grid trigger and DI"
```

---

## Task 7: Bicep Infrastructure

**Files:**
- Create: `infra/modules/storage.bicep`
- Create: `infra/modules/monitoring.bicep`
- Create: `infra/modules/functionApp.bicep`
- Create: `infra/modules/eventGrid.bicep`
- Create: `infra/main.bicep`
- Create: `infra/main.sub.bicep`
- Create: `infra/parameters/dev.bicepparam`
- Create: `infra/parameters/prod.bicepparam`

- [ ] **Step 1: Create storage.bicep**

Create `infra/modules/storage.bicep`:

```bicep
param name string
param location string
param tags object
param functionAppPrincipalId string

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: name
  location: location
  tags: tags
  kind: 'StorageV2'
  sku: {
    name: 'Standard_LRS'
  }
  properties: {
    supportsHttpsTrafficOnly: true
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
  }
}

resource blobDataOwnerRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storageAccount.id, functionAppPrincipalId, 'b7e6dc6d-f1e8-4753-8033-0f276bb0955b')
  scope: storageAccount
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'b7e6dc6d-f1e8-4753-8033-0f276bb0955b')
    principalId: functionAppPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource storageContributorRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(storageAccount.id, functionAppPrincipalId, '17d1049b-9a84-46fb-8f53-869881c3d3ab')
  scope: storageAccount
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '17d1049b-9a84-46fb-8f53-869881c3d3ab')
    principalId: functionAppPrincipalId
    principalType: 'ServicePrincipal'
  }
}

output storageAccountName string = storageAccount.name
output storageAccountId string = storageAccount.id
```

- [ ] **Step 2: Create monitoring.bicep**

Create `infra/modules/monitoring.bicep`:

```bicep
param logAnalyticsName string
param appInsightsName string
param location string
param tags object

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: logAnalyticsName
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
  }
}

output appInsightsConnectionString string = appInsights.properties.ConnectionString
output appInsightsId string = appInsights.id
```

- [ ] **Step 3: Create functionApp.bicep**

Create `infra/modules/functionApp.bicep`:

```bicep
param name string
param location string
param tags object
param storageAccountName string
param appInsightsConnectionString string
param stamperConfigJson string

resource storageAccount 'Microsoft.Storage/storageAccounts@2023-05-01' existing = {
  name: storageAccountName
}

resource flexPlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: '${name}-plan'
  location: location
  tags: tags
  kind: 'functionapp'
  sku: {
    tier: 'FlexConsumption'
    name: 'FC1'
  }
  properties: {
    reserved: true
  }
}

resource functionApp 'Microsoft.Web/sites@2023-12-01' = {
  name: name
  location: location
  tags: tags
  kind: 'functionapp,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: flexPlan.id
    httpsOnly: true
    siteConfig: {
      minTlsVersion: '1.2'
      appSettings: [
        {
          name: 'AzureWebJobsStorage__accountName'
          value: storageAccountName
        }
        {
          name: 'FUNCTIONS_EXTENSION_VERSION'
          value: '~4'
        }
        {
          name: 'FUNCTIONS_WORKER_RUNTIME'
          value: 'dotnet-isolated'
        }
        {
          name: 'APPLICATIONINSIGHTS_CONNECTION_STRING'
          value: appInsightsConnectionString
        }
        {
          name: 'StamperConfig'
          value: stamperConfigJson
        }
      ]
    }
  }
}

output functionAppName string = functionApp.name
output functionAppId string = functionApp.id
output principalId string = functionApp.identity.principalId
```

- [ ] **Step 4: Create eventGrid.bicep**

Create `infra/modules/eventGrid.bicep`:

```bicep
targetScope = 'subscription'

param systemTopicName string
param eventSubscriptionName string
param functionAppId string
param location string = 'global'

resource systemTopic 'Microsoft.EventGrid/systemTopics@2024-06-01-preview' = {
  name: systemTopicName
  location: location
  properties: {
    source: subscription().id
    topicType: 'Microsoft.Resources.Subscriptions'
  }
}

resource eventSubscription 'Microsoft.EventGrid/systemTopics/eventSubscriptions@2024-06-01-preview' = {
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

- [ ] **Step 5: Create main.bicep**

Create `infra/main.bicep`:

```bicep
targetScope = 'resourceGroup'

param location string = resourceGroup().location
param storageAccountName string
param functionAppName string
param appInsightsName string
param logAnalyticsName string = '${functionAppName}-law'
param environment string = 'dev'
param tags object = {
  Project: 'Az-Stamper'
  ManagedBy: 'Bicep'
  Environment: environment
}
param stamperConfigJson string = '{"TagMap":{"Creator":{"Value":"{caller}","Overwrite":false},"CreatedOn":{"Value":"{timestamp}","Overwrite":false},"LastModifiedBy":{"Value":"{caller}","Overwrite":true},"LastModifiedOn":{"Value":"{timestamp}","Overwrite":true},"StampedBy":{"Value":"Az-Stamper","Overwrite":false}},"IgnorePatterns":["Microsoft.Resources/deployments","Microsoft.Resources/tags","Microsoft.Network/frontdoor"]}'

module monitoring 'modules/monitoring.bicep' = {
  name: 'monitoring'
  params: {
    logAnalyticsName: logAnalyticsName
    appInsightsName: appInsightsName
    location: location
    tags: tags
  }
}

module functionApp 'modules/functionApp.bicep' = {
  name: 'functionApp'
  params: {
    name: functionAppName
    location: location
    tags: tags
    storageAccountName: storageAccountName
    appInsightsConnectionString: monitoring.outputs.appInsightsConnectionString
    stamperConfigJson: stamperConfigJson
  }
}

module storage 'modules/storage.bicep' = {
  name: 'storage'
  params: {
    name: storageAccountName
    location: location
    tags: tags
    functionAppPrincipalId: functionApp.outputs.principalId
  }
}

output functionAppName string = functionApp.outputs.functionAppName
output functionAppId string = functionApp.outputs.functionAppId
output principalId string = functionApp.outputs.principalId
```

- [ ] **Step 6: Create main.sub.bicep**

Create `infra/main.sub.bicep`:

```bicep
targetScope = 'subscription'

param systemTopicName string = 'evgt-az-stamper'
param eventSubscriptionName string = 'evgs-az-stamper'
param functionAppId string
param functionAppPrincipalId string

module eventGrid 'modules/eventGrid.bicep' = {
  name: 'eventGrid'
  params: {
    systemTopicName: systemTopicName
    eventSubscriptionName: eventSubscriptionName
    functionAppId: functionAppId
  }
}

// Subscription-scoped RBAC for the function's managed identity
resource readerRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(subscription().id, functionAppPrincipalId, 'acdd72a7-3385-48ef-bd42-f606fba81ae7')
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'acdd72a7-3385-48ef-bd42-f606fba81ae7')
    principalId: functionAppPrincipalId
    principalType: 'ServicePrincipal'
  }
}

resource tagContributorRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(subscription().id, functionAppPrincipalId, '4a9ae827-6dc8-4573-8ac7-8239d42aa03f')
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4a9ae827-6dc8-4573-8ac7-8239d42aa03f')
    principalId: functionAppPrincipalId
    principalType: 'ServicePrincipal'
  }
}
```

- [ ] **Step 7: Create dev.bicepparam**

Create `infra/parameters/dev.bicepparam`:

```bicep
using '../main.bicep'

param storageAccountName = 'stazstamperdev'
param functionAppName = 'func-az-stamper-dev'
param appInsightsName = 'ai-az-stamper-dev'
param environment = 'dev'
```

- [ ] **Step 8: Create prod.bicepparam**

Create `infra/parameters/prod.bicepparam`:

```bicep
using '../main.bicep'

param storageAccountName = 'TODO-REPLACE'
param functionAppName = 'TODO-REPLACE'
param appInsightsName = 'TODO-REPLACE'
param environment = 'prod'
```

- [ ] **Step 9: Validate Bicep builds**

```bash
az bicep build --file infra/main.bicep
az bicep build --file infra/main.sub.bicep
```

Expected: No errors.

- [ ] **Step 10: Commit**

```bash
git add infra/
git commit -m "feat: add Bicep infrastructure modules for Flex Consumption deployment"
```

---

## Task 8: CI/CD & Repo Files

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/deploy.yml`
- Create: `.github/dependabot.yml`
- Create: `CLAUDE.md`
- Create: `README.md`

- [ ] **Step 1: Create CI workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build-and-test:
    name: Build & Test
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup .NET
        uses: actions/setup-dotnet@v4
        with:
          dotnet-version: '8.0.x'

      - name: Restore
        run: dotnet restore Az-Stamper.sln

      - name: Build
        run: dotnet build Az-Stamper.sln --no-restore

      - name: Test
        run: dotnet test Az-Stamper.sln --no-build --logger "trx;LogFileName=test-results.trx"

      - name: Upload test results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: test-results
          path: '**/test-results.trx'
          if-no-files-found: ignore

  lint:
    name: Format Check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Setup .NET
        uses: actions/setup-dotnet@v4
        with:
          dotnet-version: '8.0.x'

      - name: Check formatting
        run: dotnet format Az-Stamper.sln --verify-no-changes

  validate-bicep:
    name: Validate Bicep
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Build Bicep
        run: |
          az bicep build --file infra/main.bicep
          az bicep build --file infra/main.sub.bicep
```

- [ ] **Step 2: Create deploy workflow**

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy

on:
  workflow_dispatch:
    inputs:
      environment:
        description: 'Target environment'
        required: true
        type: choice
        options:
          - dev
          - prod

permissions:
  id-token: write
  contents: read

jobs:
  deploy:
    name: Deploy to ${{ inputs.environment }}
    runs-on: ubuntu-latest
    environment: ${{ inputs.environment }}
    steps:
      - uses: actions/checkout@v4

      - name: Setup .NET
        uses: actions/setup-dotnet@v4
        with:
          dotnet-version: '8.0.x'

      - name: Publish
        run: dotnet publish src/AzStamper.Functions/AzStamper.Functions.csproj -c Release -o ./publish

      - name: Package
        run: cd publish && zip -r ../deploy.zip .

      - name: Login to Azure
        uses: azure/login@v2
        with:
          client-id: ${{ secrets.AZURE_CLIENT_ID }}
          tenant-id: ${{ secrets.AZURE_TENANT_ID }}
          subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

      - name: Deploy infrastructure
        run: |
          az deployment group create \
            --resource-group ${{ vars.RESOURCE_GROUP }} \
            --template-file infra/main.bicep \
            --parameters infra/parameters/${{ inputs.environment }}.bicepparam

      - name: Deploy function code
        run: |
          az functionapp deployment source config-zip \
            --resource-group ${{ vars.RESOURCE_GROUP }} \
            --name ${{ vars.FUNCTION_APP_NAME }} \
            --src deploy.zip
```

- [ ] **Step 3: Create dependabot.yml**

Create `.github/dependabot.yml`:

```yaml
version: 2
updates:
  - package-ecosystem: nuget
    directory: /src
    schedule:
      interval: weekly
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
```

- [ ] **Step 4: Create CLAUDE.md**

Create `CLAUDE.md`:

```markdown
# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Az-Stamper is a C# Azure Function (.NET 8 LTS, isolated worker) triggered by Event Grid that automatically stamps Azure resources with configurable metadata tags. It resolves the creator identity (UPN or Service Principal) and applies a configurable tag map with overwrite semantics.

**Architecture**: Event Grid (ResourceWriteSuccess) → ResourceStamperFunction (thin adapter) → StampOrchestrator (resolve caller → check ignore list → stamp tags)

## Build & Test

```bash
dotnet build Az-Stamper.sln
dotnet test Az-Stamper.sln
dotnet format Az-Stamper.sln --verify-no-changes   # lint
az bicep build --file infra/main.bicep              # validate infra
```

### Run Locally

```bash
cd src/AzStamper.Functions
func start
```

Requires Azure Functions Core Tools v4 and .NET 8 SDK.

## Project Structure

- `src/AzStamper.Core/` — Pure business logic (no Azure Functions dependency). Models, services behind interfaces, StampOrchestrator.
- `src/AzStamper.Functions/` — Thin Azure Functions adapter. Event Grid trigger, DI setup, config binding.
- `tests/AzStamper.Core.Tests/` — xUnit + Moq tests against Core interfaces.
- `infra/` — Bicep modules. `main.bicep` (RG-scoped), `main.sub.bicep` (subscription-scoped Event Grid).

## Conventions

- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `ci:`
- Branch prefixes: `feat/`, `fix/`, `chore/`
- C#: PascalCase types/methods, _camelCase private fields, async/await with CancellationToken, ILogger<T>
- All Azure SDK operations behind interfaces (ITagService, ICallerResolver) for testability
- Error handling: log and return, never throw from business logic
- Bicep: modular, all resources tagged, managed identity for storage
```

- [ ] **Step 5: Create README.md**

Create `README.md`:

```markdown
# Az-Stamper

Automatically stamps Azure resources with configurable metadata tags (creator identity, timestamps, static labels) via Event Grid-triggered Azure Function.

Inspired by [TagWithCreator](https://github.com/anwather/TagWithCreator) by Anthony Watherston.

## Architecture

```
Event Grid (ResourceWriteSuccess)
  → Azure Function (.NET 8, isolated worker, Flex Consumption)
    → Resolve caller identity (UPN → Service Principal → fallback)
      → Apply configurable tag map with overwrite semantics
```

## Tag Configuration

Tags are configured via the `StamperConfig` app setting:

| Tag | Template | Overwrite | Behavior |
|-----|----------|-----------|----------|
| Creator | `{caller}` | false | Set once, never overwritten |
| CreatedOn | `{timestamp}` | false | Set once |
| LastModifiedBy | `{caller}` | true | Updated on every write |
| LastModifiedOn | `{timestamp}` | true | Updated on every write |
| StampedBy | `Az-Stamper` | false | Static label, set once |

## Quick Start

### Deploy

```bash
az deployment group create \
  --resource-group rg-az-stamper-dev \
  --template-file infra/main.bicep \
  --parameters infra/parameters/dev.bicepparam

dotnet publish src/AzStamper.Functions -c Release -o ./publish
cd publish && zip -r ../deploy.zip .
az functionapp deployment source config-zip \
  --resource-group rg-az-stamper-dev \
  --name func-az-stamper-dev \
  --src deploy.zip
```

Then deploy the Event Grid subscription:

```bash
az deployment sub create \
  --location eastus \
  --template-file infra/main.sub.bicep \
  --parameters functionAppId=/subscriptions/<SUB_ID>/resourceGroups/<RG>/providers/Microsoft.Web/sites/func-az-stamper-dev
```

### Run Tests

```bash
dotnet test Az-Stamper.sln
```

## RBAC Requirements

| Role | Scope | Purpose |
|------|-------|---------|
| Reader | Subscription | Resolve SP display names |
| Tag Contributor | Subscription | Read/write resource tags |
| Storage Blob Data Owner | Storage Account | Function runtime |
| Directory.Read.All | Entra ID | Graph API SP lookup |

## License

[MIT](LICENSE)
```

- [ ] **Step 6: Commit**

```bash
git add .github/ CLAUDE.md README.md
git commit -m "chore: add CI/CD workflows, Dependabot, CLAUDE.md, and README"
```

---

## Task 9: Final Verification

- [ ] **Step 1: Full build**

```bash
dotnet build Az-Stamper.sln
```

Expected: Build succeeded, 0 errors.

- [ ] **Step 2: Run all tests**

```bash
dotnet test Az-Stamper.sln -v n
```

Expected: All tests pass.

- [ ] **Step 3: Check formatting**

```bash
dotnet format Az-Stamper.sln --verify-no-changes
```

Expected: No formatting violations (or fix if any).

- [ ] **Step 4: Validate Bicep**

```bash
az bicep build --file infra/main.bicep
az bicep build --file infra/main.sub.bicep
```

Expected: No errors.

- [ ] **Step 5: Push all commits**

```bash
git push origin main
```

- [ ] **Step 6: Verify CI passes**

Check GitHub Actions at `https://github.com/Galvnyz/Az-Stamper/actions` — all jobs should pass.
