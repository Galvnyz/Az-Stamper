param systemTopicName string = 'evgt-az-stamper'
param eventSubscriptionName string = 'evgs-az-stamper'
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
            'Microsoft.Resources/tags'
          ]
        }
      ]
    }
  }
}
