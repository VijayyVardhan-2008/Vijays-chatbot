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


/* =========================================================
   CORS
========================================================= */

app.use(cors({
    origin: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
}));


/* =========================================================
   MIDDLEWARE & FRONTEND SERVING
========================================================= */

app.use(express.json({
    limit: "20mb"
}));

app.use(express.urlencoded({
    extended: true,
    limit: "20mb"
}));

// Serve static files from the public folder
app.use(express.static(path.join(__dirname, "public")));

// Explicit route for manifest.json with strict PWA headers
app.get("/manifest.json", (req, res) => {
    res.setHeader("Content-Type", "application/manifest+json");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.sendFile(path.join(__dirname, "public", "manifest.json"));
});

// Root route - serve index.html
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});


/* =========================================================
   UPLOAD SETUP
========================================================= */

const upload = multer({
    dest: path.join(
        os.tmpdir(),
        "vijays-chatbot"
    ),

    limits: {
        fileSize: 100 * 1024 * 1024
    }
});


/* =========================================================
   API KEY STATUS
========================================================= */

console.log("");
console.log("=================================");
console.log("       VIJAY'S CHATBOT");
console.log("=================================");

console.log(
    "Gemini API:",
    process.env.GEMINI_API_KEY
        ? "✅ Loaded"
        : "❌ Missing"
);

console.log(
    "Groq API:",
    process.env.GROQ_API_KEY
        ? "✅ Loaded"
        : "❌ Missing"
);

console.log(
    "OpenRouter API:",
    process.env.OPENROUTER_API_KEY
        ? "✅ Loaded"
        : "❌ Missing"
);

console.log("=================================");
console.log("");


/* =========================================================
   GEMINI
========================================================= */

const gemini = process.env.GEMINI_API_KEY
    ? new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY
    })
    : null;


/* =========================================================
   HELPERS
========================================================= */

function cleanHistory(history) {

    if (!Array.isArray(history)) {
        return [];
    }

    return history
        .filter(item =>
            item &&
            (item.role === "user" ||
             item.role === "assistant") &&
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


/* =========================================================
   GEMINI
========================================================= */

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


    /*
       Previous conversation
    */

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


    /*
       Current user message
    */

    const currentParts = [];


    if (message) {

        currentParts.push({
            text: message
        });

    }


    /*
       Gemini attachments
    */

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

            model: "gemini-3.6-flash",

            contents: contents

        });


    return response.text ||
        "Gemini returned no response.";
}


/* =========================================================
   GROQ
========================================================= */

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
                    "openai/gpt-oss-20b",

                messages,

                temperature: 0.7

            })

        }

    );


    const data =
        await response.json();


    if (!response.ok) {

        console.error(
            "❌ Groq error:",
            data
        );

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


/* =========================================================
   OPENROUTER
========================================================= */

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

        console.error(
            "❌ OpenRouter error:",
            data
        );

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


/* =========================================================
   FILE UPLOAD
========================================================= */

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
            console.log("📎 FILE UPLOAD");
            console.log(
                "Name:",
                originalName
            );
            console.log(
                "Type:",
                mimeType
            );
            console.log(
                "Size:",
                req.file.size,
                "bytes"
            );


            /*
               Upload the file to Gemini's
               file storage.
            */

            if (!gemini) {

                throw new Error(
                    "Gemini API is not configured."
                );

            }


            const uploaded =
                await gemini.files.upload({

                    file: uploadedPath,

                    config: {
                        mimeType: mimeType
                    }

                });


            console.log(
                "✅ File uploaded to Gemini"
            );


            /*
               Delete temporary Render file
            */

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

        }

        catch (error) {

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


/* =========================================================
   CHAT
========================================================= */

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


            console.log("");
            console.log(
                "📩 /chat request received"
            );

            console.log(
                "AI:",
                provider
            );

            console.log(
                "History:",
                Array.isArray(history)
                    ? history.length
                    : 0,
                "messages"
            );

            console.log(
                "Attachments:",
                Array.isArray(attachments)
                    ? attachments.length
                    : 0
            );


            if (
                !message &&
                (!attachments ||
                 attachments.length === 0)
            ) {

                return res.status(400).json({

                    error:
                        "Message or attachment is required."

                });

            }


            let reply;


            /* =========================================
               GEMINI
            ========================================= */

            if (
                provider === "gemini"
            ) {

                reply =
                    await askGemini(
                        message || "",
                        history,
                        attachments
                    );

                console.log(
                    "✅ Gemini responded"
                );

            }


            /* =========================================
               GROQ
            ========================================= */

            else if (
                provider === "groq"
            ) {

                let groqMessage =
                    message || "";


                if (
                    attachments &&
                    attachments.length > 0
                ) {

                    groqMessage +=
                        "\n\n[The user attached " +
                        attachments.length +
                        " file(s). This file was uploaded to the chatbot, but this Groq model cannot directly access the uploaded file.]";

                }


                reply =
                    await askGroq(
                        groqMessage,
                        history
                    );


                console.log(
                    "✅ Groq responded"
                );

            }


            /* =========================================
               OPENROUTER
            ========================================= */

            else if (
                provider === "openrouter"
            ) {

                let routerMessage =
                    message || "";


                if (
                    attachments &&
                    attachments.length > 0
                ) {

                    routerMessage +=
                        "\n\n[The user attached " +
                        attachments.length +
                        " file(s). The selected OpenRouter free model may not support direct access to this uploaded file.]";

                }


                reply =
                    await askOpenRouter(
                        routerMessage,
                        history
                    );


                console.log(
                    "✅ OpenRouter responded"
                );

            }


            /* =========================================
               UNKNOWN
            ========================================= */

            else {

                return res.status(400).json({

                    error:
                        "Unknown AI provider: " +
                        provider

                });

            }


            return res.json({

                reply,

                provider,

                success: true

            });

        }

        catch (error) {

            console.error("");
            console.error(
                "❌ AI ERROR:"
            );

            console.error(
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


/* =========================================================
   START
========================================================= */

app.listen(
    PORT,
    () => {

        console.log("");
        console.log(
            `🌐 Server running on port ${PORT}`
        );

        console.log(
            "================================="
        );

        console.log(
            "🤖 Gemini + Groq + OpenRouter"
        );

        console.log(
            "📎 File uploads enabled"
        );

        console.log(
            "🔄 Shared conversation enabled"
        );

        console.log(
            "================================="
        );

    }
);
