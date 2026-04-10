import express from "express";
import "dotenv/config";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import os from "os";
import axios from "axios";
import rateLimit from "express-rate-limit";
import cors from "cors";
import { initializeApp } from "firebase/app";
import { getFirestore, collection, addDoc } from "firebase/firestore";
import { GoogleGenAI } from "@google/genai";
import { SYSTEM_INSTRUCTION } from "./src/lib/prompt";

// ─── CONFIG ─────────────────────────────────────────────────────────────────
const RAPID_API_KEY = process.env.RAPID_API_KEY || "6b11f8d9ccmsh0381b30e2d3a632p1abb05jsn34fe649af9ca";
const RAPID_API_HOST = "vin-decoder1.p.rapidapi.com";

// ─── Firebase ───────────────────────────────────────────────────────────────
let db: any = null;
try {
  const configPath = path.join(process.cwd(), "firebase-applet-config.json");
  if (fs.existsSync(configPath)) {
    const firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
    const app = initializeApp(firebaseConfig);
    db = getFirestore(app, firebaseConfig.firestoreDatabaseId || undefined);
    console.log("[TTTAPP] Firebase OK");
  }
} catch (e) {
  console.warn("[TTTAPP] Firebase skipped:", (e as Error).message);
}

// ─── Rate Limits ────────────────────────────────────────────────────────────
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: "Too many requests, please try again later." }
});

const vinLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 50,
  message: { error: "Too many VIN lookups, please try again later." }
});

function resolveApiKey(frontendKey?: string): string {
  return frontendKey || "СЕКРЕТИКИ" || "";
}

function getAI(apiKey: string): GoogleGenAI {
  return new GoogleGenAI({ apiKey });
}

// ─── CONTEXT CACHING — saves ~60% on prompt tokens ─────────────────────────
// Prompt v3.0 = ~4000 tokens. Without cache: sent every request = $$$.
// With cache: sent once per hour, all requests reference it = $.

const cacheNames: Record<string, string | null> = {};

async function getOrCreateCache(apiKey: string, modelName: string): Promise<string | null> {
  const cacheKey = `${modelName}`;
  
  // Already cached this session?
  if (cacheNames[cacheKey]) {
    return cacheNames[cacheKey];
  }

  try {
    console.log(`[TTTAPP] Creating prompt cache for ${modelName}...`);
    const ai = getAI(apiKey);
    
    const cache = await ai.caches.create({
      model: modelName,
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        ttl: "3600s", // 1 hour
        displayName: `swagarage_v3_${modelName.replace(/[.\-]/g, '_')}`,
      }
    });

    cacheNames[cacheKey] = cache.name || null;
    console.log(`[TTTAPP] Cache created: ${cache.name}`);
    return cache.name || null;
  } catch (e: any) {
    // Caching might fail on some models/plans — fall back to inline prompt
    console.warn(`[TTTAPP] Cache creation failed (will use inline prompt):`, e.message);
    cacheNames[cacheKey] = null;
    return null;
  }
}

// ─── MODEL ROUTING — Flash first, Pro only for video ────────────────────────
// Flash: ~0.1$/1M input tokens. Pro: ~1.25$/1M input tokens = 12x more expensive.
// Flash handles 95% of cases fine with good prompt + caching.

function selectModel(files: { mimeType: string }[]): string {
  const hasVideo = files.some(f => f.mimeType.startsWith("video/"));
  // Pro ONLY for video — everything else on Flash
  return hasVideo ? "gemini-3.1-pro-preview" : "gemini-3-flash-preview";
}

// ─── LANGUAGE HELPER ────────────────────────────────────────────────────────
function getLangInstruction(lang: string): string {
  switch (lang) {
    case 'cs': return 'Respond ONLY in Czech (čeština). All names, descriptions in Czech.';
    case 'en': return 'Respond ONLY in English. All names, descriptions in English.';
    case 'uk': return 'Respond ONLY in Ukrainian (українська). All names, descriptions in Ukrainian.';
    case 'ru': 
    default: return 'Respond ONLY in Russian (русский). All names, descriptions in Russian.';
  }
}

