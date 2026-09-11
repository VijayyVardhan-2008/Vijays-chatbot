const express = require("express");
const { GoogleGenAI } = require("@google/genai");
const Groq = require("groq-sdk");
const OpenAI = require("openai");

const app = express();
app.use(express.json());

// ==========================================
// SAFE SDK INITIALIZATION (Prevents Deployment Crashes)
// ==========================================
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "missing_key" });
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY || "missing_key" });
const openrouter = new OpenAI({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey: process.env.OPENROUTER_API_KEY || "missing_key"
});

const SYSTEM_PROMPT = 
    "You are JARVIS, an extraordinarily intelligent, polite, concise, and helpful AI assistant. " +
    "Address the user as Vijay when appropriate. Keep responses succinct, sharp, and natural for " +
    "voice output. Avoid long bulleted lists, markdown symbols, or visual formatting.";

function formatJarvisSSML(text) {
    if (!text) return `<speak><voice name="Brian"><prosody pitch="-28%" rate="88%">Standing by, Vijay.</prosody></voice></speak>`;
    const cleanText = String(text)
        .replace(/[*_#`~]/g, "")         
        .replace(/&/g, "and")            
        .replace(/</g, "")               
        .replace(/>/g, "")               
        .replace(/"/g, "")               
        .replace(/\n+/g, " ")            
        .trim();
    return `<speak><voice name="Brian"><prosody pitch="-28%" rate="88%">${cleanText}</prosody></voice></speak>`;
}

async function askGemini(prompt) {
    try {
        const fullPrompt = `${SYSTEM_PROMPT}\n\nUser Query: ${prompt}`;
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: fullPrompt
        });
        return response.text || "I processed your request, Vijay, but received no text output.";
    } catch (err) {
        console.error("[JARVIS Error - Gemini]:", err.message);
        return "I encountered a communication error with my Gemini subsystem, Vijay.";
    }
}

async function askGroq(prompt) {
    try {
        const response = await groq.chat.completions.create({
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: prompt }
            ],
            model: "llama-3.3-70b-versatile",
            temperature: 0.7,
            max_tokens: 300
        });
        return response.choices[0]?.message?.content || "Groq returned an empty response.";
    } catch (err) {
        console.error("[JARVIS Error - Groq]:", err.message);
        return "I am having difficulty connecting to my Groq primary core, Vijay.";
    }
}

async function askOpenRouter(prompt) {
    try {
        const response = await openrouter.chat.completions.create({
            model: "meta-llama/llama-3.3-70b-instruct",
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: prompt }
            ],
            temperature: 0.7,
            max_tokens: 300
        });
        return response.choices[0]?.message?.content || "OpenRouter returned an empty result.";
    } catch (err) {
        console.error("[JARVIS Error - OpenRouter]:", err.message);
        return "My OpenRouter routing layer experienced an exception, Vijay.";
    }
}

app.post("/alexa", async (req, res) => {
    try {
        const request = req.body.request;
        if (!request) return res.status(400).json({ error: "Invalid payload" });

        const requestType = request.type;

        if (requestType === "LaunchRequest") {
            return res.json({
                version: "1.0",
                response: {
                    outputSpeech: { type: "SSML", ssml: formatJarvisSSML("Online and operational, Vijay. How can I assist you today?") },
                    shouldEndSession: false
                }
            });
        }

        if (requestType === "IntentRequest") {
            const intentName = request.intent?.name;

            if (intentName === "AskJarvisIntent" || intentName === "AMAZON.FallbackIntent") {
                let userQuery = request.intent?.slots?.query?.value || "Hello";
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
                if (selectedProvider === "groq") aiReply = await askGroq(userQuery);
                else if (selectedProvider === "openrouter") aiReply = await askOpenRouter(userQuery);
                else aiReply = await askGemini(userQuery);

                return res.json({
                    version: "1.0",
                    response: {
                        outputSpeech: { type: "SSML", ssml: formatJarvisSSML(aiReply) },
                        shouldEndSession: false
                    }
                });
            }

            if (intentName === "AMAZON.StopIntent" || intentName === "AMAZON.CancelIntent") {
                return res.json({
                    version: "1.0",
                    response: {
                        outputSpeech: { type: "SSML", ssml: formatJarvisSSML("Powering down systems. Goodbye, Vijay.") },
                        shouldEndSession: true
                    }
                });
            }
        }

        return res.json({ version: "1.0", response: { shouldEndSession: true } });

    } catch (error) {
        console.error("Critical Error:", error);
        return res.json({
            version: "1.0",
            response: {
                outputSpeech: { type: "SSML", ssml: formatJarvisSSML("An unexpected failure occurred within my primary backend, Vijay.") },
                shouldEndSession: true
            }
        });
    }
});

app.get("/", (req, res) => res.send("JARVIS Core Backend is active."));

const PORT = process.env.PORT || 3000;
// BINDING TO '0.0.0.0' IS REQUIRED FOR CLOUD DEPLOYMENTS
app.listen(PORT, "0.0.0.0", () => {
    console.log(`JARVIS Server listening on port ${PORT}`);
});
