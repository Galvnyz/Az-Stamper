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
