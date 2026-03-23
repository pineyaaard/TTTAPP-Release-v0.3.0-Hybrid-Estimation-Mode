<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# TTTAP: AI Auto Body Estimator (v0.1.0 MVP)

**Status:** Pre-alpha (Prompt Engineering & Core Routing Logic)  
**Platform:** Google AI Studio (Vision LLM)  

View the live app in AI Studio: [https://ai.studio/apps/5e14af1a-3875-45d8-b954-fe43c5ab658a](https://ai.studio/apps/5e14af1a-3875-45d8-b954-fe43c5ab658a)

---

## 🚀 Core Vision Estimation Logic
This repository contains the core damage estimation engine (TTTAP Core). The logic is built upon a multi-layered system prompt that transforms visual analysis (Vision API) into strict, real-world auto body shop unit economics.

### Key Architectural Features:

#### 1. 8-Layer Boolean Trap & Router (Pre-processing)
Implemented a strict pre-calculation audit. The Vision LLM must classify the defect using 8 boolean flags (true/false) before running any cost estimations. This eliminates hallucinations and routes the logic down the correct decision tree (PDR vs. Paint & Bodywork).
* **Contextual Flags:** Introduced `is_door`, `is_bumper`, and `is_hanging_part` to define panel types.
* **Geometry Analysis:** Added the `has_misaligned_gaps` flag to detect panel shifts and broken clips from photos.
* **Zero-Damage Catch (False-Positive Mitigation):** Engineered a defense mechanism against optical illusions. If the algorithm detects reflections (`is_reflection`) or dirt (`is_mud_or_water`) instead of actual scratches, the calculation is instantly blocked, returning a "0 Kč - Re-upload photo" error.

#### 2. Dynamic Paintless Dent Repair (PDR) Matrix
* **6-Stage Complexity Grading:** Established a strict 6-stage PDR matrix based on metal stretching and the presence of sharp creases on body lines.
* **Conditional R&I (Smart Disassembly):** Implemented conditional Remove & Install (R&I) labor hours. For doors (`is_door=true`), the disassembly fee (+2.0h) is triggered *only* for medium-to-heavy damage (Stage 3 and above). Minor parking dents (Stage 1-2) are automatically calculated for external glue pulling (0h R&I).

#### 3. Parking Scuff Override Logic
Engineered an isolated algorithm to calculate light surface damage (paint transfer/scuffs) and prevent AI overpricing.
* When the `is_parking_scuff` trigger fires, the algorithm forces capped hours: 2.5h Repair (putty/prep) + 2.5h Transition Paint.
* **Smart Assembly Logic:** R&I hours for hanging parts (like bumpers) are set to 0h for local scuffs, *unless* the Vision model detects uneven panel gaps (`has_misaligned_gaps=true`), which then reverts to standard R&I hours.

#### 4. Dynamic Class Multiplier & Fallback
* Implemented a base misidentification filter. If the Vision model cannot identify the vehicle make/model with 100% certainty, it enforces a default class multiplier (Standard 1.0x) to protect the estimate from arbitrary markups or discounts.

---

## 💻 Run Locally

**Prerequisites:** Node.js

1. Install dependencies:
   ```bash
   npm install
