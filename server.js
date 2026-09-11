require("dotenv").config();

const express = require("express");
const path = require("path");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const os = require("os");
const crypto = require("crypto");

const { GoogleGenAI } = require("@google/genai");

const app = express();
const PORT = process.env.PORT || 3000;

/* =========================================================
   CORS & SECURITY
========================================================= */

app.use(
  cors({
    origin: process.env.ALLOWED_ORIGIN || "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

/* =========================================================
   PWA MANIFEST ROUTE
========================================================= */

app.get("/manifest.json", (req, res) => {
  res.setHeader("Content-Type", "application/manifest+json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.sendFile(path.join(__dirname, "public", "manifest.json"));
});

/* =========================================================
   MIDDLEWARE & FRONTEND SERVING
========================================================= */

app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

/* =========================================================
   UPLOAD SETUP
========================================================= */

const upload = multer({
  dest: path.join(os.tmpdir(), "vijays-chatbot"),
  limits: { fileSize: 100 * 1024 * 1024 },
});

/* =========================================================
   API KEY STATUS LOGGING
========================================================= */

console.log("\n=================================");
console.log("        VIJAY'S CHATBOT");
console.log("=================================");
console.log("Gemini API:    ", process.env.GEMINI_API_KEY ? "✅ Loaded" : "❌ Missing");
console.log("Groq API:      ", process.env.GROQ_API_KEY ? "✅ Loaded" : "❌ Missing");
console.log("OpenRouter API:", process.env.OPENROUTER_API_KEY ? "✅ Loaded" : "❌ Missing");
console.log("ElevenLabs API:", process.env.ELEVENLABS_API_KEY ? "✅ Loaded" : "❌ Missing");
console.log("=================================\n");

/* =========================================================
   GEMINI INITIALIZATION
========================================================= */

const gemini = process.env.GEMINI_API_KEY
  ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
  : null;

/* =========================================================
   HELPERS
========================================================= */

function cleanHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter(
      (item) =>
        item &&
        (item.role === "user" || item.role === "assistant") &&
        typeof item.content === "string" &&
        item.content.trim()
    )
    .slice(-40);
}

function historyForOpenAIStyle(history) {
  return cleanHistory(history).map((item) => ({
    role: item.role === "assistant" ? "assistant" : "user",
    content: item.content,
  }));
}

/* =========================================================
   ELEVENLABS AUDIO GENERATOR FUNCTION
========================================================= */

async function generateSpeech(text) {
  try {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    const voiceId = process.env.ELEVENLABS_VOICE_ID;

    if (!apiKey || !voiceId) {
      console.error("ElevenLabs API Key or Voice ID is missing in environment!");
      return null;
    }

    const cleanText = String(text)
      .replace(/[*_#`~]/g, "")
      .trim();

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_22050_32`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "xi-api-key": apiKey,
        },
        body: JSON.stringify({
          text: cleanText,
          model_id: "eleven_flash_v2_5",
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
          },
        }),
      }
    );

    if (!response.ok) {
      const errData = await response.json();
      console.error("ElevenLabs API Error:", errData);
      return null;
    }

    const publicDir = path.join(__dirname, "public", "audio");
    if (!fs.existsSync(publicDir)) {
      fs.mkdirSync(publicDir, { recursive: true });
    }

    // Generate unique filename to prevent cache collisions during concurrent sessions
    const filename = `speech-${crypto.randomBytes(8).toString("hex")}.mp3`;
    const filePath = path.join(publicDir, filename);

    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(filePath, buffer);

    const baseUrl = process.env.BASE_URL || "https://vijays-chatbot.onrender.com";
    return `${baseUrl}/audio/${filename}`;
  } catch (err) {
    console.error("Speech Generation Failed:", err);
    return null;
  }
}

/* =========================================================
   GEMINI PROVIDER
========================================================= */

async function askGemini(message, history, attachments = []) {
  if (!gemini) throw new Error("GEMINI_API_KEY is missing.");

  const contents = [];

  for (const item of cleanHistory(history)) {
    contents.push({
      role: item.role === "assistant" ? "model" : "user",
      parts: [{ text: item.content }],
    });
  }

  const currentParts = [];
  if (message) currentParts.push({ text: message });

  for (const attachment of attachments) {
    if (attachment?.fileUri && attachment?.mimeType) {
      currentParts.push({
        fileData: {
          fileUri: attachment.fileUri,
          mimeType: attachment.mimeType,
        },
      });
    }
  }

  contents.push({ role: "user", parts: currentParts });

  const response = await gemini.models.generateContent({
    model: "gemini-2.5-flash",
    contents,
  });

  return response.text || "Gemini returned no response.";
}

/* =========================================================
   GROQ PROVIDER
========================================================= */

async function askGroq(message, history) {
  if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY is missing.");

  const messages = historyForOpenAIStyle(history);
  messages.push({ role: "user", content: message });

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages,
      temperature: 0.7,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    console.error("❌ Groq error:", data);
    throw new Error(data.error?.message || "Groq API request failed.");
  }

  return data.choices?.[0]?.message?.content || "Groq returned no response.";
}

/* =========================================================
   OPENROUTER PROVIDER
========================================================= */

async function askOpenRouter(message, history) {
  if (!process.env.OPENROUTER_API_KEY) throw new Error("OPENROUTER_API_KEY is missing.");

  const messages = historyForOpenAIStyle(history);
  messages.push({ role: "user", content: message });

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "HTTP-Referer": process.env.BASE_URL || "https://vijays-chatbot.onrender.com",
      "X-Title": "Vijay's Chatbot",
    },
    body: JSON.stringify({
      model: "google/gemini-2.0-flash-lite-001",
      messages,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    console.error("❌ OpenRouter error:", data);
    throw new Error(data.error?.message || "OpenRouter API request failed.");
  }

  return data.choices?.[0]?.message?.content || "OpenRouter returned no response.";
}

/* =========================================================
   FILE UPLOAD ENDPOINT
========================================================= */

app.post("/upload", upload.single("file"), async (req, res) => {
  let uploadedPath = null;
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file was uploaded." });
    }

    uploadedPath = req.file.path;
    const { mimetype: mimeType, originalname: originalName, size } = req.file;

    if (!gemini) throw new Error("Gemini API is not configured.");

    const uploaded = await gemini.files.upload({
      file: uploadedPath,
      config: { mimeType },
    });

    try {
      fs.unlinkSync(uploadedPath);
    } catch {}

    return res.json({
      success: true,
      name: originalName,
      mimeType,
      size,
      fileUri: uploaded.uri,
      fileName: uploaded.name,
    });
  } catch (error) {
    console.error("❌ Upload error:", error);
    if (uploadedPath && fs.existsSync(uploadedPath)) {
      try {
        fs.unlinkSync(uploadedPath);
      } catch {}
    }
    return res.status(500).json({ error: error.message || "File upload failed." });
  }
});

/* =========================================================
   ALEXA ENDPOINT
========================================================= */

app.post("/alexa", async (req, res) => {
  try {
    const requestType = req.body.request?.type;

    if (requestType === "LaunchRequest") {
      const audioUrl = await generateSpeech("Yes Vijay?");
      const ssmlContent = audioUrl
        ? `<speak><audio src="${audioUrl}"/></speak>`
        : "<speak>Yes Vijay?</speak>";

      return res.json({
        version: "1.0",
        response: {
          outputSpeech: { type: "SSML", ssml: ssmlContent },
          shouldEndSession: false,
        },
      });
    }

    if (requestType === "IntentRequest") {
      const intentName = req.body.request.intent?.name;

      if (intentName === "AskJarvisIntent") {
        let userQuery = req.body.request.intent.slots?.query?.value || "";
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
          aiReply = await askGroq(userQuery, []);
        } else if (selectedProvider === "openrouter") {
          aiReply = await askOpenRouter(userQuery, []);
        } else {
          aiReply = await askGemini(userQuery, [], []);
        }

        const audioUrl = await generateSpeech(aiReply);
        const speechText = String(aiReply).replace(/[*_#`~]/g, "");
        const ssmlContent = audioUrl
          ? `<speak><audio src="${audioUrl}"/></speak>`
          : `<speak>${speechText}</speak>`;

        return res.json({
          version: "1.0",
          response: {
            outputSpeech: { type: "SSML", ssml: ssmlContent },
            shouldEndSession: false,
          },
        });
      }
    }

    const exitAudioUrl = await generateSpeech("Goodbye Vijay.");
    const exitSsml = exitAudioUrl
      ? `<speak><audio src="${exitAudioUrl}"/></speak>`
      : "<speak>Goodbye Vijay.</speak>";

    return res.json({
      version: "1.0",
      response: {
        outputSpeech: { type: "SSML", ssml: exitSsml },
        shouldEndSession: true,
      },
    });
  } catch (error) {
    console.error("Alexa Error:", error);
    return res.json({
      version: "1.0",
      response: {
        outputSpeech: {
          type: "SSML",
          ssml: "<speak>Sorry Vijay, I encountered an issue processing your request.</speak>",
        },
        shouldEndSession: true,
      },
    });
  }
});

