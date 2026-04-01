// Config module — load/save stamper.json via Blob Storage REST API

const CONFIG_BLOB_URL = (window.AZ_STAMPER_CONFIG || {}).configBlobUrl || '';

let cachedConfig = null;

async function loadConfig() {
  if (!CONFIG_BLOB_URL) {
    console.warn('CONFIG_BLOB_URL not set');
    return { subscriptions: {} };
  }

  const token = await getStorageToken();
  if (!token) return { subscriptions: {} };

  try {
    const response = await fetch(CONFIG_BLOB_URL, {
      headers: {
        'Authorization': 'Bearer ' + token,
        'x-ms-version': '2020-10-02',
      },
    });

    if (response.status === 404) {
      cachedConfig = { subscriptions: {} };
      return cachedConfig;
    }

    if (!response.ok) {
      throw new Error('Blob read failed: ' + response.status);
    }

    cachedConfig = await response.json();
    return cachedConfig;
  } catch (err) {
    console.error('Failed to load config:', err);
    showToast('Failed to load configuration', 'error');
    return { subscriptions: {} };
  }
}

async function saveConfig(config) {
  if (!CONFIG_BLOB_URL) {
    showToast('CONFIG_BLOB_URL not configured', 'error');
    return false;
  }

  const token = await getStorageToken();
  if (!token) return false;

  try {
    var body = JSON.stringify(config, null, 2);
    var response = await fetch(CONFIG_BLOB_URL, {
      method: 'PUT',
      headers: {
        'Authorization': 'Bearer ' + token,
        'x-ms-version': '2020-10-02',
        'x-ms-blob-type': 'BlockBlob',
        'Content-Type': 'application/json',
      },
      body: body,
    });

    if (!response.ok) {
      throw new Error('Blob write failed: ' + response.status);
    }

    cachedConfig = config;
    showToast('Configuration saved', 'success');
    return true;
  } catch (err) {
    console.error('Failed to save config:', err);
    showToast('Failed to save configuration', 'error');
    return false;
  }
}

function getConfig() {
  return cachedConfig || { subscriptions: {} };
}

function exportConfigFile() {
  var config = getConfig();
  var json = JSON.stringify(config, null, 2);
  var blob = new Blob([json], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', 'stamper.json');
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  showToast('Config exported', 'success');
}

async function importConfigFile(newConfig, mode) {
  // Validate structure
  if (!newConfig || typeof newConfig !== 'object') {
    showToast('Invalid config file: expected a JSON object', 'error');
    return false;
  }
  if (!newConfig.subscriptions || typeof newConfig.subscriptions !== 'object') {
    showToast('Invalid config file: missing "subscriptions" object', 'error');
    return false;
  }

  if (mode === 'replace') {
    return await saveConfig(newConfig);
  }

  // Merge mode
  var existing = getConfig();
  if (!existing.subscriptions) existing.subscriptions = {};

  var importedIds = Object.keys(newConfig.subscriptions);
  importedIds.forEach(function(subId) {
    var newSub = newConfig.subscriptions[subId];
    if (!existing.subscriptions[subId]) {
      existing.subscriptions[subId] = newSub;
    } else {
      var existingSub = existing.subscriptions[subId];
      // Merge tagOverrides
      if (newSub.tagOverrides) {
        if (!existingSub.tagOverrides) existingSub.tagOverrides = {};
        Object.assign(existingSub.tagOverrides, newSub.tagOverrides);
      }
      // Merge resourceTypeRules
      if (newSub.resourceTypeRules) {
        if (!existingSub.resourceTypeRules) existingSub.resourceTypeRules = {};
        Object.assign(existingSub.resourceTypeRules, newSub.resourceTypeRules);
      }
      // Merge additionalIgnorePatterns (deduplicate)
      if (newSub.additionalIgnorePatterns && newSub.additionalIgnorePatterns.length > 0) {
        var patterns = (existingSub.additionalIgnorePatterns || []).concat(newSub.additionalIgnorePatterns);
        existingSub.additionalIgnorePatterns = patterns.filter(function(p, i) {
          return patterns.indexOf(p) === i;
        });
      }
      // Preserve displayName from import if not already set
      if (newSub.displayName && !existingSub.displayName) {
        existingSub.displayName = newSub.displayName;
      }
    }
  });

  return await saveConfig(existing);
}
