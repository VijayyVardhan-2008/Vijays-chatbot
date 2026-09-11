require("dotenv").config();

const express = require("express");
const path = require("path");
const { GoogleGenAI } = require("@google/genai");

const app = express();
const PORT = process.env.PORT || 3000;

/* =========================================
   MIDDLEWARE
========================================= */

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));


/* =========================================
   CHECK API KEYS & STARTUP LOGS
========================================= */

console.log("");
console.log("=================================");
console.log("        VIJAY'S JARVIS CHATBOT");
console.log("=================================");

console.log(
    "Gemini API:",
    process.env.GEMINI_API_KEY ? "✅ Loaded" : "❌ Missing"
);

console.log(
    "Groq API:",
    process.env.GROQ_API_KEY ? "✅ Loaded" : "❌ Missing"
);

console.log(
    "OpenRouter API:",
    process.env.OPENROUTER_API_KEY ? "✅ Loaded" : "❌ Missing"
);

console.log("=================================");
console.log("");


/* =========================================
   SDK INITIALIZATION
========================================= */

const gemini = process.env.GEMINI_API_KEY
    ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
    : null;

const SYSTEM_PROMPT = 
    "You are JARVIS, an extraordinarily intelligent, polite, concise, and helpful AI assistant. " +
    "Address the user as Vijay when appropriate. Keep responses succinct, sharp, and natural for " +
    "voice and text output.";


/* =========================================
   SSML FORMATTER (For Alexa Echo Dot)
========================================= */

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


/* =========================================
   AI FUNCTIONS
========================================= */

async function askGemini(message) {
    if (!gemini) throw new Error("GEMINI_API_KEY is missing from .env");

    const response = await gemini.models.generateContent({
        model: "gemini-2.5-flash",
        contents: `${SYSTEM_PROMPT}\n\nUser: ${message}`
    });

    return response.text || "Gemini returned no response.";
}

async function askGroq(message) {
    if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY is missing from .env");

    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${process.env.GROQ_API_KEY}`
        },
        body: JSON.stringify({
            model: "llama-3.3-70b-versatile",
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: message }
            ],
            temperature: 0.7
        })
    });

    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.error?.message || "Groq API request failed");
    }

    return data.choices?.[0]?.message?.content || "Groq returned no response.";
}

async function askOpenRouter(message) {
    if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is missing from .env");

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
            "HTTP-Referer": "http://localhost:3000",
            "X-Title": "Vijay's Jarvis Chatbot"
        },
        body: JSON.stringify({
            model: "meta-llama/llama-3.3-70b-instruct",
            messages: [
                { role: "system", content: SYSTEM_PROMPT },
                { role: "user", content: message }
            ]
        })
    });

    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.error?.message || "OpenRouter API request failed");
    }

    return data.choices?.[0]?.message?.content || "OpenRouter returned no response.";
}


/* =========================================
   WEB CHAT ROUTE (/chat)
========================================= */

app.post("/chat", async (req, res) => {
    try {
        const { message, provider = "gemini" } = req.body;

        console.log(`\n📩 /chat request [${provider}]: ${message}`);

        if (!message) {
            return res.status(400).json({ error: "Message is required." });
        }

        let reply = "";
        if (provider === "groq") {
            reply = await askGroq(message);
        } else if (provider === "openrouter") {
            reply = await askOpenRouter(message);
        } else {
            reply = await askGemini(message);
        }

        console.log(`✅ ${provider} responded successfully`);
        return res.json({ reply, provider });

    } catch (error) {
        console.error("\n❌ CHAT ERROR:", error.message);
        return res.status(500).json({ error: error.message || "Something went wrong." });
    }
});


/* =========================================
   ALEXA SKILL ROUTE (/alexa)
========================================= */

app.post("/alexa", async (req, res) => {
    try {
        const request = req.body.request;
        if (!request) return res.status(400).json({ error: "Invalid Alexa payload" });

        const requestType = request.type;
        console.log(`\n🗣️ Alexa request received: ${requestType}`);

        if (requestType === "LaunchRequest") {
            const welcomeMsg = "Online and operational, Vijay. How can I assist you today?";
            return res.json({
                version: "1.0",
                response: {
                    outputSpeech: { type: "SSML", ssml: formatJarvisSSML(welcomeMsg) },
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
        console.error("\n❌ ALEXA ERROR:", error.message);
        return res.json({
            version: "1.0",
            response: {
                outputSpeech: { type: "SSML", ssml: formatJarvisSSML("An unexpected failure occurred within my core systems, Vijay.") },
                shouldEndSession: true
            }
        });
    }
});


/* =========================================
   START SERVER
========================================= */

app.listen(PORT, "0.0.0.0", () => {
    console.log("");
    console.log(`🌐 Server active at http://localhost:${PORT}`);
    console.log("=================================");
    console.log("🤖 Gemini + Groq + OpenRouter + Alexa");
    console.log("=================================");
    console.log("");
});
