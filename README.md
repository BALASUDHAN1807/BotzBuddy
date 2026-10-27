# BotzBuddy — The Adaptive Funobotz STEM Companion

> **"We don't make the child adapt to the lesson. We make the lesson adapt to the child."**

---

## 🏢 1. Who Funobotz Is & Where BotzBuddy Fits

**Funobotz Paper Robotics Pvt. Ltd.** is an ed-tech company combining **art + engineering**:
- Designs eco-friendly, paper-based DIY robotics kits teaching robotics, IoT, AI, and Digital Twin foundations.
- Runs hands-on coding, electronics, and robotics classes for children aged **6 to 14**.
- Runs school workshops, institutional training, and builds paper-robotics smart classrooms.
- Operates the **main learning platform** (`funobotz.com`) and the **online store** (`store.funobotz.com`, Zoho Commerce).

### 🔌 One Plugin, Every Funobotz Touchpoint:
BotzBuddy is an **integration-ready chatbot plugin** (installed via a single `<script>` tag) that embeds seamlessly into:
1. **Learning Platform Home** (`home.html`, `data-context="home"`) — Welcoming guide, exploratory onboarding, and Discovery Worlds.
2. **Online Kit Store** (`kit.html`, `data-context="kit"`) — Context-aware product assistant that detects robot models from the URL and runs grounded STEM missions.
3. **Classrooms & School Workshops** (`class.html`, `data-context="class"`, `data-teacher="true"`) — Real-time live Teacher View monitor and "Show your teacher" milestone checkpoints.

---

## ⚡ 2. Quick Start

The backend is **Python 3.11+** (FastAPI + Uvicorn). The embeddable plugin and demo pages are plain browser JavaScript served by the same server.

```bash
# 1. Create a virtual environment and install dependencies
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt

# 2. Configure environment (optional: the rule-based fallback works 100% without API keys)
cp .env.example .env

# 3. Run the automated test suite (21 acceptance tests + API tests)
pytest

# 4. Start the server on http://localhost:3000
python -m botzbuddy
# or, with auto-reload while developing:
uvicorn botzbuddy.main:app --reload --port 3000
```

