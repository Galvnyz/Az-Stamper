param name string
param location string
param tags object
param appInsightsId string

var workbookId = guid(name, resourceGroup().id, 'az-stamper-workbook')

resource workbook 'Microsoft.Insights/workbooks@2023-06-01' = {
  name: workbookId
  location: location
  tags: tags
  kind: 'shared'
  properties: {
    displayName: name
    category: 'workbook'
    sourceId: appInsightsId
    serializedData: loadTextContent('workbook-template.json')
  }
}

output workbookId string = workbook.id
