import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";
import dotenv from "dotenv";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Anthropic Proxy Route
  app.post("/api/anthropic/generate", async (req, res) => {
    try {
      const { prompt, systemInstruction } = req.body;
      const apiKey = process.env.ANTHROPIC_API_KEY;

      if (!apiKey) {
        return res.status(500).json({ error: "ANTHROPIC_API_KEY is not configured on the server." });
      }

      const anthropic = new Anthropic({ apiKey });

      const response = await anthropic.messages.create({
        model: "claude-3-5-sonnet-20241022",
        max_tokens: 4096,
        system: systemInstruction,
        messages: [{ role: "user", content: prompt }],
      });

      // Extract text from Anthropic response
      const text = response.content.find(p => p.type === 'text')?.text || "";
      res.json({ text });
    } catch (error: any) {
      console.error("Anthropic API Error:", error);
      res.status(500).json({ error: error.message || "Failed to generate content from Anthropic." });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
