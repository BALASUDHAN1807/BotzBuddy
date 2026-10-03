// Storage Module: In-Memory + Optional MongoDB Persistence
// Handles Curiosity Jar storage and session persistence safely.

let isMongoConnected = false;
let CuriosityModel = null;

// Optional MongoDB setup if MONGODB_URI is provided
if (process.env.MONGODB_URI) {
  try {
    const mongoose = require('mongoose');
    mongoose.connect(process.env.MONGODB_URI)
      .then(() => {
        isMongoConnected = true;
        console.log('🍃 [MongoDB] Connected successfully for persistence.');
        const curiositySchema = new mongoose.Schema({
          question: String,
          characterAsked: String,
          ageBand: String,
          context: String,
          timestamp: { type: Date, default: Date.now }
        });
        CuriosityModel = mongoose.model('CuriosityJar', curiositySchema);
      })
      .catch(err => {
        console.warn('🍃 [MongoDB] Connection error, continuing in-memory:', err.message);
      });
  } catch (err) {
    console.log('🍃 [Storage] Running in-memory storage (mongoose not loaded or optional).');
  }
}

const curiosityJar = [];

// Cleanse personal info, phone numbers, emails, large numeric sequences
function sanitizeQuestion(rawText) {
  if (!rawText || typeof rawText !== 'string') return '';
  let cleaned = rawText
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '')
    .replace(/\b(?:\+?\d{1,3}[-.\s]?)?\d{10}\b/g, '')
    .replace(/\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g, '')
    .replace(/\b\d{4,}\b/g, '') // strip long digit sequences (passwords, IDs), keep small numbers like 7 x 8
    .replace(/\s+/g, ' ')
    .trim();

  if (cleaned.length > 200) {
    cleaned = cleaned.substring(0, 200).trim();
  }
  return cleaned;
}

function addCuriosityQuestion({ question, characterAsked = 'wavy', ageBand = 'young', context = 'home', tier = 'unsupported_fact', domain = 'other' }) {
  const sanitized = sanitizeQuestion(question);
  if (!sanitized || sanitized.length < 3) return null;

  const entry = {
    id: `q_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    question: sanitized,
    characterAsked: characterAsked || 'wavy',
    ageBand: ageBand || 'young',
    context: context || 'home',
    tier: tier || 'unsupported_fact',
    domain: domain || 'other',
    timestamp: new Date().toISOString()
  };

  curiosityJar.unshift(entry);
  if (curiosityJar.length > 50) {
    curiosityJar.pop();
  }

  // If MongoDB is active, asynchronously save
  if (isMongoConnected && CuriosityModel) {
    CuriosityModel.create({
      question: sanitized,
      characterAsked,
      ageBand,
      context,
      tier,
      domain,
      timestamp: new Date()
    }).catch(e => console.warn('[MongoDB] Save error:', e.message));
  }

  return entry;
}


function getCuriosityJarSummary() {
  const byCharacter = {};
  const keywordCounts = {};

  const stopWords = new Set(['what', 'is', 'the', 'how', 'why', 'can', 'does', 'and', 'a', 'to', 'in', 'of', 'for', 'you', 'your', 'about', 'tell', 'me']);

  for (const item of curiosityJar) {
    // Character counts
    byCharacter[item.characterAsked] = (byCharacter[item.characterAsked] || 0) + 1;

    // Keyword extraction
    const words = item.question.toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/);
    for (const w of words) {
      if (w.length > 2 && !stopWords.has(w)) {
        keywordCounts[w] = (keywordCounts[w] || 0) + 1;
      }
    }
  }

  // Top keywords sorted
  const topKeywords = Object.entries(keywordCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word, count]) => ({ word, count }));

  return {
    total: curiosityJar.length,
    byCharacter,
    topKeywords,
    recentQuestions: curiosityJar.slice(0, 20),
    storageMode: isMongoConnected ? 'mongodb' : 'in-memory'
  };
}

module.exports = {
  addCuriosityQuestion,
  getCuriosityJarSummary,
  sanitizeQuestion,
  curiosityJar
};