// ─── MAIN ESTIMATION ────────────────────────────────────────────────────────

async function estimateDamage(
  files: { data: string; mimeType: string }[], 
  apiKey: string,
  lang: string = 'ru'
) {
  const modelName = selectModel(files);
  const resolvedKey = resolveApiKey(apiKey);
  
  if (!resolvedKey) {
    throw new Error("API_KEY_INVALID");
  }

  const ai = getAI(resolvedKey);
  console.log(`[TTTAPP] Model: ${modelName} | Files: ${files.length} | Lang: ${lang}`);

  const uploadedFiles: string[] = [];
  const parts: any[] = [];

  try {
    // ── Prepare file parts ──
    for (const file of files) {
      const isVideo = file.mimeType.startsWith("video/");
      const isLarge = file.data.length > 5 * 1024 * 1024; // ~5MB base64

      if (isVideo || isLarge) {
        // Upload via File API for videos / large images
        const tempPath = path.join(os.tmpdir(), `up_${Date.now()}_${Math.random().toString(36).substring(7)}`);
        fs.writeFileSync(tempPath, Buffer.from(file.data, 'base64'));
        
        try {
          const upload = await ai.files.upload({ 
            file: tempPath, 
            config: { mimeType: file.mimeType } 
          });
          
          // Poll for video processing
          if (isVideo) {
            let info = await ai.files.get({ name: upload.name });
            let attempts = 0;
            while (info.state === "PROCESSING" && attempts < 30) {
              await new Promise(r => setTimeout(r, 2000));
              info = await ai.files.get({ name: upload.name });
              attempts++;
            }
            if (info.state === "FAILED") {
              throw new Error(`Video processing failed: ${upload.name}`);
            }
          }
          
          uploadedFiles.push(upload.name!);
          parts.push({ fileData: { fileUri: upload.uri, mimeType: file.mimeType } });
        } finally {
          if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
        }
      } else {
        // Inline for small images (faster, no upload overhead)
        parts.push({ inlineData: { data: file.data, mimeType: file.mimeType } });
      }
    }

    // ── Build request with cache ──
    const cacheName = await getOrCreateCache(resolvedKey, modelName);
    const langInstruction = getLangInstruction(lang);

    const requestConfig: any = {
      responseMimeType: "application/json",
      temperature: 0.1,
    };

    // If cache exists — use it (saves prompt tokens)
    // If not — send prompt inline as systemInstruction
    if (cacheName) {
      requestConfig.cachedContent = cacheName;
    } else {
      requestConfig.systemInstruction = SYSTEM_INSTRUCTION;
    }

    const response = await ai.models.generateContent({
      model: modelName,
      contents: [{ 
        parts: [
          ...parts, 
          { text: `${langInstruction}\nAnalyze damage strictly by rules. Show math in Nh. Discard minor adjacent damage. Output valid JSON.` }
        ] 
      }],
      config: requestConfig
    });

    // ── Parse response ──
    const text = response.text || "{}";
    const jsonStr = text.replace(/```json\n?|\n?```/g, "").trim().replace(/:\s*NaN/g, ': 0.90');

    let result: any;
    try {
      result = JSON.parse(jsonStr);
    } catch (e) {
      console.error("[TTTAPP] JSON parse error. Raw:", text.substring(0, 500));
      result = {
        totalCost: 0,
        confidence: 0.3,
        repairs: [],
        parts: [],
        grey_flags: [],
        summary: "Ошибка разбора ответа ИИ. Попробуйте ещё раз.",
      };
    }

    // ── Safety net for frontend (.map() won't crash) ──
    return {
      audit_layer: result.audit_layer || {},
      carModel: result.carModel || "Не определено",
      carClass: result.carClass || "standard",
      confidence: (result.confidence !== null && !isNaN(result.confidence)) ? result.confidence : 0.90,
      totalCost: result.totalCost || 0,
      repairs: Array.isArray(result.repairs) ? result.repairs : [],
      parts: Array.isArray(result.parts) ? result.parts : [],
      grey_flags: Array.isArray(result.grey_flags) ? result.grey_flags : [],
      summary: result.summary || "",
      notes: result.notes || "Оценка предварительная. Рекомендуем личный осмотр.",
    };

  } finally {
    // Cleanup uploaded files from Google Cloud
    for (const name of uploadedFiles) {
      try { await ai.files.delete({ name }); } catch (e) {}
    }
  }
}

