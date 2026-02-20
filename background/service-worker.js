importScripts('../lib/api.js');

const api = globalThis.cvpilotApi;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch((err) => {
    sendResponse({ success: false, error: err.message || 'Unknown error', code: err.code });
  });
  return true; // keep channel open for async response
});

async function handleMessage(message) {
  switch (message.type) {
    case 'AUTH_GOOGLE':
      return handleAuthGoogle();
    case 'GET_AUTH_STATE':
      return handleGetAuthState();
    case 'SIGN_OUT':
      return handleSignOut();
    case 'ANALYZE':
      return handleAnalyze(message);
    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}

async function handleAuthGoogle() {
  const token = await new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, (token) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(token);
    });
  });

  const result = await api.authWithGoogle(token);
  return { success: true, data: result.data };
}

async function handleGetAuthState() {
  const { accessToken } = await api.getTokens();
  return { success: true, authenticated: !!accessToken };
}

async function handleSignOut() {
  const { accessToken } = await api.getTokens();

  // Revoke cached Google token
  try {
    await new Promise((resolve) => {
      chrome.identity.getAuthToken({ interactive: false }, (token) => {
        if (token) {
          chrome.identity.removeCachedAuthToken({ token }, resolve);
        } else {
          resolve();
        }
      });
    });
  } catch {
    // ignore revocation errors
  }

  await api.clearTokens();
  return { success: true };
}

async function handleAnalyze({ vacancyText, resumeText, vacancyTitle, companyName }) {
  const result = await api.analyzeMatch(vacancyText, resumeText, vacancyTitle, companyName);
  return { success: true, data: result.data };
}
