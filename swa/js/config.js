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
