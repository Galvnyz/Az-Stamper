// Enrollment module — Event Grid enrollment discovery, pause, and resume

var _enrollmentCache = null;

// Returns cached enrollment data, or fetches fresh if not yet loaded
async function discoverEnrollment() {
  if (_enrollmentCache !== null) {
    return _enrollmentCache;
  }
  return refreshEnrollment();
}

// Always fetches fresh enrollment state across all accessible subscriptions
async function refreshEnrollment() {
  var token = await getManagementToken();
  if (!token) {
    showToast('Unable to acquire management token', 'error');
    _enrollmentCache = [];
    return _enrollmentCache;
  }

  var subsData;
  try {
    subsData = await azureFetch(
      'https://management.azure.com/subscriptions?api-version=2022-12-01',
      token
    );
  } catch (err) {
    console.error('Failed to list subscriptions:', err);
    showToast('Failed to list subscriptions', 'error');
    _enrollmentCache = [];
    return _enrollmentCache;
  }

  var subs = (subsData && subsData.value) ? subsData.value : [];

  await loadConfig();
  var config = getConfig();
  var configSubs = (config && config.subscriptions) ? config.subscriptions : {};

  var checks = subs.map(function(sub) {
    return checkEnrollmentDetail(sub.subscriptionId, token).then(function(detail) {
      if (!detail) return null;
      return {
        subscriptionId: sub.subscriptionId,
        displayName: sub.displayName,
        enrolled: true,
        active: detail.active,
        systemTopicName: detail.systemTopicName,
        systemTopicRg: detail.systemTopicRg,
        eventSubscriptionName: detail.eventSubscriptionName,
        hasCustomConfig: Object.prototype.hasOwnProperty.call(configSubs, sub.subscriptionId),
      };
    });
  });

  var results = await Promise.allSettled(checks);

  var enrolled = [];
  results.forEach(function(result) {
    if (result.status === 'fulfilled' && result.value !== null) {
      enrolled.push(result.value);
    } else if (result.status === 'rejected') {
      console.error('Enrollment check failed for a subscription:', result.reason);
    }
  });

  _enrollmentCache = enrolled;
  return _enrollmentCache;
}

// Checks a single subscription for an Az-Stamper Event Grid system topic
async function checkEnrollmentDetail(subId, token) {
  var topicsUrl = 'https://management.azure.com/subscriptions/' + subId +
    '/providers/Microsoft.EventGrid/systemTopics?api-version=2022-06-15';

  var topicsData;
  try {
    topicsData = await azureFetch(topicsUrl, token);
  } catch (err) {
    console.error('Failed to list system topics for ' + subId + ':', err);
    return null;
  }

  var topics = (topicsData && topicsData.value) ? topicsData.value : [];

  var matchingTopic = null;
  for (var i = 0; i < topics.length; i++) {
    var topic = topics[i];
    var topicType = (topic.properties && topic.properties.topicType) ? topic.properties.topicType : '';
    if (topicType.toLowerCase() === 'microsoft.resources.subscriptions') {
      matchingTopic = topic;
      break;
    }
  }

  if (!matchingTopic) return null;

  var topicId = matchingTopic.id;
  var rgMatch = topicId.match(/resourceGroups\/([^/]+)/i);
  var systemTopicRg = rgMatch ? rgMatch[1] : null;
  var systemTopicName = matchingTopic.name;

  var esUrl = 'https://management.azure.com' + topicId +
    '/eventSubscriptions?api-version=2022-06-15';

  var esData;
  try {
    esData = await azureFetch(esUrl, token);
  } catch (err) {
    console.error('Failed to list event subscriptions for topic ' + topicId + ':', err);
    return null;
  }

  var eventSubs = (esData && esData.value) ? esData.value : [];
  var active = eventSubs.length > 0;
  var eventSubscriptionName = active ? eventSubs[0].name : null;

  return {
    active: active,
    systemTopicName: systemTopicName,
    systemTopicRg: systemTopicRg,
    eventSubscriptionName: eventSubscriptionName,
  };
}

// Pauses enrollment by deleting the event subscription for a sub
async function pauseEnrollment(sub) {
  var token = await getManagementToken();
  if (!token) {
    showToast('Unable to acquire management token', 'error');
    return false;
  }

  var url = 'https://management.azure.com/subscriptions/' + sub.subscriptionId +
    '/resourceGroups/' + sub.systemTopicRg +
    '/providers/Microsoft.EventGrid/systemTopics/' + sub.systemTopicName +
    '/eventSubscriptions/' + sub.eventSubscriptionName +
    '?api-version=2022-06-15';

  try {
    await azureFetch(url, token, { method: 'DELETE' });
    showToast('Enrollment paused for ' + sub.displayName, 'success');
    invalidateEnrollmentCache();
    return true;
  } catch (err) {
    console.error('Failed to pause enrollment for ' + sub.subscriptionId + ':', err);
    showToast('Failed to pause enrollment for ' + sub.displayName, 'error');
    return false;
  }
}

// Resumes enrollment by creating an event subscription for a sub
async function resumeEnrollment(sub) {
  var token = await getManagementToken();
  if (!token) {
    showToast('Unable to acquire management token', 'error');
    return false;
  }

  var functionAppId = (window.AZ_STAMPER_CONFIG || {}).functionAppId || '';
  var esName = sub.eventSubscriptionName || 'evgs-az-stamper';

  var url = 'https://management.azure.com/subscriptions/' + sub.subscriptionId +
    '/resourceGroups/' + sub.systemTopicRg +
    '/providers/Microsoft.EventGrid/systemTopics/' + sub.systemTopicName +
    '/eventSubscriptions/' + esName +
    '?api-version=2022-06-15';

  var body = {
    properties: {
      destination: {
        endpointType: 'AzureFunction',
        properties: {
          resourceId: functionAppId + '/functions/ResourceStamper',
        },
      },
      filter: {
        includedEventTypes: ['Microsoft.Resources.ResourceWriteSuccess'],
        advancedFilters: [
          {
            operatorType: 'StringNotContains',
            key: 'data.operationName',
            values: [
              'Microsoft.Resources/deployments',
              'Microsoft.Resources/tags',
            ],
          },
        ],
      },
    },
  };

  try {
    await azureFetch(url, token, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    showToast('Enrollment resumed for ' + sub.displayName, 'success');
    invalidateEnrollmentCache();
    return true;
  } catch (err) {
    console.error('Failed to resume enrollment for ' + sub.subscriptionId + ':', err);
    showToast('Failed to resume enrollment for ' + sub.displayName, 'error');
    return false;
  }
}

// Clears the enrollment cache so the next call to discoverEnrollment fetches fresh data
function invalidateEnrollmentCache() {
  _enrollmentCache = null;
}
