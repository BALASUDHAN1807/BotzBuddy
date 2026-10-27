# BotzBuddy — The Adaptive Funobotz STEM Companion

> **"We don't make the child adapt to the lesson. We make the lesson adapt to the child."**

BotzBuddy is an adaptive STEM learning companion for **Funobotz Paper Robotics** — eco-friendly paper robotics kits and classes for children aged **6 to 14**. It guides each child through hands-on missions with Funobotz robot characters, adapts to their age, interests and mastery, refuses to invent facts, and gives teachers a live view of the class.

**100% Python:** a **Streamlit** app for learners and teachers, a **FastAPI** REST API for integrations, and one shared adaptive engine.

---

## ⚡ 1. Quick Start

Requires **Python 3.11+**.

```bash
# 1. Create a virtual environment and install dependencies
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt

# 2. Configure environment (optional: the rule-based fallback works 100% without API keys)
cp .env.example .env

# 3. Run the test suite (engine, REST API and Streamlit UI)
pytest

# 4. Launch the app → http://localhost:8501
streamlit run streamlit_app.py
```

Optional REST API for other apps (Swagger docs at http://localhost:8000/docs):

```bash
uvicorn botzbuddy.main:app --reload --port 8000
```

Docker:

```bash
docker build -t botzbuddy .
docker run -p 8501:8501 --env-file .env botzbuddy
```

The app also deploys as-is to **Streamlit Community Cloud** (entry file: `streamlit_app.py`; add API keys under *Secrets* as environment variables).

---

## 🖥️ 2. Using the App

The sidebar sets up the learner, then **🚀 Start learning mission** begins a session.

| Sidebar setting | What it does |
| :--- | :--- |
| **Learner profile** | A benchmark profile (L-01…L-05) or a custom learner |
| **Where is BotzBuddy?** | Context: learning platform (home), kit store product page, classroom, or school workshop |
| **Kit page being viewed** | (Kit store) Greets with that kit's robot, e.g. Tiko on `tiko-scorpio` |
| **About the learner** | Age 6–14, interests, experience, English/Tamil, short answers, deeper explanations, explorer mode |
| **Answer general science questions** | On: age-adaptive science answers. Off: strict curriculum mode |

The app has three tabs:

- **💬 Learn** — the mission chat. Robot characters speak in turn; quick-reply buttons, a virtual parts workbench, the always-available *I already know this / I'm stuck / Change my interest* actions, **🤖 Meet the robots** switcher, and **📷 Photo check**. Free text goes in the chat box (questions or teach-backs).
- **🧬 Learning Twin** — rank and XP journey, the five learning signals, mastery per concept, curiosity domains, confidence, misconceptions, and a log of *why* BotzBuddy made each decision.
- **👩‍🏫 Teacher View** — live, anonymised table of every learner on the server with *Needs help* alerts, plus the Curiosity Jar insights.

---

## 🗂️ 3. Project Structure

```text
streamlit_app.py      Streamlit entry point
botzbuddy/
  ui.py               Streamlit UI: Learn, Learning Twin, Teacher View
  service.py          Session store + create / chat / photo-check (shared by UI and API)
  brain.py            Adaptive brain: intents, routing, 5-stage mission engine
  twin.py             Learning Twin: mastery, XP ranks, signals, decision log
  classifier.py       3-tier question classifier (rules -> LLM -> keywords)
  explainer.py        Age-adaptive general-science explainer + lesson bridges
  analyzer.py         Teach-back analysis (LLM -> keyword fallback)
  llm.py              OpenAI / Gemini / Groq clients (async httpx) + Gemini Vision
  registry.py         Characters, concepts and profiles loaded from data/
  safety.py           Mains-electricity, privacy and unsafe-topic guard
  storage.py          Curiosity Jar (in-memory, optional MongoDB)
  main.py             FastAPI REST API
data/                 Character, concept and learner-profile JSON (hot-reloaded)
tests/                pytest suite: acceptance, API and UI (Streamlit AppTest)
.streamlit/           Streamlit theme and server config
```

---

## 🔌 4. REST API (FastAPI)

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

Example:

```bash
curl -X POST localhost:8000/api/session -H "Content-Type: application/json" \
  -d '{"context": "home", "age": 9, "interests": ["light"], "generalStem": "on"}'
```

---

## 🏛️ 5. System Architecture

```text
   Streamlit app (ui.py)                    Other apps
   Learn · Learning Twin · Teacher View     (REST clients)
              |                                  |
              |                        FastAPI REST API (main.py)
              |                                  |
              +--------------> service.py <------+
                        (session store, photo check)
                                  |
   +------------------------------v-------------------------------+
   |                 BOTZBUDDY ADAPTIVE ENGINE                    |
   |  safety.py   Child safety & privacy firewall                 |
   |  twin.py     Learning Twin: mastery 0-100, signals, XP ranks |
   |  brain.py    Intents (stuck / fast-track / switch / lore     |
   |              guard) + Build -> Experiment -> Observe ->      |
   |              Explain -> Create, multi-factor robot routing   |
   |  classifier.py + explainer.py   3-tier questions, age bands  |
   |  analyzer.py Teach-back: key ideas + misconceptions          |
   |  llm.py      Talker: Gemini -> OpenAI -> Groq -> draft       |
   |              (strict grounding check)                        |
   |  registry.py data/*.json   storage.py Curiosity Jar          |
   +--------------------------------------------------------------+
```

---

## 🧠 6. Personalization, Mastery, & The 4 Signals

### The Funobotz 5-Stage Mission Cycle:
1. **🔨 BUILD**: Eco-friendly paper craft template folding & component assembly (or virtual parts sequence).
2. **🧪 EXPERIMENT**: Prediction inquiry (*"What do you think happens when...?"*).
3. **👀 OBSERVE**: Cause-and-effect inspection with 3 options.
4. **💡 EXPLAIN**: Child teaches back in their own words (analyzed for key ideas and misconceptions).
5. **🎨 CREATE**: Art + Engineering design challenge with 4 choices. Displays **Kit Card** (in `home`/`kit` contexts) or **"Show your teacher"** card (in `class`/`workshop` contexts).

### 4-Signal Multi-Modal Learning:
- 🗣️ **SAYS**: Typed or voice spoken inquiries.
- 👆 **CHOOSES**: Quick replies, prediction options, and creative choices.
- 🔨 **BUILDS**: Hands-on completion confirmations and virtual parts assembly.
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

The **"👩‍🏫 Teacher View"** tab of the Streamlit app monitors every learner connected to the server (also available as `GET /api/teacher/sessions?context=class`):
- Refreshes automatically every 5 seconds and can be filtered by context (classroom, workshop, home, kit store).
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
- **L-03 (Age 9, Stories/Characters)**: Short mode active → Generates punchy <=2 sentence explanations with lots of quick-reply choices.
- **L-04 (Age 12, Electronics)**: Already mastered `simple_circuit` (80%+) → Skips basics, routes to **Tolly 🚦** with deep physics explanations on timing intervals and LED sequencing.
- **L-05 (Age 10, Explorer)**: Open curiosity → **Wavy 👋** initiates open discovery dialogue with quick-reply options.

---

## 🔄 11. Hot-Reloading & Adding New Characters

To add a new Funobotz character or concept sheet, simply drop a JSON file into `data/characters/new_bot.json`. Both the Streamlit app and the API notice changes in `data/` and reload the live registry automatically, with zero restarts or code changes. You can also call `POST /api/admin/reload`.

---

## 🔒 12. Safety, Privacy & Electrical Hazard Defense

- **Mains Electricity Defense**: Instantly catches mentions of wall outlets, 220V/110V, or wall plugs and enforces: *"Safety first! Only use small batteries (like AA or 3V coin cells) for our robot circuits, never wall sockets or mains power."*
- **Child Privacy**: Zero storage of names, phone numbers, email addresses, or birthdays.
- **Child Well-Being**: Harmful or unsafe topics trigger a gentle redirect to a trusted teacher or grown-up.

---

## 🌟 13. Innovations (Breakthrough Adaptive Learning Features)

BotzBuddy incorporates 7 pedagogical innovations tailored specifically for Funobotz paper robotics:

### 🤝 Innovation 1: Character Team-Up (Cross-Character Concept Synthesis)
* **Why it helps learning:** In robotics, the same fundamental concept (e.g. electric motors or closed circuits) produces completely different physical actions depending on mechanical linkages and origami folds. Character Team-Up shows the child that the same law of science powers diverse robots, building deep transferrable mental models instead of rote kit-specific memorization.
* **How to use it:** When studying a concept taught by 2 or more verified characters (e.g. `motor_motion` taught by Quacky & Tiko, or `simple_circuit` taught by Quacky, Tolly & Tiko), tap the **"🤝 Team-Up!"** quick reply. Both robots appear together, each sharing how the concept manifests in their build using only approved facts. The child is prompted: *"What's the same in both of our robots?"*, analyzing their comparative teach-back for bonus mastery.

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
* **How to use it:** Upon completing the Create stage, click **"🖨️ Download printable card"**. This downloads a printable card formatted with A6 paper styling (`@page { size: A6; margin: 8mm; }`), step-by-step assembly steps, an electrical safety tip (*"Use only small batteries, never wall sockets!"*), and the child's earned rank badge. Contains zero personal data.

### ✨ Innovation 5: Memory Boost (Spaced Revisit for Long-Term Retention)
* **Why it helps learning:** Ebbinghaus's forgetting curve shows that newly acquired STEM concepts decay without spaced repetition. Memory Boost automatically identifies concepts with developing mastery (`40–75%`) or *"Correct + Not sure"* answers and revisits them at optimal spaced intervals.
* **How to use it:** After completing 2–3 turns or moving to a new mission, BotzBuddy seamlessly inserts a 1-question Memory Boost from that developing concept's micro-check: *"Quick memory boost! Remember how Tolly's lights change?"*. Correct answer awards `+10` mastery and a sparkle animation; incorrect answer gives a short hint with no penalty. Tracked in the Learning Twin tab under **"Memory boosts"**.

### 📷 Innovation 6: Photo Check of Paper Builds (Gemini Vision)
* **Why it helps learning:** Allows children to show their real, physical paper origami creations and circuit tape layouts to their robot companion for visual encouragement and validation.
* **How to use it:** During the **Build** and **Create** steps, open **📷 Photo check of my paper build** under the chat and upload a photo (JPEG/PNG/WebP, max 8 MB). BotzBuddy calls Google Gemini Vision to evaluate the build against approved key ideas. Returns two encouraging sentences with one thing done well and one thing to check. Zero image data is persisted. If no API key is set, fails gracefully with an encouraging prompt.

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
  4. **Strict Classroom Mode:** Turn off **"Answer general science questions"** in the sidebar (off by default for Classroom and Workshop) or set `GENERAL_STEM_MODE=off` in `.env` to keep classroom workshops laser-focused on curriculum kits!
  5. **Resilient Provider Chain:** `OpenAI (gpt-4o-mini)` → `Gemini (GEMINI_MODEL)` → `Groq (GROQ_MODEL)` → Deterministic Fallback Template.

---

---

## ⏱️ 14. 1-Minute Demo Script

1. **Age-adaptive explainer (30s):** start a session with profile **L-01** (age 8) and ask *"Why does milk turn into curd?"* in the chat. Then start a new session with **L-04** (age 12) and ask the same question — the answer moves from a playful analogy to lactic-acid bacteria and protein coagulation, and both bridge back to a Funobotz robot. (Needs an OpenAI, Gemini or Groq key.)
2. **Strict classroom guardrail (15s):** set *Where is BotzBuddy?* to **Classroom** (general science turns off), start, and ask the same question → it is saved to the Curiosity Jar and bridged back to today's lesson.
3. **Team-Up & Learning Twin (15s):** open **🤖 Meet the robots → Quacky**, finish the build and pick an observation, then tap **🤝 Team-Up!** → Quacky 🦆 and Tiko 🦂 compare how the same circuit powers both robots. Switch to **🧬 Learning Twin** and **👩‍🏫 Teacher View** to show the live data.

---

## 📜 15. License & Acknowledgments
Built for the **Funobotz Hackathon**. All character concepts, product assets, and official facts copyright **Funobotz Paper Robotics Pvt. Ltd.**
