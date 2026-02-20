// CVPilot Popup — state machine driving 8 UI states

const STATES = ['auth', 'empty', 'ready', 'loading', 'result', 'limit', 'error', 'wrong-page'];

// DOM refs
const els = {
  signOutBtn: document.getElementById('signOutBtn'),
  googleSignInBtn: document.getElementById('googleSignInBtn'),
  resumeTextarea: document.getElementById('resumeTextarea'),
  saveResumeBtn: document.getElementById('saveResumeBtn'),
  resumeStatus: document.getElementById('resumeStatus'),
  clearResumeBtn: document.getElementById('clearResumeBtn'),
  resumePageAction: document.getElementById('resumePageAction'),
  resumePreviewBox: document.getElementById('resumePreviewBox'),
  loadFromPageBtn: document.getElementById('loadFromPageBtn'),
  resumePreview: document.getElementById('resumePreview'),
  resumeMeta: document.getElementById('resumeMeta'),
  analyzeBtn: document.getElementById('analyzeBtn'),
  analyzeAgainBtn: document.getElementById('analyzeAgainBtn'),
  retryBtn: document.getElementById('retryBtn'),
  vacancyTitle: document.getElementById('vacancyTitle'),
  vacancyCompany: document.getElementById('vacancyCompany'),
  remainingCounter: document.getElementById('remainingCounter'),
  resultRemaining: document.getElementById('resultRemaining'),
  scoreCircle: document.getElementById('scoreCircle'),
  scoreValue: document.getElementById('scoreValue'),
  matchLevel: document.getElementById('matchLevel'),
  summaryText: document.getElementById('summaryText'),
  strengthsList: document.getElementById('strengthsList'),
  partialList: document.getElementById('partialList'),
  gapsList: document.getElementById('gapsList'),
  recommendationsList: document.getElementById('recommendationsList'),
  riskList: document.getElementById('riskList'),
  errorMessage: document.getElementById('errorMessage'),
  strengthsSection: document.getElementById('strengthsSection'),
  partialSection: document.getElementById('partialSection'),
  gapsSection: document.getElementById('gapsSection'),
  recommendationsSection: document.getElementById('recommendationsSection'),
  riskSection: document.getElementById('riskSection'),
};

// Current state
let currentVacancy = null;
let currentResumePageText = null;
let lastRetryAction = null;

// ---- IndexedDB wrapper for resume storage ----
const ResumeDB = {
  _db: null,
  async open() {
    if (this._db) return this._db;
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('cvpilot', 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore('resume', { keyPath: 'id' });
      };
      req.onsuccess = () => { this._db = req.result; resolve(this._db); };
      req.onerror = () => reject(req.error);
    });
  },
  async get() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('resume', 'readonly');
      const req = tx.objectStore('resume').get(1);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  },
  async save(text, source = 'manual') {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('resume', 'readwrite');
      tx.objectStore('resume').put({ id: 1, text, source, updatedAt: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },
  async clear() {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('resume', 'readwrite');
      tx.objectStore('resume').delete(1);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  },
};

// ---- State management ----
function showState(stateName) {
  STATES.forEach((s) => {
    document.getElementById(`state-${s}`).style.display = s === stateName ? 'flex' : 'none';
  });
  els.signOutBtn.style.display = stateName !== 'auth' ? 'block' : 'none';
}

// ---- Send message to background ----
function sendMessage(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, resolve);
  });
}

// ---- Get page info from content script ----
async function getPageInfo() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url || !tab.url.includes('hh.ru')) {
      return { type: 'other', data: null };
    }
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_INFO' }, (response) => {
        if (chrome.runtime.lastError || !response) {
          resolve({ type: 'other', data: null });
        } else {
          resolve(response);
        }
      });
    });
  } catch {
    return { type: 'other', data: null };
  }
}

