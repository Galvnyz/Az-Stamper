using System.Text.Json;
using Azure.Identity;
using Azure.ResourceManager;
using Azure.Storage.Blobs;
using AzStamper.Core;
using AzStamper.Core.Models;
using AzStamper.Core.Services;
using Microsoft.Azure.Functions.Worker;
using Microsoft.Azure.Functions.Worker.Builder;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.Graph;

var builder = FunctionsApplication.CreateBuilder(args);

builder.Services.AddApplicationInsightsTelemetryWorkerService();
builder.Services.ConfigureFunctionsApplicationInsights();

// ConfigureFunctionsApplicationInsights() adds a default filter that sets Warning as the
// minimum level for the Application Insights provider, blocking our Information-level traces.
// Remove ALL such blanket filters so host.json logLevel settings are respected.
builder.Logging.Services.Configure<LoggerFilterOptions>(options =>
{
    var blanketFilters = options.Rules
        .Where(r => string.IsNullOrEmpty(r.CategoryName)
                     && r.LogLevel is not null
                     && r.LogLevel >= LogLevel.Warning
                     && !string.IsNullOrEmpty(r.ProviderName))
        .ToList();
    foreach (var f in blanketFilters)
        options.Rules.Remove(f);
});

builder.Services.Configure<StamperConfig>(
    builder.Configuration.GetSection("StamperConfig"));

builder.Services.PostConfigure<StamperConfig>(config =>
{
    if (string.IsNullOrEmpty(config.SelfAppName))
    {
        config.SelfAppName = Environment.GetEnvironmentVariable("WEBSITE_SITE_NAME");
    }
});

var credential = new DefaultAzureCredential();

// Cloud-aware client construction. Bicep sets AzureCloud__Name from environment().name,
// so the same build deploys to both Azure commercial ("AzureCloud") and Azure Government
// GCC High ("AzureUSGovernment"). DefaultAzureCredential picks up the matching authority
// from the AZURE_AUTHORITY_HOST app setting (also emitted by Bicep), so it needs no branch.
var cloudName = builder.Configuration["AzureCloud:Name"];
var isGovCloud = string.Equals(cloudName, "AzureUSGovernment", StringComparison.OrdinalIgnoreCase);

var armClientOptions = new ArmClientOptions
{
    Environment = isGovCloud ? ArmEnvironment.AzureGovernment : ArmEnvironment.AzurePublicCloud
};
builder.Services.AddSingleton(new ArmClient(credential, defaultSubscriptionId: null, armClientOptions));

var graphHost = isGovCloud ? "graph.microsoft.us" : "graph.microsoft.com";
var graphScopes = new[] { $"https://{graphHost}/.default" };
var graphBaseUrl = $"https://{graphHost}/v1.0";
builder.Services.AddSingleton(new GraphServiceClient(credential, graphScopes, graphBaseUrl));
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

builder.Services.AddSingleton<ComplianceEvaluator>();
builder.Services.AddSingleton<StampOrchestrator>();

builder.Build().Run();
