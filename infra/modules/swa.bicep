param name string
param location string
param tags object
param repositoryUrl string = 'https://github.com/Galvnyz/Az-Stamper'
param branch string = 'main'
param appLocation string = 'swa'

resource staticWebApp 'Microsoft.Web/staticSites@2022-09-01' = {
  name: name
  location: location
  tags: tags
  sku: {
    name: 'Free'
    tier: 'Free'
  }
  properties: {
    repositoryUrl: repositoryUrl
    branch: branch
    buildProperties: {
      appLocation: appLocation
      outputLocation: ''
      skipGithubActionWorkflowGeneration: true
    }
  }
}

output staticWebAppName string = staticWebApp.name
output defaultHostname string = staticWebApp.properties.defaultHostname