// ─── SERVER ─────────────────────────────────────────────────────────────────

async function startServer() {
  const app = express();
  app.set('trust proxy', 1);
  app.use(cors());
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // Error handler for payload issues
  app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err instanceof SyntaxError && 'status' in err && err.status === 400) {
      return res.status(400).json({ error: "Invalid JSON payload" });
    }
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ error: "Файл слишком большой. Максимум 50MB." });
    }
    next(err);
  });

  // ── 1. ESTIMATE DAMAGE ──────────────────────────────────────────────────
  app.post("/api/estimate", apiLimiter, async (req, res) => {
    const { files, apiKey, lang } = req.body;

    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: "No files provided." });
    }

    try {
      const result = await estimateDamage(files, apiKey || "", lang || "ru");

      // Save lead to CRM (non-blocking)
      if (db) {
        try {
          await addDoc(collection(db, 'leads'), {
            track: "body_shop",
            source: "web",
            status: "new",
            vehicleInfo: { carModel: result.carModel },
            estimation: { totalCost: result.totalCost, confidence: result.confidence },
            summary: result.summary,
            createdAt: new Date().toISOString(),
          });
        } catch (e) {
          console.warn("[TTTAPP] CRM save failed:", (e as Error).message);
        }
      }

      res.json(result);
    } catch (e: any) {
      console.error("[TTTAPP] Estimate error:", e.message);
      if (e.message?.includes('429') || e.message?.includes('RESOURCE_EXHAUSTED')) {
        return res.status(429).json({ error: "quota_exceeded" });
      }
      if (e.message?.includes('API key') || e.message?.includes('API_KEY_INVALID')) {
        return res.status(401).json({ error: "invalid_api_key" });
      }
      res.status(500).json({ error: "server_error" });
    }
  });

  // ── 2. VIN DECODER — RapidAPI (Europe) + NHTSA fallback (US/free) ──────
  app.get("/api/vin/:vin", vinLimiter, async (req, res) => {
    const { vin } = req.params;
    if (vin.length !== 17) {
      return res.status(400).json({ error: "VIN must be 17 characters." });
    }

    // Plan A: RapidAPI (better for European cars)
    try {
      const response = await axios.get(`https://${RAPID_API_HOST}/decode_vin`, {
        params: { vin: vin.toUpperCase() },
        headers: {
          'X-RapidAPI-Key': RAPID_API_KEY,
          'X-RapidAPI-Host': RAPID_API_HOST
        },
        timeout: 5000,
      });
      const data = response.data;
      const make = data.make || data.brand;
      if (make) {
        return res.json({
          vin: vin.toUpperCase(),
          make,
          model: data.model || "Unknown",
          year: data.year || data.model_year || "Unknown",
          engine: data.engine || "Unknown",
          found: true,
          source: "rapidapi"
        });
      }
    } catch (e) {
      console.warn("[TTTAPP] RapidAPI VIN failed, trying NHTSA...");
    }

    // Plan B: NHTSA (free, US-focused but works for many brands)
    try {
      const response = await fetch(
        `https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${vin}?format=json`
      );
      if (!response.ok) throw new Error("NHTSA fetch failed");
      const data = await response.json();
      
      if (data.Results?.[0]?.Make) {
        const r = data.Results[0];
        return res.json({
          vin: vin.toUpperCase(),
          make: r.Make,
          model: r.Model,
          year: r.ModelYear,
          engine: r.DisplacementL ? `${r.DisplacementL}L` : "Unknown",
          found: true,
          source: "nhtsa"
        });
      }
    } catch (e) {
      console.warn("[TTTAPP] NHTSA also failed");
    }

    // Both failed
    res.json({
      vin: vin.toUpperCase(),
      make: "",
      model: "",
      year: "",
      found: false,
    });
  });

  // ── 3. PARTS SEARCH — Flash + Google Search ───────────────────────────
  app.post("/api/parts/search", async (req, res) => {
    const { vin, partName, make, model, year, apiKey } = req.body;

    if (!partName) {
      return res.status(400).json({ error: "partName is required." });
    }

    const resolvedKey = resolveApiKey(apiKey);
    const fallbackLink = `https://www.lkq.cz/Search?q=${encodeURIComponent(partName)}`;

    try {
      const vehicleInfo = [make, model, year, vin ? `VIN: ${vin}` : ''].filter(Boolean).join(' ');

      const prompt = `Find auto part "${partName}" for: ${vehicleInfo || 'unknown vehicle'}.

INSTRUCTIONS:
1. Use Google Search to find the REAL OEM part number for this specific vehicle.
2. Search lkq.cz for retail price in CZK.
3. Search automedik.cz for wholesale price in CZK.
4. Build search links using the REAL part number you found.

LINK FORMAT (use real part number, e.g. 5N0853665):
- LKQ: https://www.lkq.cz/Search?q=REAL_PART_NUMBER
- Automedik: https://automedik.cz/autodily/hledani?search=REAL_PART_NUMBER
- RRR: https://rrr.lt/en/search?q=REAL_PART_NUMBER

If you cannot find the part number, use this fallback link: ${fallbackLink}

CRITICAL: NEVER use placeholder text like [PART_NUMBER] or [NUMBER]. Only use real numbers or the fallback link.

Return ONLY valid JSON:
{
  "partName": "${partName}",
  "partNumber": "real OEM number or empty string",
  "results": [
    {"category": "new_original", "name": "...", "partNumber": "...", "retailPrice": 0, "wholesalePrice": 0, "link": "..."},
    {"category": "good_aftermarket", "name": "...", "retailPrice": 0, "wholesalePrice": 0, "link": "..."},
    {"category": "used_original", "name": "...", "retailPrice": 0, "wholesalePrice": 0, "link": "..."}
  ]
}`;

      const ai = getAI(resolvedKey);

      // Pro for parts search — needs accurate Google Search results
      // This runs only when user clicks "Find parts", not every estimate
      const response = await ai.models.generateContent({
        model: "gemini-3.1-pro-preview",
        contents: [{ parts: [{ text: prompt }] }],
        config: {
          tools: [{ googleSearch: {} } as any],
          responseMimeType: "application/json",
          temperature: 0.2,
        }
      });

      const text = response.text || "{}";
      const data = JSON.parse(text.replace(/```json\n?|\n?```/g, "").trim());

      // ── Link validation — fix broken/placeholder links ──
      const results = (data.results || []).map((r: any) => {
        let link = r.link || "";
        // Kill broken links
        if (!link || 
            link.includes('[') || 
            link.includes(']') || 
            link.includes('undefined') || 
            link.includes('PART_NUMBER') ||
            link.includes('placeholder') ||
            link.length < 15) {
          link = fallbackLink;
        }
        return { ...r, link };
      });

      res.json({ partName, vin, results });
    } catch (e) {
      console.error("[TTTAPP] Parts search error:", (e as Error).message);
      // Graceful fallback
      res.json({
        partName,
        vin,
        results: [
          {
            category: "new_original",
            name: `${partName}`,
            partNumber: "",
            retailPrice: 0,
            wholesalePrice: 0,
            link: fallbackLink,
          }
        ]
      });
    }
  });

  // ── Frontend (Vite dev / static prod) ─────────────────────────────────
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(3000, "0.0.0.0", () => {
    console.log("[TTTAPP] Server on port 3000");
  });
}

startServer();
