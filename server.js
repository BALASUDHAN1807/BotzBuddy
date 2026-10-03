require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const {
  reloadAll,
  getAllCharacters,
  getCharacter,
  getAllConcepts,
  getConcept,
  getAllProfiles,
  getProfile
} = require('./src/registry');
const { LearningTwin } = require('./src/twin');
const { processMessage, initializeSession } = require('./src/brain');
const { getCuriosityJarSummary, curiosityJar } = require('./src/storage');
const { photoCheckVision } = require('./src/llm');

const app = express();
const PORT = process.env.PORT || 3000;

// CORS setup
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(s => s.trim())
  : '*';

if (allowedOrigins === '*') {
  app.use(cors());
} else {
  app.use(cors({ origin: allowedOrigins }));
}

app.use(express.json({ limit: '50kb' }));

// In-memory sessions store (Session TTL: 2 hours)
const sessions = new Map();
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;

function cleanupOldSessions() {
  const now = Date.now();
  for (const [id, twin] of sessions.entries()) {
    if (now - twin.lastActiveAt > SESSION_TTL_MS) {
      sessions.delete(id);
    }
  }
}
setInterval(cleanupOldSessions, 15 * 60 * 1000);

// -------------------------------------------------------------
// Static file serving & redirects
// -------------------------------------------------------------
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.redirect('/demo/');
});

// -------------------------------------------------------------
// API Endpoints
// -------------------------------------------------------------

// 1. Health check
app.get('/api/health', (req, res) => {
  const geminiAvailable = !!(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 0);
  const groqAvailable = !!(process.env.GROQ_API_KEY && process.env.GROQ_API_KEY.trim().length > 0);
  const openaiAvailable = !!(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim().length > 0);

  res.json({
    ok: true,
    service: 'BotzBuddy Adaptive Engine',
    timestamp: new Date().toISOString(),
    generalStemModeDefault: process.env.GENERAL_STEM_MODE || 'on',
    providers: {
      openai: openaiAvailable,
      gemini: geminiAvailable,
      groq: groqAvailable,
      ruleBasedFallback: true
    }
  });
});

// 2. Characters registry
app.get('/api/characters', (req, res) => {
  const chars = getAllCharacters().map(c => ({
    id: c.id,
    name: c.name,
    group: c.group,
    status: c.status,
    role: c.role,
    emoji: c.emoji,
    color: c.color,
    avatarUrl: c.avatarUrl,
    facts: c.facts,
    concepts: c.concepts,
    productSlug: c.productSlug,
    kitUrl: c.kitUrl,
    voiceStyle: c.voiceStyle,
    interestTags: c.interestTags
  }));
  res.json(chars);
});

// 3. Concepts library
app.get('/api/concepts', (req, res) => {
  res.json(getAllConcepts());
});

// 4. Profiles list
app.get('/api/profiles', (req, res) => {
  res.json(getAllProfiles());
});

// 5. Create session
app.post('/api/session', async (req, res) => {
  try {
    const {
      context,
      profileId,
      age,
      interests,
      knowledge,
      language,
      characterId,
      productSlug,
      shortMode,
      wantsDepth,
      explorer,
      generalStem,
      generalStemMode
    } = req.body || {};

    const twin = new LearningTwin({
      context: context || 'home',
      profileId,
      age,
      interests,
      knowledge,
      language,
      characterId,
      shortMode,
      wantsDepth,
      explorer,
      generalStemMode: generalStem !== undefined ? (generalStem === 'on' || generalStem === true) : (generalStemMode !== undefined ? generalStemMode : undefined)
    });

    sessions.set(twin.sessionId, twin);

    const initResult = await initializeSession({
      twin,
      characterSlug: productSlug || characterId
    });

    res.json({
      sessionId: twin.sessionId,
      ...initResult
    });
  } catch (err) {
    console.error('[API /api/session] Error:', err);
    res.status(500).json({ error: 'Failed to initialize session', details: err.message });
  }
});

