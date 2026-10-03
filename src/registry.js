const fs = require('fs');
const path = require('path');

let characters = new Map();
let concepts = new Map();
let profiles = new Map();
let dataWatchers = [];
let reloadDebounceTimer = null;

const DATA_DIR = path.join(__dirname, '..', 'data');
const CHAR_DIR = path.join(DATA_DIR, 'characters');
const CONCEPTS_FILE = path.join(DATA_DIR, 'concepts.json');
const PROFILES_FILE = path.join(DATA_DIR, 'profiles.json');

function loadConcepts() {
  try {
    if (!fs.existsSync(CONCEPTS_FILE)) {
      console.warn(`[Registry] Concepts file not found at ${CONCEPTS_FILE}`);
      return;
    }
    const raw = fs.readFileSync(CONCEPTS_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    concepts.clear();
    for (const c of parsed) {
      if (c && c.id) {
        concepts.set(c.id, c);
      }
    }
    console.log(`[Registry] Loaded ${concepts.size} concepts.`);
  } catch (err) {
    console.error(`[Registry] Error loading concepts: ${err.message}`);
  }
}

function loadProfiles() {
  try {
    if (!fs.existsSync(PROFILES_FILE)) {
      console.warn(`[Registry] Profiles file not found at ${PROFILES_FILE}`);
      return;
    }
    const raw = fs.readFileSync(PROFILES_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    profiles.clear();
    for (const p of parsed) {
      if (p && p.id) {
        profiles.set(p.id, p);
      }
    }
    console.log(`[Registry] Loaded ${profiles.size} profiles.`);
  } catch (err) {
    console.error(`[Registry] Error loading profiles: ${err.message}`);
  }
}

function loadCharacters() {
  try {
    if (!fs.existsSync(CHAR_DIR)) {
      console.warn(`[Registry] Characters dir not found at ${CHAR_DIR}`);
      return;
    }
    const files = fs.readdirSync(CHAR_DIR).filter(f => f.endsWith('.json'));
    characters.clear();

    for (const file of files) {
      const fullPath = path.join(CHAR_DIR, file);
      try {
        const raw = fs.readFileSync(fullPath, 'utf-8');
        const charData = JSON.parse(raw);
        if (!charData.id || !charData.name) {
          console.warn(`[Registry] Skipping invalid character in ${file}: missing id or name`);
          continue;
        }

        // Validate concepts
        let validConcepts = [];
        if (Array.isArray(charData.concepts)) {
          for (const cId of charData.concepts) {
            if (concepts.has(cId)) {
              validConcepts.push(cId);
            } else {
              console.warn(`[Registry] Unknown concept '${cId}' in character '${charData.id}' (${file}) ignored.`);
            }
          }
        }
        charData.concepts = validConcepts;

        // Downgrade if verified but no valid concepts
        if (charData.status === 'verified' && validConcepts.length === 0) {
          console.warn(`[Registry] Character '${charData.id}' marked verified has 0 valid concepts. Downgrading to behaviour_only.`);
          charData.status = 'behaviour_only';
        }

        // Defaults
        if (!Array.isArray(charData.facts)) charData.facts = [];
        if (!Array.isArray(charData.interestTags)) charData.interestTags = [];
        if (!charData.emoji) charData.emoji = '🤖';
        if (!charData.color) charData.color = '#FFB13B';
        if (!charData.role) charData.role = 'companion';
        if (!charData.group) charData.group = 'A';
        if (!charData.voiceStyle) charData.voiceStyle = 'Friendly and encouraging';
        if (!charData.voiceStyleNote) {
          charData.voiceStyleNote = 'voice style and emoji are team presentation choices, not Funobotz facts';
        }

        characters.set(charData.id, charData);
      } catch (err) {
        console.warn(`[Registry] Invalid JSON or parse error in ${file}: ${err.message}. Skipping file.`);
      }
    }
    console.log(`[Registry] Loaded ${characters.size} characters.`);
  } catch (err) {
    console.error(`[Registry] Error reading characters directory: ${err.message}`);
  }
}

function reloadAll() {
  loadConcepts();
  loadProfiles();
  loadCharacters();
}

function initRegistry() {
  reloadAll();

  // Watch for changes with debouncing
  try {
    if (fs.existsSync(DATA_DIR)) {
      const w1 = fs.watch(DATA_DIR, { recursive: true }, (eventType, filename) => {
        if (reloadDebounceTimer) clearTimeout(reloadDebounceTimer);
        reloadDebounceTimer = setTimeout(() => {
          console.log(`[Registry] Hot-reload triggered by file change: ${filename}`);
          reloadAll();
        }, 300);
      });
      if (typeof w1.unref === 'function') w1.unref();
      dataWatchers.push(w1);
    }
  } catch (err) {
    console.warn(`[Registry] fs.watch recursive not supported or failed: ${err.message}`);
  }
}

// Helpers
function getCharacter(id) {
  if (!id) return null;
  return characters.get(id.toLowerCase()) || null;
}

function getAllCharacters() {
  return Array.from(characters.values());
}

function getConcept(id) {
  if (!id) return null;
  return concepts.get(id) || null;
}

function getAllConcepts() {
  return Array.from(concepts.values()).sort((a, b) => (a.order || 99) - (b.order || 99));
}

function getProfile(id) {
  if (!id) return null;
  return profiles.get(id) || null;
}

function getAllProfiles() {
  return Array.from(profiles.values());
}

// Initialize on require
initRegistry();

module.exports = {
  reloadAll,
  getCharacter,
  getAllCharacters,
  getConcept,
  getAllConcepts,
  getProfile,
  getAllProfiles
};
