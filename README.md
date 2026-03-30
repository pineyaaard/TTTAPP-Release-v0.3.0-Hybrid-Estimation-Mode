# 🚀 TTTAP Core Engine (CAR DAMAGES AI ESTIMATOR) - v0.3.0

**🎬 Watch Demo Video:** 



https://github.com/user-attachments/assets/ebbc4f2f-acb5-43fc-bf99-8cdb5cbd50c9



**🏷 Version:** 0.3.0 (Alpha MVP)  
**⚙️ Core Model:** Gemini 3 Flash (Vision) / Gemini 3.1 Pro (Search)

TTTAP Core is a hybrid AI engine designed for automated auto body repair estimation based on visual data (photos/videos). It is specifically tailored to the realities of the Czech automotive market (calculating in flat-rate labor hours / Normohodiny, where 1 Nh = 1000 Kč).

## 🔥 What's New in v0.3.0 (Major Update)

In this release, we transitioned from a simple visual calculator to a full-fledged SaaS platform featuring role-based access, database integration, and heavily upgraded UX/UI.

* **🎭 Dual-Role Interface (Two Tracks):** * **Client View:** Displays only retail prices for parts and the final repair cost (clean UI, no links, no wholesale data).
  * **Master View (God Mode):** Unlocks wholesale prices (velkoobchod), direct purchase links, and pure profit margins. Parts are automatically categorized into: OEM, Good Aftermarket, Average Aftermarket, and Used.
* **🎥 Multimedia Engine (Up to 10 Files + Video):**
  Integrated Google GenAI `File API`. The system now processes not just photos, but full **video fly-arounds** of the vehicle. The AI can detect body damage and geometry issues directly from the video feed.
* **🌍 Internationalization (i18n):**
  Full language switching implemented: `Czech`, `Russian`, and `English`.
* **🌗 UI Customization:**
  Added Light / Dark mode toggle for comfortable use in garage environments under varying lighting conditions.
* **🔢 Automated VIN Decoder (NHTSA API):**
  Added Make, Model, and Year recognition via 17-digit VIN lookups (currently in beta, works best with newer vehicles).
* **📊 CRM Integration (Firebase):**
  Connected Firestore database to save leads, estimate history, and manage client interactions via an integrated Telegram Bot.

## 🧠 Architecture & Logic (Unified Routing Engine)

* **Monolithic System Prompt:** All estimation logic (PDR, frame work, painting, panel replacement) has been merged into a single, comprehensive system prompt. The AI evaluates all parameters simultaneously, strictly following local market rules (e.g., ignoring minor adjacent scratches during severe side impacts, flagging frame damage for manual review).
* **Dynamic Search Agent:** Utilizes the heavy `gemini-3.1-pro-preview` model equipped with the Google Search Tool to hunt down real OEM part numbers and scrape prices from local Czech suppliers (LKQ, Automedik, RRR.lt).
* **Backend Rate Limiting:** Express server secured with strict rate limiters (100 requests / 15 mins for the main API, 20 requests / hour for VIN lookups) to prevent API abuse.

## ⚠️ Known Issues (Alpha Limitations)

The system is currently in Alpha. We are actively working on resolving the following bugs:
* **VIN Decoder Hit Rate:** The NHTSA API occasionally fails to decode older vehicles or specific European-spec cars. Planning a migration to a more robust commercial API (e.g., TecDoc).
* **Hallucinated / Broken Links:** The AI Search Agent occasionally generates broken URLs for parts in the Master View by attempting to guess the e-commerce routing structure.
* **Part Pricing Math:** Real-time web scraping for exact wholesale/retail prices is currently unstable. The AI sometimes falls back to heuristic estimations instead of exact catalog data.
* **Raw / Legacy Code:** `server.ts` currently contains some temporary workarounds for rate limits and JSON parsing fallbacks that need refactoring.

## 🛠 Tech Stack

* **Backend:** Node.js, Express.js, Vite (Middleware mode).
* **AI Engine:** `@google/genai` (Gemini 3 Flash, Gemini 3.1 Pro).
* **Database:** Firebase Firestore.
* **Integrations:** Telegraf (Telegram Bot), NHTSA API (VIN).

