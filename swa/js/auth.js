// Auth module — MSAL.js initialization and token management

const AUTH_CONFIG = {
  clientId: (window.AZ_STAMPER_CONFIG || {}).clientId || '',
  tenantId: (window.AZ_STAMPER_CONFIG || {}).tenantId || 'common',
  redirectUri: window.location.origin,
};

const SCOPES = {
  management: ['https://management.azure.com/.default'],
  storage: ['https://storage.azure.com/.default'],
};

let msalInstance = null;
let currentAccount = null;

function initAuth() {
  if (!AUTH_CONFIG.clientId) {
    console.warn('No AZURE_CLIENT_ID configured — auth disabled');
    return;
  }

  const msalConfig = {
    auth: {
      clientId: AUTH_CONFIG.clientId,
      authority: `https://login.microsoftonline.com/${AUTH_CONFIG.tenantId}`,
      redirectUri: AUTH_CONFIG.redirectUri,
    },
    cache: {
      cacheLocation: 'sessionStorage',
      storeAuthStateInCookie: false,
    },
  };

  msalInstance = new msal.PublicClientApplication(msalConfig);

  msalInstance.initialize().then(() => {
    return msalInstance.handleRedirectPromise();
  }).then(response => {
    if (response) {
      currentAccount = response.account;
    } else {
      const accounts = msalInstance.getAllAccounts();
      if (accounts.length > 0) {
        currentAccount = accounts[0];
      }
    }
    updateAuthUI();
  }).catch(err => {
    console.error('Auth redirect error:', err);
  });
}

function signIn() {
  if (!msalInstance) {
    alert('Authentication not configured. Set AZURE_CLIENT_ID and AZURE_TENANT_ID.');
    return;
  }
  msalInstance.loginRedirect({ scopes: SCOPES.management });
}

function signOut() {
  if (!msalInstance) return;
  msalInstance.logoutRedirect({ account: currentAccount });
}

async function getToken(scopes) {
  if (!msalInstance || !currentAccount) return null;

  try {
    const response = await msalInstance.acquireTokenSilent({
      scopes,
      account: currentAccount,
    });
    return response.accessToken;
  } catch (err) {
    try {
      const response = await msalInstance.acquireTokenPopup({ scopes });
      return response.accessToken;
    } catch (popupErr) {
      console.error('Token acquisition failed:', popupErr);
      return null;
    }
  }
}

async function getManagementToken() {
  return getToken(SCOPES.management);
}

async function getStorageToken() {
  return getToken(SCOPES.storage);
}

function isAuthenticated() {
  return currentAccount !== null;
}

function getUsername() {
  return currentAccount ? (currentAccount.username || currentAccount.name || 'User') : null;
}

function updateAuthUI() {
  const userInfo = document.getElementById('user-info');
  const signInPrompt = document.getElementById('sign-in-prompt');
  const appContent = document.getElementById('app-content');

  if (isAuthenticated()) {
    userInfo.textContent = '';
    const nameSpan = document.createElement('span');
    nameSpan.textContent = getUsername();
    userInfo.appendChild(nameSpan);
    const signOutBtn = document.createElement('button');
    signOutBtn.className = 'btn btn-secondary';
    signOutBtn.textContent = 'Sign Out';
    signOutBtn.addEventListener('click', signOut);
    userInfo.appendChild(signOutBtn);

    signInPrompt.style.display = 'none';
    appContent.style.display = 'block';

    if (window.loadSubscriptionsTab) window.loadSubscriptionsTab();
  } else {
    userInfo.textContent = '';
    const signInBtn = document.createElement('button');
    signInBtn.className = 'btn btn-primary';
    signInBtn.textContent = 'Sign In';
    signInBtn.addEventListener('click', signIn);
    userInfo.appendChild(signInBtn);

    signInPrompt.style.display = 'flex';
    appContent.style.display = 'none';
  }
}

document.addEventListener('DOMContentLoaded', initAuth);
