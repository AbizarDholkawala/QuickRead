// DOM Elements
const settingsBtn = document.getElementById('settingsBtn');
const formatBtns = document.querySelectorAll('.format-btn');
const summarizeBtn = document.getElementById('summarizeBtn');
const loading = document.getElementById('loading');
const resultContainer = document.getElementById('resultContainer');
const resultContent = document.getElementById('resultContent');
const copyBtn = document.getElementById('copyBtn');
const saveBtn = document.getElementById('saveBtn');
const status = document.getElementById('status');
const apiWarning = document.getElementById('apiWarning');
const setupApiBtn = document.getElementById('setupApiBtn');
const historyList = document.getElementById('historyList');
const historyEmpty = document.getElementById('historyEmpty');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');

// State
let selectedFormat = 'brief';
let currentSummary = '';
let currentPageTitle = '';
let currentPageUrl = '';

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  await checkApiKey();
  loadSavedFormat();
  loadHistory();
});

// Check if API key is configured
async function checkApiKey() {
  const result = await chrome.storage.local.get(['geminiApiKey']);
  if (!result.geminiApiKey) {
    apiWarning.classList.add('active');
    summarizeBtn.disabled = true;
  } else {
    apiWarning.classList.remove('active');
    summarizeBtn.disabled = false;
  }
}

// Load saved format preference
function loadSavedFormat() {
  chrome.storage.local.get(['summaryFormat'], (result) => {
    if (result.summaryFormat) {
      selectedFormat = result.summaryFormat;
      updateFormatButtons();
    }
  });
}

// Update format button states
function updateFormatButtons() {
  formatBtns.forEach(btn => {
    if (btn.dataset.format === selectedFormat) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

// Format button click handlers
formatBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    selectedFormat = btn.dataset.format;
    updateFormatButtons();
    chrome.storage.local.set({ summaryFormat: selectedFormat });
  });
});

// Settings button click
settingsBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage ?
    chrome.runtime.openOptionsPage() :
    window.open(chrome.runtime.getURL('settings.html'));
});

// Setup API button click
setupApiBtn.addEventListener('click', () => {
  chrome.runtime.openOptionsPage ?
    chrome.runtime.openOptionsPage() :
    window.open(chrome.runtime.getURL('settings.html'));
});

// Summarize button click
summarizeBtn.addEventListener('click', async () => {
  showStatus('', '');
  showLoading(true);
  hideResult();

  try {
    // Get the current tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab) {
      throw new Error('No active tab found');
    }

    currentPageTitle = tab.title;
    currentPageUrl = tab.url;

    // Inject and execute content script to extract text
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractPageContent
    });

    if (!results || !results[0] || !results[0].result) {
      throw new Error('Could not extract content from this page');
    }

    const pageContent = results[0].result;

    if (pageContent.length < 100) {
      throw new Error('Not enough content found on this page to summarize');
    }

    // Send to background script for summarization
    const response = await chrome.runtime.sendMessage({
      action: 'summarize',
      content: pageContent,
      format: selectedFormat,
      pageTitle: tab.title,
      pageUrl: tab.url
    });

    if (response.error) {
      throw new Error(response.error);
    }

    currentSummary = response.summary;
    showResult(response.summary, selectedFormat);

    // Auto-save the summary
    await saveSummary();
  } catch (error) {
    showStatus(error.message, 'error');
  } finally {
    showLoading(false);
  }
});

// Content extraction function (will be injected into the page)
function extractPageContent() {
  // Remove unwanted elements
  const elementsToRemove = [
    'script', 'style', 'nav', 'footer', 'header', 'aside',
    'iframe', 'noscript', '.advertisement', '.ads', '.sidebar',
    '.navigation', '.menu', '.comments', '.social-share'
  ];

  // Clone the body to avoid modifying the actual page
  const bodyClone = document.body.cloneNode(true);

  // Remove unwanted elements from clone
  elementsToRemove.forEach(selector => {
    bodyClone.querySelectorAll(selector).forEach(el => el.remove());
  });

  // Try to find main content areas
  const contentSelectors = [
    'article',
    'main',
    '[role="main"]',
    '.post-content',
    '.article-content',
    '.entry-content',
    '.content',
    '#content'
  ];

  let mainContent = null;
  for (const selector of contentSelectors) {
    const element = bodyClone.querySelector(selector);
    if (element && element.textContent.trim().length > 200) {
      mainContent = element;
      break;
    }
  }

  // Use the main content or fallback to body
  const contentElement = mainContent || bodyClone;

  // Extract and clean text
  let text = contentElement.innerText || contentElement.textContent;

  // Clean up the text
  text = text
    .replace(/\s+/g, ' ')           // Normalize whitespace
    .replace(/\n{3,}/g, '\n\n')     // Remove excessive newlines
    .trim();

  // Limit to reasonable length for API
  const maxLength = 15000;
  if (text.length > maxLength) {
    text = text.substring(0, maxLength) + '...';
  }

  return text;
}

// Copy button click
copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(currentSummary);
    copyBtn.classList.add('copied');
    copyBtn.querySelector('span').textContent = 'Copied!';

    setTimeout(() => {
      copyBtn.classList.remove('copied');
      copyBtn.querySelector('span').textContent = 'Copy';
    }, 2000);
  } catch (error) {
    showStatus('Failed to copy to clipboard', 'error');
  }
});

// Save button click
saveBtn.addEventListener('click', async () => {
  await saveSummary(true);
});

