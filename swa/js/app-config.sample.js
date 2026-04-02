// Copy this file to app-config.js and fill in your deployment values.
// Run scripts/Setup-SwaAuth.ps1 to generate this file automatically.
window.AZ_STAMPER_CONFIG = {
  clientId: '<entra-app-registration-client-id>',
  tenantId: '<azure-ad-tenant-id>',
  configBlobUrl: 'https://<storage-account>.blob.core.windows.net/config/stamper.json',
  appInsightsId: '/subscriptions/<subscription-id>/resourceGroups/<rg-name>/providers/Microsoft.Insights/components/<ai-name>',
  functionAppId: '/subscriptions/<subscription-id>/resourceGroups/<rg-name>/providers/Microsoft.Web/sites/<function-app-name>'
};
