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

app.use(
    express.static(
        path.join(__dirname, "public")
    )
);


/* =========================================
   CHECK API KEYS
========================================= */

console.log("");
console.log("=================================");
console.log("        VIJAY'S CHATBOT");
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


/* =========================================
   GEMINI
========================================= */

const gemini = process.env.GEMINI_API_KEY
    ? new GoogleGenAI({
        apiKey: process.env.GEMINI_API_KEY
    })
    : null;


/* =========================================
   GEMINI FUNCTION
========================================= */

async function askGemini(message) {

    if (!gemini) {
        throw new Error(
            "GEMINI_API_KEY is missing from .env"
        );
    }

    const response =
        await gemini.models.generateContent({

            model: "gemini-3.6-flash",

            contents: message

        });

    return response.text;
}


/* =========================================
   GROQ FUNCTION
========================================= */

async function askGroq(message) {

    if (!process.env.GROQ_API_KEY) {

        throw new Error(
            "GROQ_API_KEY is missing from .env"
        );

    }


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

                messages: [

                    {
                        role: "user",
                        content: message
                    }

                ],

                temperature: 0.7

            })

        }
    );


    const data =
        await response.json();


    if (!response.ok) {

        console.error(
            "Groq API error:",
            data
        );

        throw new Error(
            data.error?.message ||
            "Groq API request failed"
        );

    }


    return (
        data.choices?.[0]?.message?.content ||
        "Groq returned no response."
    );
}


/* =========================================
   OPENROUTER FUNCTION
========================================= */

async function askOpenRouter(message) {

    if (!process.env.OPENROUTER_API_KEY) {

        throw new Error(
            "OPENROUTER_API_KEY is missing from .env"
        );

    }


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
                    "http://localhost:3000",

                "X-Title":
                    "Vijay's Chatbot"

            },

            body: JSON.stringify({

                model:
                    "openrouter/free",

                messages: [

                    {
                        role: "user",
                        content: message
                    }

                ]

            })

        }
    );


    const data =
        await response.json();


    if (!response.ok) {

        console.error(
            "OpenRouter API error:",
            data
        );

        throw new Error(
            data.error?.message ||
            "OpenRouter API request failed"
        );

    }


    return (
        data.choices?.[0]?.message?.content ||
        "OpenRouter returned no response."
    );
}


/* =========================================
   CHAT ROUTE
========================================= */

app.post("/chat", async (req, res) => {

    try {

        const {
            message,
            provider
        } = req.body;


        console.log("");
        console.log("📩 /chat request received");

        console.log(
            "User:",
            message
        );

        console.log(
            "AI:",
            provider
        );


        /* ==============================
           CHECK MESSAGE
        ============================== */

        if (!message) {

            return res.status(400).json({

                error:
                    "Message is required."

            });

        }


        /* ==============================
           GEMINI
        ============================== */

        if (provider === "gemini") {

            const reply =
                await askGemini(message);

            console.log(
                "✅ Gemini responded"
            );

            return res.json({

                reply: reply,

                provider: "gemini"

            });

        }


        /* ==============================
           GROQ
        ============================== */

        if (provider === "groq") {

            const reply =
                await askGroq(message);

            console.log(
                "✅ Groq responded"
            );

            return res.json({

                reply: reply,

                provider: "groq"

            });

        }


        /* ==============================
           OPENROUTER
        ============================== */

        if (provider === "openrouter") {

            const reply =
                await askOpenRouter(message);

            console.log(
                "✅ OpenRouter responded"
            );

            return res.json({

                reply: reply,

                provider: "openrouter"

            });

        }


        /* ==============================
           UNKNOWN PROVIDER
        ============================== */

        return res.status(400).json({

            error:
                "Unknown AI provider: " +
                provider

        });

    }


    /* =====================================
       ERROR HANDLING
    ===================================== */

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

});


/* =========================================
   START SERVER
========================================= */

app.listen(
    PORT,
    () => {

        console.log("");
        console.log(
            `🌐 http://localhost:${PORT}`
        );

        console.log(
            "================================="
        );

        console.log(
            "🤖 Gemini + Groq + OpenRouter"
        );

        console.log(
            "================================="
        );

        console.log("");

    }
);