// Save summary function (showFeedback controls UI feedback)
async function saveSummary(showFeedback = false) {
  if (!currentSummary) return;

  try {
    const result = await chrome.storage.local.get(['summaryHistory']);
    const history = result.summaryHistory || [];

    // Check if this exact summary already exists (avoid duplicates)
    const exists = history.some(item =>
      item.summary === currentSummary && item.url === currentPageUrl
    );

    if (exists) {
      if (showFeedback) {
        saveBtn.classList.add('saved');
        saveBtn.querySelector('span').textContent = 'Already Saved';
        setTimeout(() => {
          saveBtn.classList.remove('saved');
          saveBtn.querySelector('span').textContent = 'Save';
        }, 2000);
      }
      return;
    }

    // Create new history item
    const newItem = {
      id: Date.now(),
      title: currentPageTitle || 'Untitled Page',
      url: currentPageUrl,
      summary: currentSummary,
      format: selectedFormat,
      timestamp: new Date().toISOString()
    };

    // Add to beginning of array (most recent first)
    history.unshift(newItem);

    // Limit history to 20 items
    if (history.length > 20) {
      history.pop();
    }

    await chrome.storage.local.set({ summaryHistory: history });

    // Update UI with feedback if requested
    if (showFeedback) {
      saveBtn.classList.add('saved');
      saveBtn.querySelector('span').textContent = 'Saved!';

      setTimeout(() => {
        saveBtn.classList.remove('saved');
        saveBtn.querySelector('span').textContent = 'Save';
      }, 2000);
    }

    // Refresh history display
    loadHistory();
  } catch (error) {
    if (showFeedback) {
      showStatus('Failed to save summary', 'error');
    }
  }
}

// Load and display history
async function loadHistory() {
  const result = await chrome.storage.local.get(['summaryHistory']);
  const history = result.summaryHistory || [];

  if (history.length === 0) {
    historyEmpty.classList.remove('hidden');
    historyList.innerHTML = '';
    return;
  }

  historyEmpty.classList.add('hidden');
  historyList.innerHTML = history.map(item => {
    const date = new Date(item.timestamp);
    const formattedDate = formatDate(date);
    const preview = item.summary.substring(0, 100).replace(/\n/g, ' ') + '...';

    return `
      <div class="history-item" data-id="${item.id}">
        <div class="history-item-content">
          <div class="history-item-title">${escapeHtml(item.title)}</div>
          <div class="history-item-preview">${escapeHtml(preview)}</div>
          <div class="history-item-meta">
            <span class="history-item-format">${item.format}</span>
            <span class="history-item-date">${formattedDate}</span>
          </div>
        </div>
        <button class="history-item-delete" data-id="${item.id}" title="Delete">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </button>
      </div>
    `;
  }).join('');

  // Add click handlers for history items
  document.querySelectorAll('.history-item').forEach(item => {
    item.addEventListener('click', (e) => {
      // Don't trigger if clicking delete button
      if (e.target.closest('.history-item-delete')) return;

      const id = parseInt(item.dataset.id);
      loadHistoryItem(id);
    });
  });

  // Add click handlers for delete buttons
  document.querySelectorAll('.history-item-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = parseInt(btn.dataset.id);
      deleteHistoryItem(id);
    });
  });
}

// Load a specific history item
async function loadHistoryItem(id) {
  const result = await chrome.storage.local.get(['summaryHistory']);
  const history = result.summaryHistory || [];
  const item = history.find(h => h.id === id);

  if (item) {
    currentSummary = item.summary;
    currentPageTitle = item.title;
    currentPageUrl = item.url;
    selectedFormat = item.format;
    updateFormatButtons();
    showResult(item.summary, item.format);
    showStatus(`Loaded: ${item.title}`, 'success');
  }
}

// Delete a history item
async function deleteHistoryItem(id) {
  const result = await chrome.storage.local.get(['summaryHistory']);
  let history = result.summaryHistory || [];

  history = history.filter(item => item.id !== id);

  await chrome.storage.local.set({ summaryHistory: history });
  loadHistory();
}

// Clear all history
clearHistoryBtn.addEventListener('click', async () => {
  if (confirm('Clear all saved summaries?')) {
    await chrome.storage.local.set({ summaryHistory: [] });
    loadHistory();
  }
});

// Helper functions
function showLoading(show) {
  loading.classList.toggle('active', show);
  summarizeBtn.disabled = show;
}

function showStatus(message, type) {
  status.textContent = message;
  status.className = 'status';
  if (type) {
    status.classList.add(type);
  }
}

function showResult(summary, format) {
  resultContainer.classList.add('active');

  // Format the summary based on type
  if (format === 'bullets') {
    // Convert to bullet list if not already
    const lines = summary.split('\n').filter(line => line.trim());
    const listItems = lines.map(line => {
      // Remove existing bullet markers
      const cleanLine = line.replace(/^[\-\*\•]\s*/, '').trim();
      return `<li>${escapeHtml(cleanLine)}</li>`;
    }).join('');
    resultContent.innerHTML = `<ul>${listItems}</ul>`;
  } else {
    // For brief and detailed, show as paragraphs
    const paragraphs = summary.split('\n\n').filter(p => p.trim());
    resultContent.innerHTML = paragraphs.map(p => `<p>${escapeHtml(p.trim())}</p>`).join('');
  }
}

function hideResult() {
  resultContainer.classList.remove('active');
}

function formatDate(date) {
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString();
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
