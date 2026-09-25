require("dotenv").config();

const express = require("express");
const path = require("path");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const os = require("os");

const { GoogleGenAI } = require("@google/genai");

const app = express();
const PORT = process.env.PORT || 3000;

// =========================================================
// STARTUP
// =========================================================

console.log("");
console.log("========================================");
console.log("       VIJAY'S CHATBOT + Cortex");
console.log("========================================");

console.log(
    "Gemini API:",
    process.env.GEMINI_API_KEY ? "✅ Loaded" : "❌ Missing"
);

console.log(
    "Groq API:",
    process.env.GROQ_API_KEY ? "✅ Loaded" : "⚠️ Missing"
);

console.log(
    "OpenRouter API:",
    process.env.OPENROUTER_API_KEY ? "✅ Loaded" : "⚠️ Missing"
);

console.log(
    "ElevenLabs API:",
    process.env.ELEVENLABS_API_KEY ? "✅ Loaded" : "❌ Missing"
);

console.log(
    "ElevenLabs Voice ID:",
    process.env.ELEVENLABS_VOICE_ID ? "✅ Loaded" : "❌ Missing"
);

console.log("========================================");
console.log("");

// =========================================================
// CORS
// =========================================================

app.use(
    cors({
        origin: true,
        methods: ["GET", "POST", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization"]
    })
);

// =========================================================
// BODY PARSING
// =========================================================

app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({
    extended: true,
    limit: "20mb"
}));

// =========================================================
// FRONTEND
// =========================================================

app.use(express.static(path.join(__dirname, "public")));

// =========================================================
// PWA MANIFEST
// =========================================================

app.get("/manifest.json", (req, res) => {

    const manifestPath =
        path.join(__dirname, "public", "manifest.json");

    if (!fs.existsSync(manifestPath)) {
        return res.status(404).json({
            error: "manifest.json not found"
        });
    }

    res.setHeader(
        "Content-Type",
        "application/manifest+json"
    );

    res.sendFile(manifestPath);
});

// =========================================================
// GEMINI
// =========================================================

const gemini = process.env.GEMINI_API_KEY
    ? new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY
    })
    : null;

// =========================================================
// FILE UPLOAD
// =========================================================

const upload = multer({

    dest: path.join(
        os.tmpdir(),
        "vijays-chatbot"
    ),

    limits: {
        fileSize: 100 * 1024 * 1024
    }
});

// =========================================================
// HISTORY HELPERS
// =========================================================

function cleanHistory(history) {

    if (!Array.isArray(history)) {
        return [];
    }

    return history
        .filter(item =>
            item &&
            (
                item.role === "user" ||
                item.role === "assistant"
            ) &&
            typeof item.content === "string" &&
            item.content.trim()
        )
        .slice(-40);
}


function historyForOpenAIStyle(history) {

    return cleanHistory(history).map(item => ({

        role:
            item.role === "assistant"
                ? "assistant"
                : "user",

        content: item.content
    }));
}

// =========================================================
// Cortex SSML
// =========================================================

