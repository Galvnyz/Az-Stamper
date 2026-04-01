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
using Microsoft.Extensions.Logging.ApplicationInsights;
using Microsoft.Graph;

var builder = FunctionsApplication.CreateBuilder(args);

builder.Services.AddApplicationInsightsTelemetryWorkerService();
builder.Services.ConfigureFunctionsApplicationInsights();

// ConfigureFunctionsApplicationInsights() sets a default filter that blocks Information-level
// logs from reaching Application Insights. Override it so our stamping traces flow through.
builder.Logging.Services.Configure<LoggerFilterOptions>(options =>
{
    var aiFilter = options.Rules.FirstOrDefault(r =>
        r.ProviderName == typeof(ApplicationInsightsLoggerProvider).FullName
        && string.IsNullOrEmpty(r.CategoryName));
    if (aiFilter is not null)
        options.Rules.Remove(aiFilter);
});

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