// ---- Initialization ----
async function init() {
  const authState = await sendMessage({ type: 'GET_AUTH_STATE' });

  if (!authState || !authState.authenticated) {
    showState('auth');
    return;
  }

  const pageInfo = await getPageInfo();
  const resume = await ResumeDB.get();

  // On a resume page — always offer to load/update, even if resume already saved
  if (pageInfo.type === 'resume' && pageInfo.data?.text) {
    currentResumePageText = pageInfo.data.text;
    els.resumePageAction.style.display = 'flex';
    els.resumePreviewBox.textContent = pageInfo.data.text.substring(0, 200) + '...';
    els.resumeTextarea.style.display = 'none';
    els.saveResumeBtn.style.display = 'none';
    showState('empty');
    return;
  }

  if (!resume || !resume.text) {
    els.resumePageAction.style.display = 'none';
    els.resumeTextarea.style.display = '';
    els.saveResumeBtn.style.display = '';
    showState('empty');
    return;
  }

  if (pageInfo.type === 'vacancy' && pageInfo.data) {
    currentVacancy = pageInfo.data;
    els.vacancyTitle.textContent = pageInfo.data.title || 'Vacancy';
    els.vacancyCompany.textContent = pageInfo.data.company || '';
    // Show resume info
    els.resumePreview.textContent = resume.text.substring(0, 200) + '...';
    const source = resume.source === 'hh.ru' ? 'Auto-parsed from hh.ru' : 'Manual input';
    const date = resume.updatedAt ? new Date(resume.updatedAt).toLocaleDateString() : '';
    els.resumeMeta.textContent = `${source}${date ? ' · ' + date : ''}`;
    showState('ready');
    return;
  }

  showState('wrong-page');
}

// ---- Analysis ----
async function runAnalysis() {
  if (!currentVacancy) return;

  showState('loading');

  const resume = await ResumeDB.get();
  if (!resume || !resume.text) {
    showState('empty');
    return;
  }

  const result = await sendMessage({
    type: 'ANALYZE',
    vacancyText: currentVacancy.fullText || currentVacancy.description,
    resumeText: resume.text,
    vacancyTitle: currentVacancy.title,
    companyName: currentVacancy.company,
  });

  if (!result || !result.success) {
    const errorMsg = result?.error || 'Failed to analyze. Please try again.';

    if (result?.code === 'LIMIT_EXCEEDED' || result?.code === 'RATE_LIMIT_EXCEEDED' || result?.error?.includes('limit')) {
      showState('limit');
      return;
    }

    if (errorMsg === 'AUTH_EXPIRED') {
      showState('auth');
      return;
    }

    els.errorMessage.textContent = errorMsg;
    lastRetryAction = runAnalysis;
    showState('error');
    return;
  }

  displayResult(result.data);
}

function displayResult(data) {
  const analysis = data.analysis;
  const metadata = data.metadata;

  // Score
  const score = analysis.match_score;
  els.scoreValue.textContent = score;
  els.scoreCircle.className = 'score-circle';
  if (score >= 81) els.scoreCircle.classList.add('score-excellent');
  else if (score >= 61) els.scoreCircle.classList.add('score-good');
  else if (score >= 31) els.scoreCircle.classList.add('score-medium');
  else els.scoreCircle.classList.add('score-low');

  els.matchLevel.textContent = analysis.match_level || '';
  els.summaryText.textContent = analysis.summary || '';

  // Strengths
  renderList(els.strengthsList, analysis.strengths, (item) =>
    `<strong>${esc(item.area)}</strong><span>${esc(item.description)}</span>`
  );
  els.strengthsSection.style.display = analysis.strengths?.length ? 'block' : 'none';

  // Partial matches
  renderList(els.partialList, analysis.partial_matches, (item) =>
    `<strong>${esc(item.requirement)}</strong><span>${esc(item.comment)}</span>`
  );
  els.partialSection.style.display = analysis.partial_matches?.length ? 'block' : 'none';

  // Gaps
  renderList(els.gapsList, analysis.gaps, (item) =>
    `<strong>${esc(item.missing_requirement)}</strong><span>${esc(item.impact)}</span>`
  );
  els.gapsSection.style.display = analysis.gaps?.length ? 'block' : 'none';

  // Recommendations
  const rec = analysis.recommendations;
  let recHtml = '';
  if (rec?.resume_improvements?.length) {
    recHtml += renderRecGroup('Resume improvements', rec.resume_improvements);
  }
  if (rec?.skills_to_highlight?.length) {
    recHtml += renderRecGroup('Skills to highlight', rec.skills_to_highlight);
  }
  if (rec?.skills_to_acquire?.length) {
    recHtml += renderRecGroup('Skills to acquire', rec.skills_to_acquire);
  }
  els.recommendationsList.innerHTML = recHtml;
  els.recommendationsSection.style.display = recHtml ? 'block' : 'none';

  // Risk notes
  renderList(els.riskList, analysis.risk_notes, (item) => esc(item));
  els.riskSection.style.display = analysis.risk_notes?.length ? 'block' : 'none';

  // Remaining
  if (metadata?.remaining_today !== undefined) {
    els.resultRemaining.textContent = `${metadata.remaining_today} of 3 analyses remaining today`;
  }

  showState('result');
}

