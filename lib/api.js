const API_BASE_URL = 'http://localhost:8080';

// Token storage helpers
async function getTokens() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['accessToken', 'refreshToken'], (result) => {
      resolve({ accessToken: result.accessToken || null, refreshToken: result.refreshToken || null });
    });
  });
}

async function saveTokens(accessToken, refreshToken) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ accessToken, refreshToken }, resolve);
  });
}

async function clearTokens() {
  return new Promise((resolve) => {
    chrome.storage.local.remove(['accessToken', 'refreshToken'], resolve);
  });
}

// Core API request with auto-refresh on 401
async function apiRequest(method, path, body = null, retry = true) {
  const { accessToken } = await getTokens();
  const headers = { 'Content-Type': 'application/json' };
  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  const options = { method, headers };
  if (body) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, options);

  if (response.status === 401 && retry) {
    const refreshed = await tryRefreshToken();
    if (refreshed) {
      return apiRequest(method, path, body, false);
    }
    await clearTokens();
    throw new Error('AUTH_EXPIRED');
  }

  const data = await response.json();

  if (response.status === 403) {
    const error = new Error(data.error?.message || 'Daily analysis limit reached');
    error.code = 'LIMIT_EXCEEDED';
    error.status = 403;
    throw error;
  }

  if (!response.ok) {
    const errorMsg = data.error?.message || `Request failed with status ${response.status}`;
    const error = new Error(errorMsg);
    error.code = data.error?.code || 'UNKNOWN_ERROR';
    error.status = response.status;
    throw error;
  }

  return data;
}

async function tryRefreshToken() {
  const { refreshToken } = await getTokens();
  if (!refreshToken) return false;

  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });

    if (!response.ok) return false;

    const data = await response.json();
    if (data.status === 'success' && data.data) {
      await saveTokens(data.data.accessToken, data.data.refreshToken);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

// API methods
async function authWithGoogle(accessToken) {
  const data = await apiRequest('POST', '/api/v1/auth/google', { accessToken });
  if (data.status === 'success' && data.data) {
    await saveTokens(data.data.accessToken, data.data.refreshToken);
  }
  return data;
}

async function analyzeMatch(vacancyText, resumeText, vacancyTitle, companyName) {
  return apiRequest('POST', '/api/v1/analysis/match', {
    vacancyText,
    resumeText,
    vacancyTitle: vacancyTitle || null,
    companyName: companyName || null,
  });
}

// Make available globally (for importScripts in service worker)
if (typeof globalThis !== 'undefined') {
  globalThis.cvpilotApi = {
    getTokens,
    saveTokens,
    clearTokens,
    apiRequest,
    authWithGoogle,
    analyzeMatch,
  };
}
