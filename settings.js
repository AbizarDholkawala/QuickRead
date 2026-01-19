// DOM Elements
const apiKeyInput = document.getElementById('apiKeyInput');
const toggleVisibility = document.getElementById('toggleVisibility');
const saveBtn = document.getElementById('saveBtn');
const testBtn = document.getElementById('testBtn');
const status = document.getElementById('status');
const troubleshooting = document.getElementById('troubleshooting');

// State
let isPasswordVisible = false;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    await loadSavedApiKey();
});

// Load saved API key
async function loadSavedApiKey() {
    const result = await chrome.storage.local.get(['geminiApiKey']);
    if (result.geminiApiKey) {
        apiKeyInput.value = result.geminiApiKey;
    }
}

// Toggle password visibility
toggleVisibility.addEventListener('click', () => {
    isPasswordVisible = !isPasswordVisible;
    apiKeyInput.type = isPasswordVisible ? 'text' : 'password';

    const eyeOpen = toggleVisibility.querySelector('.eye-open');
    const eyeClosed = toggleVisibility.querySelector('.eye-closed');

    eyeOpen.style.display = isPasswordVisible ? 'none' : 'block';
    eyeClosed.style.display = isPasswordVisible ? 'block' : 'none';
});

// Save API key
saveBtn.addEventListener('click', async () => {
    const apiKey = apiKeyInput.value.trim();

    if (!apiKey) {
        showStatus('Please enter an API key', 'error');
        return;
    }

    try {
        await chrome.storage.local.set({ geminiApiKey: apiKey });
        showStatus('✓ API key saved successfully!', 'success');
        hideTroubleshooting();
    } catch (error) {
        showStatus('Failed to save API key', 'error');
    }
});

// Test API key
testBtn.addEventListener('click', async () => {
    const apiKey = apiKeyInput.value.trim();

    if (!apiKey) {
        showStatus('Please enter an API key to test', 'error');
        return;
    }

    showStatus('Testing API key...', 'loading');
    hideTroubleshooting();
    testBtn.disabled = true;

    try {
        const response = await chrome.runtime.sendMessage({
            action: 'testApiKey',
            apiKey: apiKey
        });

        if (response.valid) {
            showStatus('✓ API key is valid and working!', 'success');
            hideTroubleshooting();
        } else {
            showStatus(`✗ API key test failed: ${response.errorMessage}`, 'error');
            showTroubleshooting(response.errorCode);
        }
    } catch (error) {
        showStatus(`✗ Test failed: ${error.message}`, 'error');
        showTroubleshooting('NETWORK_ERROR');
    } finally {
        testBtn.disabled = false;
    }
});

// Helper functions
function showStatus(message, type) {
    status.textContent = message;
    status.className = 'status';
    status.classList.add(type);
}

function showTroubleshooting(errorCode) {
    troubleshooting.classList.add('active');

    // Hide all error cards first
    document.querySelectorAll('.troubleshoot-card').forEach(card => {
        card.classList.remove('active');
    });

    // Show the relevant error card
    const errorCard = document.getElementById(`error-${errorCode}`);
    if (errorCard) {
        errorCard.classList.add('active');
        document.querySelector('.troubleshoot-cards').style.display = 'block';
    }
}

function hideTroubleshooting() {
    document.querySelectorAll('.troubleshoot-card').forEach(card => {
        card.classList.remove('active');
    });
}

// Handle Enter key on input
apiKeyInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        saveBtn.click();
    }
});