// 6. Teacher View: Active Sessions Endpoint
app.get('/api/teacher/sessions', (req, res) => {
  try {
    const reqContext = req.query.context; // e.g. "class" or "workshop"
    const activeSessions = [];
    let idx = 1;

    for (const [id, twin] of sessions.entries()) {
      if (!reqContext || twin.context === reqContext || reqContext === 'all') {
        activeSessions.push(twin.toTeacherSummary(idx++));
      }
    }

    res.json({
      ok: true,
      context: reqContext || 'all',
      count: activeSessions.length,
      sessions: activeSessions
    });
  } catch (err) {
    console.error('[API /api/teacher/sessions] Error:', err);
    res.status(500).json({ error: 'Failed to fetch teacher sessions', details: err.message });
  }
});

// 6. Chat & Action handler
app.post('/api/chat', async (req, res) => {
  try {
    const { sessionId, text, action, generalStem } = req.body || {};
    if (!sessionId) {
      return res.status(400).json({ error: 'Missing sessionId' });
    }

    let twin = sessions.get(sessionId);
    if (!twin) {
      // Re-create session if expired or not found
      twin = new LearningTwin({
        sessionId,
        generalStemMode: generalStem !== undefined ? (generalStem === 'on' || generalStem === true) : undefined
      });
      sessions.set(sessionId, twin);
    } else if (generalStem !== undefined) {
      twin.generalStemMode = (generalStem === 'on' || generalStem === true);
    }

    const response = await processMessage({
      twin,
      text: text || '',
      action: action || null
    });

    res.json(response);
  } catch (err) {
    console.error('[API /api/chat] Error:', err);
    res.status(500).json({ error: 'Failed to process message', details: err.message });
  }
});


// 7. Curiosity Jar: List and summaries
app.get('/api/curiosity-jar', (req, res) => {
  try {
    const summary = getCuriosityJarSummary();
    res.json(summary);
  } catch (err) {
    console.error('[API /api/curiosity-jar] Error:', err);
    res.status(500).json({ error: 'Failed to retrieve curiosity jar', details: err.message });
  }
});

// 8. Photo Check of Paper Builds (Gemini Vision with graceful fallback)
app.post('/api/photo-check', async (req, res) => {
  try {
    const { sessionId, image, concept: conceptId } = req.body || {};
    let twin = sessions.get(sessionId);
    if (!twin) {
      twin = new LearningTwin({ sessionId });
      sessions.set(sessionId, twin);
    }

    const charId = twin.currentCharacter || 'quacky';
    const character = getCharacter(charId) || getAllCharacters().find(c => c.status === 'verified') || getAllCharacters()[0];
    const concept = getConcept(conceptId || twin.currentConcept) || getAllConcepts()[0];

    let visionFeedback = '';
    let provider = 'rule-based';

    try {
      visionFeedback = await photoCheckVision({
        imageBase64: image,
        concept,
        character,
        age: twin.age || 9
      });
      provider = 'gemini';
    } catch (err) {
      console.warn('[PhotoCheck] Vision API error/no key, using graceful fallback:', err.message);
      visionFeedback = "I can't see photos right now, but tell me what you built!";
    }

    // Award +10 mastery and build signal if successful
    if (provider === 'gemini') {
      twin.recordSignal('build');
      twin.adjustMastery(concept.id, 10);
      twin.addXp(10);
    }

    res.json({
      ok: true,
      feedback: visionFeedback,
      provider,
      character: {
        id: character.id,
        name: character.name,
        emoji: character.emoji
      },
      xpAwarded: provider === 'gemini' ? 10 : 0
    });
  } catch (err) {
    console.error('[API /api/photo-check] Error:', err);
    res.status(500).json({
      ok: false,
      feedback: "I can't see photos right now, but tell me what you built!",
      error: err.message
    });
  }
});

// 9. Hot-reload endpoint
app.post('/api/admin/reload', (req, res) => {
  reloadAll();
  const chars = getAllCharacters();
  const concepts = getAllConcepts();
  const profiles = getAllProfiles();
  res.json({
    ok: true,
    reloadedAt: new Date().toISOString(),
    charactersCount: chars.length,
    conceptsCount: concepts.length,
    profilesCount: profiles.length
  });
});

// Start Server
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n==================================================`);
    console.log(`🤖 BotzBuddy Server running at: http://localhost:${PORT}`);
    console.log(`🛍️ Fake Store Demo at:         http://localhost:${PORT}/demo/`);
    console.log(`==================================================\n`);
  });
}

module.exports = app;
