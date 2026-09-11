const express = require('express');
const { GoogleGenAI } = require('@google/genai');
const Groq = require('groq-sdk');
const OpenAI = require('openai');

const app = express();
app.use(express.json());

// Initialize AI Clients using process.env
const ai = new GoogleGenAI(); // Automatically uses process.env.GEMINI_API_KEY
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const openrouter = new OpenAI({
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY
});

// SSML Formatter for deep JARVIS voice
function formatJarvisSSML(text) {
    const cleanText = String(text)
        .replace(/[*_#`]/g, "")           // Remove Markdown
        .replace(/&/g, "and")             // Replace ampersands
        .replace(/</g, "")                // Remove opening brackets
        .replace(/>/g, "")                // Remove closing brackets
        .replace(/"/g, "")                // Remove double quotes
        .trim();

    return `<speak><voice name="Brian"><prosody pitch="-28%" rate="88%">${cleanText}</prosody></voice></speak>`;
}

// AI API Callers
async function askGemini(prompt) {
    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
                systemInstruction: "You are JARVIS, a highly intelligent, polite, concise AI assistant. Keep responses brief and suitable for voice speech."
            }
        });
        return response.text;
    } catch (err) {
        console.error("Gemini Error:", err);
        return "I encountered an issue connecting to Gemini, sir.";
    }
}

async function askGroq(prompt) {
    try {
        const response = await groq.chat.completions.create({
            messages: [
                { role: 'system', content: 'You are JARVIS, a highly intelligent, concise AI assistant.' },
                { role: 'user', content: prompt }
            ],
            model: 'llama-3.3-70b-versatile',
        });
        return response.choices[0]?.message?.content || "No response received from Groq.";
    } catch (err) {
        console.error("Groq Error:", err);
        return "I encountered an issue connecting to Groq, sir.";
    }
}

async function askOpenRouter(prompt) {
    try {
        const response = await openrouter.chat.completions.create({
            model: 'meta-llama/llama-3.3-70b-instruct',
            messages: [
                { role: 'system', content: 'You are JARVIS, a highly intelligent, concise AI assistant.' },
                { role: 'user', content: prompt }
            ]
        });
        return response.choices[0]?.message?.content || "No response received from OpenRouter.";
    } catch (err) {
        console.error("OpenRouter Error:", err);
        return "I encountered an issue connecting to OpenRouter, sir.";
    }
}

// Main Alexa Endpoint
app.post('/alexa', async (req, res) => {
    try {
        const requestType = req.body.request.type;

        // 1. LaunchRequest ("Alexa, open My Jarvis")
        if (requestType === "LaunchRequest") {
            return res.json({
                version: "1.0",
                response: {
                    outputSpeech: {
                        type: "SSML",
                        ssml: formatJarvisSSML("Online and operational, Vijay. How can I assist you today?")
                    },
                    shouldEndSession: false
                }
            });
        }

        // 2. IntentRequest & Fallback Handler
        if (requestType === "IntentRequest") {
            const intentName = req.body.request.intent?.name;

            if (intentName === "AskJarvisIntent" || intentName === "AMAZON.FallbackIntent") {
                let userQuery = req.body.request.intent?.slots?.query?.value || "Hello";
                let selectedProvider = "gemini";

                const lowerQuery = userQuery.toLowerCase();

                if (lowerQuery.includes("groq")) {
                    selectedProvider = "groq";
                    userQuery = userQuery.replace(/ask groq|use groq|groq/gi, "").trim();
                } else if (lowerQuery.includes("openrouter")) {
                    selectedProvider = "openrouter";
                    userQuery = userQuery.replace(/ask openrouter|use openrouter|openrouter/gi, "").trim();
                } else if (lowerQuery.includes("gemini")) {
                    selectedProvider = "gemini";
                    userQuery = userQuery.replace(/ask gemini|use gemini|gemini/gi, "").trim();
                }

                if (!userQuery) userQuery = "Hello";

                let aiReply = "";
                if (selectedProvider === "groq") {
                    aiReply = await askGroq(userQuery);
                } else if (selectedProvider === "openrouter") {
                    aiReply = await askOpenRouter(userQuery);
                } else {
                    aiReply = await askGemini(userQuery);
                }

                return res.json({
                    version: "1.0",
                    response: {
                        outputSpeech: {
                            type: "SSML",
                            ssml: formatJarvisSSML(aiReply)
                        },
                        shouldEndSession: false
                    }
                });
            }

            // Cancel / Stop Intents
            if (intentName === "AMAZON.StopIntent" || intentName === "AMAZON.CancelIntent") {
                return res.json({
                    version: "1.0",
                    response: {
                        outputSpeech: {
                            type: "SSML",
                            ssml: formatJarvisSSML("Going offline. Goodbye, Vijay.")
                        },
                        shouldEndSession: true
                    }
                });
            }
        }

        // Default response for SessionEndedRequest or other unhandled types
        return res.json({
            version: "1.0",
            response: {
                shouldEndSession: true
            }
        });

    } catch (error) {
        console.error("Server Error:", error);
        return res.json({
            version: "1.0",
            response: {
                outputSpeech: {
                    type: "SSML",
                    ssml: formatJarvisSSML("An unexpected error occurred in my core systems.")
                },
                shouldEndSession: true
            }
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`JARVIS backend running on port ${PORT}`);
});