function formatCortexSSML(text) {

    const cleanText = String(text)
        .replace(/[*_#`]/g, "")
        .replace(/&/g, "and")
        .replace(/</g, "")
        .replace(/>/g, "")
        .trim();

    return (
        `<speak>` +
        `<voice name="Matthew">` +
        `<prosody pitch="-30%" rate="88%">` +
        `${cleanText}` +
        `</prosody>` +
        `</voice>` +
        `</speak>`
    );
}

// =========================================================
// GEMINI CHAT
// =========================================================

async function askGemini(
    message,
    history,
    attachments = []
) {

    if (!gemini) {
        throw new Error(
            "GEMINI_API_KEY is missing."
        );
    }

    const contents = [];

    for (const item of cleanHistory(history)) {

        contents.push({

            role:
                item.role === "assistant"
                    ? "model"
                    : "user",

            parts: [
                {
                    text: item.content
                }
            ]
        });
    }

    const currentParts = [];

    if (message) {

        currentParts.push({
            text: message
        });
    }

    for (const attachment of attachments) {

        if (
            attachment &&
            attachment.fileUri &&
            attachment.mimeType
        ) {

            currentParts.push({

                fileData: {

                    fileUri:
                        attachment.fileUri,

                    mimeType:
                        attachment.mimeType
                }
            });
        }
    }

    contents.push({

        role: "user",

        parts: currentParts
    });

    const response =
        await gemini.models.generateContent({

            model:
                "gemini-3.6-flash",

            contents
        });

    return (
        response.text ||
        "Gemini returned no response."
    );
}

// =========================================================
// GROQ CHAT
// =========================================================

async function askGroq(
    message,
    history
) {

    if (!process.env.GROQ_API_KEY) {

        throw new Error(
            "GROQ_API_KEY is missing."
        );
    }

    const messages =
        historyForOpenAIStyle(history);

    messages.push({

        role: "user",

        content: message
    });

    const response = await fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {

            method: "POST",

            headers: {

                "Content-Type":
                    "application/json",

                "Authorization":
                    `Bearer ${process.env.GROQ_API_KEY}`
            },

            body: JSON.stringify({

                model:
                    "openai/gpt-oss-120b",

                messages,

                temperature: 0.7
            })
        }
    );

    const data =
        await response.json();

    if (!response.ok) {

        throw new Error(
            data.error?.message ||
            "Groq API request failed."
        );
    }

    return (
        data.choices?.[0]?.message?.content ||
        "Groq returned no response."
    );
}

// =========================================================
// OPENROUTER CHAT
// =========================================================

async function askOpenRouter(
    message,
    history
) {

    if (!process.env.OPENROUTER_API_KEY) {

        throw new Error(
            "OPENROUTER_API_KEY is missing."
        );
    }

    const messages =
        historyForOpenAIStyle(history);

    messages.push({

        role: "user",

        content: message
    });

    const response = await fetch(
        "https://openrouter.ai/api/v1/chat/completions",
        {

            method: "POST",

            headers: {

                "Content-Type":
                    "application/json",

                "Authorization":
                    `Bearer ${process.env.OPENROUTER_API_KEY}`,

                "HTTP-Referer":
                    "https://vijays-chatbot.onrender.com",

                "X-Title":
                    "Vijay's Chatbot"
            },

            body: JSON.stringify({

                model:
                    "openrouter/free",

                messages
            })
        }
    );

    const data =
        await response.json();

    if (!response.ok) {

        throw new Error(
            data.error?.message ||
            "OpenRouter API request failed."
        );
    }

    return (
        data.choices?.[0]?.message?.content ||
        "OpenRouter returned no response."
    );
}

// =========================================================
// 🔥 ELEVENLABS Cortex VOICE
// =========================================================

app.post("/speak", async (req, res) => {

    try {

        const { text } = req.body;

        if (!text) {

            return res.status(400).json({

                error:
                    "Text is required."
            });
        }

        if (!process.env.ELEVENLABS_API_KEY) {

            return res.status(500).json({

                error:
                    "ELEVENLABS_API_KEY is missing."
            });
        }

        if (!process.env.ELEVENLABS_VOICE_ID) {

            return res.status(500).json({

                error:
                    "ELEVENLABS_VOICE_ID is missing."
            });
        }

        console.log("");
        console.log(
            "🔊 Cortex speaking:",
            text
        );

        const url =
            `https://api.elevenlabs.io/v1/text-to-speech/${process.env.ELEVENLABS_VOICE_ID}`;

        const response =
            await fetch(
                url,
                {

                    method: "POST",

                    headers: {

                        "xi-api-key":
                            process.env.ELEVENLABS_API_KEY,

                        "Content-Type":
                            "application/json"
                    },

                    body: JSON.stringify({

                        text: text,

                        model_id:
                            "eleven_multilingual_v2",

                        voice_settings: {

                            stability:
                                0.55,

                            similarity_boost:
                                0.80,

                            style:
                                0.25,

                            use_speaker_boost:
                                true
                        },

                        output_format:
                            "mp3_44100_128"
                    })
                }
            );

        if (!response.ok) {

            const errorText =
                await response.text();

            console.error(
                "❌ ElevenLabs:",
                errorText
            );

            throw new Error(
                `ElevenLabs error: ${response.status}`
            );
        }

        const audioBuffer =
            Buffer.from(
                await response.arrayBuffer()
            );

        res.setHeader(
            "Content-Type",
            "audio/mpeg"
        );

        res.setHeader(
            "Content-Length",
            audioBuffer.length
        );

        res.send(audioBuffer);

    } catch (error) {

        console.error(
            "❌ Cortex VOICE ERROR:",
            error
        );

        res.status(500).json({

            error:
                error.message ||
                "Voice generation failed."
        });
    }
});

// =========================================================
// FILE UPLOAD
// =========================================================

app.post(
    "/upload",
    upload.single("file"),
    async (req, res) => {

        let uploadedPath = null;

        try {

            if (!req.file) {

                return res.status(400).json({

                    error:
                        "No file was uploaded."
                });
            }

            uploadedPath =
                req.file.path;

            const mimeType =
                req.file.mimetype;

            const originalName =
                req.file.originalname;

            console.log("");
            console.log(
                "📎 FILE UPLOAD:",
                originalName
            );

            if (!gemini) {

                throw new Error(
                    "Gemini API is not configured."
                );
            }

            const uploaded =
                await gemini.files.upload({

                    file:
                        uploadedPath,

                    config: {
                        mimeType:
                            mimeType
                    }
                });

            try {

                fs.unlinkSync(
                    uploadedPath
                );

            } catch {}

            return res.json({

                success: true,

                name:
                    originalName,

                mimeType:
                    mimeType,

                size:
                    req.file.size,

                fileUri:
                    uploaded.uri,

                fileName:
                    uploaded.name
            });

        } catch (error) {

            console.error(
                "❌ Upload error:",
                error
            );

            if (uploadedPath) {

                try {

                    fs.unlinkSync(
                        uploadedPath
                    );

                } catch {}
            }

            return res.status(500).json({

                error:
                    error.message ||
                    "File upload failed."
            });
        }
    }
);

// =========================================================
// CHAT ENDPOINT
// =========================================================

app.post(
    "/chat",
    async (req, res) => {

        try {

            const {
                message,
                provider,
                history = [],
                attachments = []
            } = req.body;

            if (
                !message &&
                (
                    !attachments ||
                    attachments.length === 0
                )
            ) {

                return res.status(400).json({

                    error:
                        "Message or attachment is required."
                });
            }

            const selectedProvider =
                provider || "gemini";

            let reply;

            // -------------------------
            // GEMINI
            // -------------------------

            if (
                selectedProvider === "gemini"
            ) {

                reply =
                    await askGemini(
                        message || "",
                        history,
                        attachments
                    );
            }

            // -------------------------
            // GROQ
            // -------------------------

            else if (
                selectedProvider === "groq"
            ) {

                let groqMessage =
                    message || "";

                if (
                    attachments &&
                    attachments.length > 0
                ) {

                    groqMessage +=
                        `\n\n[The user attached ${attachments.length} file(s).]`;
                }

                reply =
                    await askGroq(
                        groqMessage,
                        history
                    );
            }

            // -------------------------
            // OPENROUTER
            // -------------------------

            else if (
                selectedProvider === "openrouter"
            ) {

                let routerMessage =
                    message || "";

                if (
                    attachments &&
                    attachments.length > 0
                ) {

                    routerMessage +=
                        `\n\n[The user attached ${attachments.length} file(s).]`;
                }

                reply =
                    await askOpenRouter(
                        routerMessage,
                        history
                    );
            }

            // -------------------------
            // UNKNOWN PROVIDER
            // -------------------------

            else {

                return res.status(400).json({

                    error:
                        "Unknown AI provider: " +
                        selectedProvider
                });
            }

            console.log(
                `✅ ${selectedProvider} responded`
            );

            return res.json({

                reply,

                provider:
                    selectedProvider,

                success: true
            });

        } catch (error) {

            console.error(
                "❌ AI ERROR:",
                error.message
            );

            return res.status(500).json({

                error:
                    error.message ||
                    "Something went wrong."
            });
        }
    }
);

// =========================================================
// ALEXA ENDPOINT
// =========================================================

app.post("/alexa", async (req, res) => {

    try {

        const request =
            req.body.request;

        if (!request) {

            return res.status(400).json({

                error:
                    "Invalid Alexa payload"
            });
        }

        const requestType =
            request.type;

        console.log(
            `🗣️ Alexa request: ${requestType}`
        );

        // -------------------------
        // LAUNCH
        // -------------------------

        if (
            requestType ===
            "LaunchRequest"
        ) {

            const welcomeMsg =
                "Online and operational, Vijay. How can I assist you today?";

            return res.json({

                version: "1.0",

                response: {

                    outputSpeech: {

                        type: "SSML",

                        ssml:
                            formatCortexSSML(
                                welcomeMsg
                            )
                    },

                    shouldEndSession:
                        false
                }
            });
        }

        // -------------------------
        // INTENT
        // -------------------------

        if (
            requestType ===
            "IntentRequest"
        ) {

            const intentName =
                request.intent?.name;

            console.log(
                `🎯 Intent: ${intentName}`
            );

            let userQuery =
                "Hello Cortex";

            if (
                request.intent?.slots
            ) {

                for (
                    const slotKey
                    of Object.keys(
                        request.intent.slots
                    )
                ) {

                    const value =
                        request.intent
                            .slots[slotKey]
                            ?.value;

                    if (value) {

                        userQuery =
                            value;

                        break;
                    }
                }
            }

            console.log(
                `💬 Alexa query: "${userQuery}"`
            );

            let aiReply =
                `I am processing your request about ${userQuery}, Vijay.`;

            try {

                aiReply =
                    await askGemini(
                        userQuery,
                        [],
                        []
                    );

            } catch (aiErr) {

                console.error(
                    "❌ Alexa AI error:",
                    aiErr
                );

                aiReply =
                    "Systems nominal, Vijay. I am ready for your next command.";
            }

            return res.json({

                version: "1.0",

                response: {

                    outputSpeech: {

                        type: "SSML",

                        ssml:
                            formatCortexSSML(
                                aiReply
                            )
                    },

                    shouldEndSession:
                        false
                }
            });
        }

        // -------------------------
        // SESSION END
        // -------------------------

        if (
            requestType ===
            "SessionEndedRequest"
        ) {

            return res.json({

                version: "1.0",

                response: {

                    shouldEndSession:
                        true
                }
            });
        }

        return res.json({

            version: "1.0",

            response: {

                outputSpeech: {

                    type: "SSML",

                    ssml:
                        formatCortexSSML(
                            "I am listening, Vijay."
                        )
                },

                shouldEndSession:
                    false
            }
        });

    } catch (error) {

        console.error(
            "❌ ALEXA ERROR:",
            error.message
        );

        return res.json({

            version: "1.0",

            response: {

                outputSpeech: {

                    type: "SSML",

                    ssml:
                        formatCortexSSML(
                            "Core systems operational, Vijay."
                        )
                },

                shouldEndSession:
                    false
            }
        });
    }
});

// =========================================================
// HEALTH CHECK
// =========================================================

app.get("/test", (req, res) => {

    res.json({

        status:
            "Vijay's Chatbot is online",

        Cortex:
            process.env.ELEVENLABS_API_KEY
                ? "Voice engine loaded"
                : "Voice engine missing",

        voice:
            process.env.ELEVENLABS_VOICE_ID
                ? "Voice ID loaded"
                : "Voice ID missing",

        time:
            new Date().toISOString()
    });
});

// =========================================================
// START SERVER
// =========================================================

app.listen(
    PORT,
    () => {

        console.log("");
        console.log(
            `🌐 Server running on port ${PORT}`
        );

        console.log(
            "🤖 Vijay's Chatbot: ONLINE"
        );

        console.log(
            "🧠 Gemini: READY"
        );

        console.log(
            "⚡ Groq: READY"
        );

        console.log(
            "🌐 OpenRouter: READY"
        );

        console.log(
            "🎙️ ElevenLabs Cortex Voice: READY"
        );

        console.log(
            "========================================"
        );

        console.log("");
    }
);