Interactive API docs (Swagger UI) are at [http://localhost:3000/docs](http://localhost:3000/docs).

Run with Docker instead:

```bash
docker build -t botzbuddy .
docker run -p 3000:3000 --env-file .env botzbuddy
```

### 🌐 Demo Pages:
- **Ecosystem Demo Hub:** [http://localhost:3000/demo/](http://localhost:3000/demo/)
- **Main Website (Platform Home):** [http://localhost:3000/demo/home.html](http://localhost:3000/demo/home.html)
- **Kit Store (Product Detail):** [http://localhost:3000/demo/kit.html?product=tiko-scorpio](http://localhost:3000/demo/kit.html?product=tiko-scorpio)
- **Robotics Class (Teacher View Enabled):** [http://localhost:3000/demo/class.html](http://localhost:3000/demo/class.html)

---

## 🔌 3. 1-Line Embed Snippet & Configuration

```html
<script 
  src="https://YOUR-SERVER/plugin/botzbuddy.js" 
  data-api="https://YOUR-SERVER" 
  data-context="home" 
  data-character="wavy" 
  data-lang="en" 
  data-theme="#FFB13B" 
  data-position="right" 
  data-teacher="false" 
  data-demo="true">
</script>
```

### HTML `data-*` Configuration Options:
| Attribute | Options | Description | Default |
| :--- | :--- | :--- | :--- |
| `data-api` | URL | Server API endpoint | Current origin |
| `data-context` | `home` \| `kit` \| `class` \| `workshop` | Touchpoint context across the Funobotz ecosystem | `home` |
| `data-character`| Character ID (`wavy`, `quacky`, `petalo`, etc.) | Initial greeting character | `wavy` |
| `data-lang` | `en` \| `ta` | Interface and dialogue language (English / Tamil) | `en` |
| `data-theme` | Hex Color | Primary brand accent color | `#FFB13B` |
| `data-position`| `right` \| `left` | Screen placement of floating avatar bubble | `right` |
| `data-teacher` | `true` \| `false` | Enables 3rd "Teacher View" live monitoring tab | `false` |
| `data-demo` | `true` \| `false` | Enables one-click benchmark profile chips (L-01…L-05) | `false` |

---

## 💻 4. Public JavaScript API (`window.BotzBuddy`)

```javascript
// Open / Close / Toggle widget panel
window.BotzBuddy.open();
window.BotzBuddy.close();
window.BotzBuddy.toggle();

// Dynamically set character or touchpoint context
window.BotzBuddy.setCharacter('tiko');
window.BotzBuddy.setContext('class');

// Load synthetic benchmark learner profile (L-01 to L-05)
window.BotzBuddy.loadProfile('L-04');

// Reset session state
window.BotzBuddy.reset();

// Listen to custom store & classroom events
window.BotzBuddy.on('kit', (kitData) => {
  console.log('User viewed official Funobotz kit:', kitData);
});
```

---

## 🗂️ Project Structure & REST API

```text
botzbuddy/            Python backend package
  main.py             FastAPI app: REST routes, CORS, static files, session TTL, hot reload
  brain.py            Adaptive brain: intents, routing, 5-stage mission engine
  twin.py             Learning Twin: mastery, XP ranks, signals, decision log
  classifier.py       3-tier question classifier (rules -> LLM -> keywords)
  explainer.py        Age-adaptive general-science explainer + lesson bridges
  analyzer.py         Teach-back analysis (LLM -> keyword fallback)
  llm.py              OpenAI / Gemini / Groq clients (httpx, async) + Gemini Vision
  registry.py         Characters, concepts, profiles loaded from data/
  safety.py           Mains-electricity, privacy and unsafe-topic guard
  storage.py          Curiosity Jar (in-memory, optional MongoDB)
data/                 Character, concept and learner-profile JSON (hot-reloaded)
public/plugin/        botzbuddy.js — the embeddable <script> widget
public/demo/          Demo pages (home, kit store, classroom)
tests/                pytest suite
```

| Method | Path | Purpose |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Service status and which LLM providers are configured |
| `GET` | `/api/characters` | Character registry |
| `GET` | `/api/concepts` | Concept library (sorted by `order`) |
| `GET` | `/api/profiles` | Benchmark learner profiles L-01…L-05 |
| `POST` | `/api/session` | Start a session → greeting, first mission, Learning Twin state |
| `POST` | `/api/chat` | Send `text` and/or a quick-reply `action` for a `sessionId` |
| `GET` | `/api/teacher/sessions?context=class` | Anonymised live Teacher View |
| `GET` | `/api/curiosity-jar` | Curiosity Jar summary and recent questions |
| `POST` | `/api/photo-check` | Gemini Vision feedback on a photo of a paper build |
| `POST` | `/api/admin/reload` | Force-reload the data registry |

---

## 🏛️ 5. System Architecture

```text
+-----------------------------------------------------------------------------------------+
|                         FUNOBOTZ ECOSYSTEM TOUCHPOINTS                                  |
|   [Main Website (home.html)]   [Zoho Store (kit.html)]   [Workshop Portal (class.html)] |
|                                             |                                           |
|                   +-------------------------v-------------------------+                 |
|                   |            BotzBuddy Single-File Plugin           |                 |
|                   |   (Shadow DOM, Web Speech TTS/Mic, Teacher View)  |                 |
|                   +-------------------------+-------------------------+                 |
+---------------------------------------------|-------------------------------------------+
                                              |  REST API (JSON)
                                              v
+-----------------------------------------------------------------------------------------+
|                                BOTZBUDDY ADAPTIVE ENGINE                                |
|                                                                                         |
|   +---------------------------------------------------------------------------------+   |
|   |                            Child Safety & Privacy Firewall                      |   |
|   |   Mains AC safety (No wall sockets), Privacy (No PII), Child-friendly redirect  |   |
|   +-----------------------------------------+---------------------------------------+   |
|                                             |                                           |
|   +-----------------------------------------v---------------------------------------+   |
|   |                          Learning Twin Model (botzbuddy/twin.py)                   |   |
|   |   Mastery Map (0-100), 4 Signals, XP Ranking Journey, Misconceptions Memory     |   |
|   +-----------------------------------------+---------------------------------------+   |
|                                             |                                           |
|   +-----------------------------------------v---------------------------------------+   |
|   |                           Adaptive Brain (botzbuddy/brain.py)                      |   |
|   |   * Intent Detection (Stuck / Fast-Track / Switch / Unapproved Lore Guard)      |   |
|   |   * Funobotz 5-Stage Mission Cycle:                                             |   |
|   |     Build -> Experiment -> Observe -> Explain -> Create                         |   |
|   |   * Multi-Factor Routing: Interest (+2), Concept (+15), Context (+5), Continuity|   |
|   +----------------------------+--------------------------------+-------------------+   |
|                                |                                |                       |
|   +----------------------------v----+              +------------v-------------------+   |
|   |      Talker Chain (llm.py)      |              | Teach-Back Analyzer (analyzer) |   |
|   |      Gemini -> Groq -> Draft    |              | Groq -> Gemini -> Keyword Rule |   |
|   |      Strict Grounding Check     |              | Misconception & Key Idea Score |   |
|   +---------------------------------+              +--------------------------------+   |
+-----------------------------------------------------------------------------------------+
```

---

## 🧠 6. Personalization, Mastery, & The 4 Signals

### The Funobotz 5-Stage Mission Cycle:
1. **🔨 BUILD**: Eco-friendly paper craft template folding & component assembly (or virtual parts sequence).
2. **🧪 EXPERIMENT**: Prediction inquiry (*"What do you think happens when...?"*).
3. **👀 OBSERVE**: Cause-and-effect inspection with 3 tap options.
4. **💡 EXPLAIN**: Child teaches back in their own words (analyzed for key ideas and misconceptions).
5. **🎨 CREATE**: Art + Engineering design challenge with 4 choices. Displays **Kit Card** (in `home`/`kit` contexts) or **"Show your teacher"** card (in `class`/`workshop` contexts).

### 4-Signal Multi-Modal Learning:
- 🗣️ **SAYS**: Typed or voice spoken inquiries.
- 👆 **CHOOSES**: Quick replies, prediction options, and creative choices.
- 🔨 **BUILDS**: Hands-on completion confirmations and virtual assembly tap sequences.
- 💡 **EXPLAINS**: Free-form teach-back conceptual explanations.

### Mastery & Ranking Rules (Prototype Values):
- **Correct micro-check**: `+10%`
- **Strong teach-back** (>=60% key ideas): `+20%` & `+25 XP`
- **Partial teach-back**: `+8%` & `+15 XP`
- **Build / Experiment completed**: `+10%` & `+10 XP`
- **Misconception detected**: `-5%` (stays on stage; shows fix; does not raise difficulty)
- **Stuck / Hint ladder**: `-3%` per hint tier (Hint → Example → Demo → Explanation)
- **Mastery Tiers**: `<40% Foundation` (simpler pacing) | `40–75% Developing` (standard) | `>75% Ready` (deep explanations & fast-track unlocked)
- **XP Journey Ranks**: `🌱 Explorer (0 XP)` → `🔧 Builder (30 XP)` → `🧪 Experimenter (70 XP)` → `🧠 Explainer (120 XP)` → `🚀 Creator (180 XP)`.

---

## 👩‍🏫 7. Teacher View (Live Classroom Monitor)

When embedded on class and workshop pages with `data-teacher="true"`, BotzBuddy activates a dedicated **"👩‍🏫 Teacher View"** tab:
- Polls `/api/teacher/sessions?context=class` every 5 seconds.
- Displays an anonymized real-time student table:
  * **Learner Label**: (`Learner 1`, `Learner 2`, etc. — zero student names or PII stored).
  * **Current Concept & Robot Friend**.
  * **Real-time Concept Mastery % & Rank**.
  * **Real-time Assistance Alert**: Highlights `Needs Help ⚠️` if a student has mastery `< 40%`, repeated stuck requests, or active misconceptions.

---

## 🛡️ 8. Grounding & Anti-Hallucination Guard

1. **Engine Decides WHAT is Taught; AI Decides HOW It Sounds**: The scientific knowledge tree and character facts are hardcoded in approved JSON registries.
2. **Strict Lore Defense**: When asked unapproved questions (e.g. character age, favorite movie, superpowers, or programming languages), the engine strictly refuses: *"I don't have an approved Funobotz fact about that yet, so I won't make one up. Want to explore an approved STEM topic instead?"*
3. **Generation Verification**: Any LLM response that is empty, exceeds 900 characters, or mentions characters not present in the draft is discarded in favor of the rule-based draft.

---

## 🤖 9. Official 12-Character Registry Status

| Character | Group | Status | Role | Concepts Taught | Official Kit Link |
| :--- | :---: | :--- | :--- | :--- | :--- |
| **Petalo** 🌸 | C | `verified` | Explorer | `light_everyday`, `light_safety` | [Petalo Kit](https://store.funobotz.com/products/petalo/3295000000000718042) |
| **Quacky** 🦆 | A | `verified` | Builder | `simple_circuit`, `battery_energy`, `motor_motion` | [Quacky Kit](https://store.funobotz.com/products/quacky-duck/3295000000000059176) |
| **Tolly** 🚦 | B | `verified` | Inventor | `simple_circuit`, `led_sequence`, `timer_circuit` | [Tolly Kit](https://store.funobotz.com/products/tollgate/3295000000000060352) |
| **Tiko** 🦂 | A | `verified` | Mechanic | `simple_circuit`, `motor_motion`, `troubleshooting` | [Tiko Kit](https://store.funobotz.com/products/tiko-scorpio/3295000000000059216) |
| **Emoti** 😊 | B | `behaviour_only` | Companion | Known expression behaviour; suggests verified friend | [Store](https://store.funobotz.com) |
| **Mimo** 🐶 | C | `behaviour_only` | Pet | Known playful pet behaviour; suggests verified friend | [Store](https://store.funobotz.com) |
| **Kuttybot** 🤖 | A | `behaviour_only` | Speaker | Known talking robot behaviour; suggests verified friend | [Store](https://store.funobotz.com) |
| **Wavy** 👋 | A | `awaiting_concept_sheet` | Host | Welcoming guide & router; never invents science | [Store](https://store.funobotz.com) |
| **Kutty Omni** 🛸 | B | `awaiting_concept_sheet` | Explorer | Declares lessons coming soon; suggests verified | [Store](https://store.funobotz.com) |
| **Chicky** 🐥 | B | `awaiting_concept_sheet` | Explorer | Declares lessons coming soon; suggests verified | [Store](https://store.funobotz.com) |
| **Omni** 🔮 | C | `awaiting_concept_sheet` | Explorer | Declares lessons coming soon; suggests verified | [Store](https://store.funobotz.com) |
| **Cuby** 🧊 | C | `awaiting_concept_sheet` | Builder | Declares lessons coming soon; suggests verified | [Store](https://store.funobotz.com) |

---

## 🎯 10. Synthetic Learner Profiles (Pack 2 Benchmark)

- **L-01 (Age 8, Light/Colors)**: First-time learner → Routes to **Petalo 🌸**, selects `light_everyday`, uses story-like young explanations.
- **L-02 (Age 11, Movement/Machines)**: Knows battery connections → Routes to **Quacky 🦆**, builds on `motor_motion`.
- **L-03 (Age 9, Stories/Characters)**: Short mode active → Generates punchy <=2 sentence explanations with high tap interactivity.
- **L-04 (Age 12, Electronics)**: Already mastered `simple_circuit` (80%+) → Skips basics, routes to **Tolly 🚦** with deep physics explanations on timing intervals and LED sequencing.
- **L-05 (Age 10, Explorer)**: Open curiosity → **Wavy 👋** initiates open discovery dialogue with tap options.

---

## 🔄 11. Hot-Reloading & Adding New Characters

To add a new Funobotz character or concept sheet, simply drop a JSON file into `data/characters/new_bot.json`. The server checks `data/` every second and reloads the live registry automatically with zero restarts or code changes. You can also call `POST /api/admin/reload`.

---

## 🔒 12. Safety, Privacy & Electrical Hazard Defense

- **Mains Electricity Defense**: Instantly catches mentions of wall outlets, 220V/110V, or wall plugs and enforces: *"Safety first! Only use small batteries (like AA or 3V coin cells) for our robot circuits, never wall sockets or mains power."*
- **Child Privacy**: Zero storage of names, phone numbers, email addresses, or birthdays.
- **Child Well-Being**: Harmful or unsafe topics trigger a gentle redirect to a trusted teacher or grown-up.

---

---

## 🌟 13. Innovations (Breakthrough Adaptive Learning Features)

BotzBuddy incorporates 7 pedagogical innovations tailored specifically for Funobotz paper robotics:

### 🤝 Innovation 1: Character Team-Up (Cross-Character Concept Synthesis)
* **Why it helps learning:** In robotics, the same fundamental concept (e.g. electric motors or closed circuits) produces completely different physical actions depending on mechanical linkages and origami folds. Character Team-Up shows the child that the same law of science powers diverse robots, building deep transferrable mental models instead of rote kit-specific memorization.
* **How to use it:** When studying a concept taught by 2 or more verified characters (e.g. `motor_motion` taught by Quacky & Tiko, or `simple_circuit` taught by Quacky, Tolly & Tiko), tap the **"🤝 Team-Up!"** quick reply. Both robots appear side-by-side with a dual animation, each sharing how the concept manifests in their build using only approved facts. The child is prompted: *"What's the same in both of our robots?"*, analyzing their comparative teach-back for bonus mastery.

### 🏺 Innovation 2: Curiosity Jar (Turning Unsupported Questions into R&D Insights)
* **Why it helps learning:** Children are naturally curious and often ask questions outside the robot's current approved concept sheets (e.g., *"What is Cuby's favourite food?"* or *"How do drones fly?"*). Instead of hallucinating fiction, BotzBuddy honestly refuses, praises their curiosity, and drops the question into the **Curiosity Jar**.
* **How to use it:** Whenever an unapproved or off-topic STEM question is asked, BotzBuddy responds: *"I don't have an approved Funobotz fact about that yet, so I won't make one up! I've dropped your question into the Curiosity Jar so the Funobotz team can see what kids want to learn!"*. Questions are sanitized (PII, phone numbers, and emails removed) and accessible via `GET /api/curiosity-jar` and the **Teacher View tab** to guide future kit creation and lesson planning.

### 🎯 Innovation 3: Confidence Meter (A 5th Multi-Modal Learning Signal)
* **Why it helps learning:** Metacognition (knowing what you know and what you don't know) is a crucial predictor of STEM mastery. A child who answers incorrectly but feels *Very Sure* has an entrenched **misconception** that requires active unlearning, whereas a child who is *Not Sure* needs encouragement and spaced revisit.
* **How to use it:** After every micro-check and observation step, three confidence buttons appear: `😟 Not sure`, `🙂 Kind of sure`, `😎 Very sure`. 
  - **Correct + Very sure**: `+5` bonus mastery (moves faster).
  - **Correct + Not sure**: Schedules a **Memory Boost** spaced revisit.
  - **Wrong + Not sure**: Encouraging tone with progressive hint ladder.
  - **Wrong + Very sure**: Triggers **Misconception Radar** (concrete experiment + `-5` mastery).
  - Tracked under the 5th signal (`confidence`) in the Learning Twin tab.

### 🖨️ Innovation 4: Printable STEM Challenge Cards (Back to Hands-On Paper Building)
* **Why it helps learning:** Screen time should ignite real-world tactile making. Funobotz kits (especially Petalo) utilize physical challenge cards. At the end of every mission, BotzBuddy generates a personalized, beautifully formatted A6 paper-craft challenge card connecting their digital lesson directly to a hands-on crafting task.
* **How to use it:** Upon completing the Create stage, tap **"🖨️ Print My Challenge Card"**. This opens a clean, printable popup window formatted with A6 paper styling (`@page { size: A6; margin: 8mm; }`), step-by-step assembly steps, an electrical safety tip (*"Use only small batteries, never wall sockets!"*), and the child's earned rank badge. Contains zero personal data.

### ✨ Innovation 5: Memory Boost (Spaced Revisit for Long-Term Retention)
* **Why it helps learning:** Ebbinghaus's forgetting curve shows that newly acquired STEM concepts decay without spaced repetition. Memory Boost automatically identifies concepts with developing mastery (`40–75%`) or *"Correct + Not sure"* answers and revisits them at optimal spaced intervals.
* **How to use it:** After completing 2–3 turns or moving to a new mission, BotzBuddy seamlessly inserts a 1-question Memory Boost from that developing concept's micro-check: *"Quick memory boost! Remember how Tolly's lights change?"*. Correct answer awards `+10` mastery and a sparkle animation; incorrect answer gives a short hint with no penalty. Tracked in the Learning Twin tab under **"Memory boosts"**.

### 📷 Innovation 6: Photo Check of Paper Builds (Gemini Vision)
* **Why it helps learning:** Allows children to show their real, physical paper origami creations and circuit tape layouts to their robot companion for visual encouragement and validation.
* **How to use it:** During the **Build** and **Create** steps, tap the **📷 Photo Check** button in the chat footer to upload a photo (JPEG/PNG/WebP, max 3 MB). BotzBuddy automatically resizes the image client-side to max 1024px using HTML5 Canvas and calls Google Gemini Vision to evaluate the build against approved key ideas. Returns two encouraging sentences with one thing done well and one thing to check. Zero image data is persisted. If no API key is set, fails gracefully with an encouraging prompt.

### 🍃 Innovation 7: Optional MongoDB Persistence
* **Why it helps learning:** Enables multi-session persistence across classroom tablets and home devices while maintaining 100% server operability in-memory without any database dependencies.
* **How to use it:** If `MONGODB_URI` is provided in `.env` (and `pip install pymongo`), Curiosity Jar entries are also saved to MongoDB; if unset, BotzBuddy defaults to in-memory storage with zero setup friction.

### 🧠 Innovation 8: Age-Adaptive Explainer & 3-Tier Question Classifier (OpenAI / Gemini / Groq)
* **Why it helps learning:** Children of different ages grasp science differently. A 7-year-old needs sensory, story-driven analogies (curd = milk sleeping under a cozy blanket of good bacteria); a 10-year-old understands mechanical actions (bacteria eating milk sugar into lactic acid); a 13-year-old needs real chemistry (Lactobacillus, pH drops, protein denaturation). Furthermore, asking random science questions shouldn't distract from hands-on robotics—it should **bridge** back to approved Funobotz lessons!
* **How it works:**
  1. **3-Tier Classifier:**
     - **Tier 1 (`funobotz_stem`):** Exact Funobotz character concepts & approved facts (grounded engine, zero hallucination).
     - **Tier 2 (`general_stem`):** Broad science/nature/engineering questions (e.g., *"Why is sky blue?"*, *"How does curd form?"*). Routed to the Age-Adaptive Explainer.
     - **Tier 3 (`non_stem`):** Sports, gaming, gossip, or off-topic. Warmly redirected to science with no off-topic rambling.
  2. **Fine-Grained 3 Age Bands:**
     - `little` (ages 6–8): Max 2 sentences, sensory metaphors, 0 technical jargon.
     - `middle` (ages 9–11): 2–3 sentences, step-by-step physical mechanism.
     - `senior` (ages 12–14): 3–4 sentences, real science terms (pH, photons, scattering, oxidation).
  3. **Bridge to Approved Lessons:** Every general science answer connects to an approved Funobotz character (e.g., curd bacteria → Petalo's nature & light / Quacky's energy).
  4. **Strict Classroom Mode:** Set `data-general-stem="off"` or `.env` `GENERAL_STEM_MODE=off` to keep classroom workshops laser-focused on curriculum kits!
  5. **Resilient Provider Chain:** `OpenAI (gpt-4o-mini)` → `Gemini (gemini-2.5-flash)` → `Groq (qwen/qwen3.8-27b)` → Deterministic Fallback Template.

---

## ⏱️ 14. 1-Minute Hackathon Demo Script

Here is the exact 60-second pitch and demonstration flow:

1. **The Age-Adaptive Explainer (30s):**
   - Open [http://localhost:3000/demo/home.html](http://localhost:3000/demo/home.html) with BotzBuddy open.
   - Set child age to **7** (or pick L-01 chip). Ask: *"Why does milk turn into curd?"*
     → **Answer:** *"Good, friendly little bacteria cuddle in warm milk and turn it into thick, yummy curd like magic! Just like Petalo loves sunny warmth, bacteria need the right warmth to grow."* + Bridge button to Petalo 🌸!
   - Now switch learner profile to **Senior (Age 13 / L-04)**. Ask the exact same question: *"Why does milk turn into curd?"*
     → **Answer:** *"Lactobacillus bacteria ferment lactose sugar into lactic acid, lowering the milk's pH and causing casein proteins to coagulate into solid curd."*
2. **Strict Classroom Guardrail (15s):**
   - Open [http://localhost:3000/demo/class.html](http://localhost:3000/demo/class.html) (`data-general-stem="off"`).
   - Ask the same curd question in class.
     → **Response:** *"Great science question! In our workshop today, we're focusing on our robot kits. I've dropped your question into the Curiosity Jar so you can explore it after class!"*
3. **Character Team-Up & Learning Twin (15s):**
   - Tap **"🤝 Team-Up!"** on `motor_motion` → Quacky 🦆 and Tiko 🦂 collaborate.
   - Switch to **"Learning Twin"** tab → Show live 5-signal radar (mastery, style, pace, confidence, curiosity domains).

---

## 📜 15. License & Acknowledgments
Built for the **Funobotz Hackathon**. All character concepts, product assets, and official facts copyright **Funobotz Paper Robotics Pvt. Ltd.**