/* =========================================================
   CHAT ENDPOINT
========================================================= */

app.post("/chat", async (req, res) => {
  try {
    const { message, provider, history = [], attachments = [] } = req.body;

    if (!message && (!attachments || attachments.length === 0)) {
      return res.status(400).json({ error: "Message or attachment is required." });
    }

    let reply;

    if (provider === "gemini") {
      reply = await askGemini(message || "", history, attachments);
    } else if (provider === "groq") {
      let groqMessage = message || "";
      if (attachments && attachments.length > 0) {
        groqMessage += `\n\n[The user attached ${attachments.length} file(s). Groq cannot directly process attached media files.]`;
      }
      reply = await askGroq(groqMessage, history);
    } else if (provider === "openrouter") {
      let routerMessage = message || "";
      if (attachments && attachments.length > 0) {
        routerMessage += `\n\n[The user attached ${attachments.length} file(s). OpenRouter cannot directly process attached media files.]`;
      }
      reply = await askOpenRouter(routerMessage, history);
    } else {
      return res.status(400).json({ error: `Unknown AI provider: ${provider}` });
    }

    return res.json({ reply, provider, success: true });
  } catch (error) {
    console.error("❌ AI ERROR:", error.message);
    return res.status(500).json({ error: error.message || "Something went wrong." });
  }
});

/* =========================================================
   SERVER INITIALIZATION
========================================================= */

app.listen(PORT, () => {
  console.log(`\n🌐 Server running on port ${PORT}`);
  console.log("=================================");
  console.log("🤖 Gemini + Groq + OpenRouter");
  console.log("📎 File uploads enabled");
  console.log("🔄 Shared conversation enabled");
  console.log("=================================\n");
});
