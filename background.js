// Background service worker for QuickRead

// Listen for messages from popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'summarize') {
        handleSummarize(request)
            .then(sendResponse)
            .catch(error => sendResponse({ error: error.message }));
        return true; // Required for async response
    }

    if (request.action === 'testApiKey') {
        testApiKey(request.apiKey)
            .then(sendResponse)
            .catch(error => sendResponse({ error: error.message }));
        return true;
    }
});

// Handle summarization request
async function handleSummarize(request) {
    const { content, format, pageTitle, pageUrl } = request;

    // Get API key from storage
    const result = await chrome.storage.local.get(['geminiApiKey']);
    const apiKey = result.geminiApiKey;

    if (!apiKey) {
        throw new Error('API key not configured. Please add your Gemini API key in settings.');
    }

    // Create format-specific prompt
    const prompt = createPrompt(content, format, pageTitle);

    // Call Gemini API
    const summary = await callGeminiAPI(apiKey, prompt);

    return { summary };
}

// Create prompt based on format
function createPrompt(content, format, pageTitle) {
    const baseContext = `You are a helpful assistant that summarizes web content. The following is content from a webpage${pageTitle ? ` titled "${pageTitle}"` : ''}.`;

    let formatInstruction = '';

    switch (format) {
        case 'brief':
            formatInstruction = `Provide a very concise summary in 2-3 sentences. Focus on the main point and key takeaway. Be direct and to the point.`;
            break;
        case 'bullets':
            formatInstruction = `Summarize the content as a bullet-point list with 5-8 key points. Each bullet should be a complete, standalone piece of information. Start each point with a dash (-).`;
            break;
        case 'detailed':
            formatInstruction = `Provide a comprehensive summary in 3-4 paragraphs. Cover the main topics, supporting details, and conclusions. Maintain the logical flow of the original content.`;
            break;
        default:
            formatInstruction = `Provide a concise summary.`;
    }

    return `${baseContext}

${formatInstruction}

Content to summarize:
${content}

Summary:`;
}

// Call Gemini API
async function callGeminiAPI(apiKey, prompt) {
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const requestBody = {
        contents: [
            {
                parts: [
                    {
                        text: prompt
                    }
                ]
            }
        ],
        generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 1024,
            topP: 0.9,
            topK: 40
        },
        safetySettings: [
            {
                category: "HARM_CATEGORY_HARASSMENT",
                threshold: "BLOCK_ONLY_HIGH"
            },
            {
                category: "HARM_CATEGORY_HATE_SPEECH",
                threshold: "BLOCK_ONLY_HIGH"
            },
            {
                category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
                threshold: "BLOCK_ONLY_HIGH"
            },
            {
                category: "HARM_CATEGORY_DANGEROUS_CONTENT",
                threshold: "BLOCK_ONLY_HIGH"
            }
        ]
    };

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorData = await response.json();
            const errorMessage = errorData.error?.message || `API request failed with status ${response.status}`;
            throw new Error(errorMessage);
        }

        const data = await response.json();

        if (!data.candidates || !data.candidates[0]?.content?.parts?.[0]?.text) {
            throw new Error('Invalid response from Gemini API');
        }

        return data.candidates[0].content.parts[0].text.trim();
    } catch (error) {
        if (error.message.includes('API_KEY_INVALID')) {
            throw new Error('Invalid API key. Please check your Gemini API key in settings.');
        }
        if (error.message.includes('QUOTA_EXCEEDED')) {
            throw new Error('API quota exceeded. Please try again later or check your API key limits.');
        }
        if (error.message.includes('Failed to fetch')) {
            throw new Error('Network error. Please check your internet connection.');
        }
        throw error;
    }
}

// Test API key validity
async function testApiKey(apiKey) {
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

    const testRequest = {
        contents: [
            {
                parts: [
                    {
                        text: "Say 'API key is valid' in exactly 4 words."
                    }
                ]
            }
        ],
        generationConfig: {
            temperature: 0,
            maxOutputTokens: 20
        }
    };

    try {
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(testRequest)
        });

        if (!response.ok) {
            const errorData = await response.json();
            const errorCode = errorData.error?.status || 'UNKNOWN_ERROR';
            const errorMessage = errorData.error?.message || 'Unknown error occurred';

            return {
                valid: false,
                errorCode,
                errorMessage
            };
        }

        return { valid: true };
    } catch (error) {
        return {
            valid: false,
            errorCode: 'NETWORK_ERROR',
            errorMessage: error.message
        };
    }
}