function renderList(ul, items, renderer) {
  if (!items || !items.length) {
    ul.innerHTML = '';
    return;
  }
  ul.innerHTML = items.map((item) => `<li>${renderer(item)}</li>`).join('');
}

function renderRecGroup(title, items) {
  return `<div class="rec-group"><h5>${esc(title)}</h5><ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul></div>`;
}

function esc(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---- Event listeners ----

// Google sign in
els.googleSignInBtn.addEventListener('click', async () => {
  els.googleSignInBtn.disabled = true;
  els.googleSignInBtn.textContent = 'Signing in...';

  const result = await sendMessage({ type: 'AUTH_GOOGLE' });

  if (result && result.success) {
    init(); // re-evaluate state
  } else {
    els.googleSignInBtn.disabled = false;
    els.googleSignInBtn.textContent = 'Sign in with Google';
    els.errorMessage.textContent = result?.error || 'Failed to sign in';
    lastRetryAction = null;
    showState('error');
  }
});

// Save resume
els.saveResumeBtn.addEventListener('click', async () => {
  const text = els.resumeTextarea.value.trim();
  if (!text) {
    showStatus('Please paste your resume text', 'error');
    return;
  }
  if (text.length < 50) {
    showStatus('Resume text is too short (min 50 characters)', 'error');
    return;
  }

  await ResumeDB.save(text, 'manual');
  showStatus('Resume saved!', 'success');
  setTimeout(() => init(), 500);
});

// Load resume from hh.ru page
els.loadFromPageBtn.addEventListener('click', async () => {
  if (!currentResumePageText || currentResumePageText.length < 50) {
    showStatus('Resume text is too short to load', 'error');
    return;
  }
  await ResumeDB.save(currentResumePageText, 'hh.ru');
  showStatus('Resume loaded from hh.ru!', 'success');
  setTimeout(() => init(), 500);
});

function showStatus(msg, type) {
  els.resumeStatus.textContent = msg;
  els.resumeStatus.className = `resume-status ${type}`;
  els.resumeStatus.style.display = 'block';
}

// Clear resume
els.clearResumeBtn.addEventListener('click', async () => {
  await ResumeDB.clear();
  init();
});

// Analyze
els.analyzeBtn.addEventListener('click', runAnalysis);
els.analyzeAgainBtn.addEventListener('click', runAnalysis);

// Retry
els.retryBtn.addEventListener('click', () => {
  if (lastRetryAction) {
    lastRetryAction();
  } else {
    init();
  }
});

// Sign out
els.signOutBtn.addEventListener('click', async () => {
  await sendMessage({ type: 'SIGN_OUT' });
  showState('auth');
});

// Init on popup open
init();
