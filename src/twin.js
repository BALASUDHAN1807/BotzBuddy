// Learning Twin state model and mastery tracking
const { getAllConcepts, getProfile } = require('./registry');

const RANKS = [
  { minXp: 0, name: 'Explorer', emoji: '🌱' },
  { minXp: 30, name: 'Builder', emoji: '🔧' },
  { minXp: 70, name: 'Experimenter', emoji: '🧪' },
  { minXp: 120, name: 'Explainer', emoji: '🧠' },
  { minXp: 180, name: 'Creator', emoji: '🚀' }
];

function getRankForXp(xp) {
  let currentRank = RANKS[0];
  for (const r of RANKS) {
    if (xp >= r.minXp) {
      currentRank = r;
    }
  }
  return currentRank;
}

function getMasteryLevel(score) {
  if (score < 40) return { level: 'Foundation', description: 'Simpler pacing & concrete hints' };
  if (score <= 75) return { level: 'Developing', description: 'Standard hands-on discovery' };
  return { level: 'Ready', description: 'Advanced deep explanations & fast-track unlocked' };
}

class LearningTwin {
  constructor(options = {}) {
    const {
      sessionId = `sess_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      context = 'home',
      profileId = null,
      age = 9,
      interests = [],
      knowledge = 'new',
      knownConcepts = [],
      language = 'en',
      characterId = null,
      shortMode = false,
      wantsDepth = false,
      explorer = false,
      generalStemMode = null
    } = options;

    let initialProfile = null;
    if (profileId) {
      initialProfile = getProfile(profileId);
    }

    this.sessionId = sessionId;
    this.context = context || 'home'; // home | kit | class | workshop
    this.profileId = profileId || (initialProfile ? initialProfile.id : null);
    this.age = initialProfile ? initialProfile.age : Number(age) || 9;
    this.ageBand = this.age < 10 ? 'young' : 'older';
    this.language = (initialProfile && initialProfile.language) || language || 'en';
    
    // General STEM mode: 'on' or 'off' (default 'on' unless explicitly set to 'off')
    this.generalStemMode = generalStemMode !== null && generalStemMode !== undefined
      ? generalStemMode
      : (process.env.GENERAL_STEM_MODE !== 'off');
    
    // Interests
    this.interests = Array.isArray(interests) && interests.length > 0
      ? [...interests]
      : (initialProfile && initialProfile.interests ? [...initialProfile.interests] : ['general']);

    // Modes
    this.shortMode = initialProfile ? !!initialProfile.shortMode : !!shortMode;
    this.wantsDepth = initialProfile ? !!initialProfile.wantsDepth : !!wantsDepth;
    this.explorer = initialProfile ? !!initialProfile.explorer : !!explorer;

    // Mastery map
    this.mastery = {};
    const allConcepts = getAllConcepts();
    for (const c of allConcepts) {
      this.mastery[c.id] = 0;
    }

    // Set initial known concepts based on knowledge level or profile
    const initialKnown = initialProfile && initialProfile.knownConcepts
      ? initialProfile.knownConcepts
      : (Array.isArray(knownConcepts) ? knownConcepts : []);

    if (knowledge === 'basics' || knowledge === 'challenge') {
      // mark basic concepts as mastered
      if (this.mastery.simple_circuit !== undefined) this.mastery.simple_circuit = 80;
    }
    for (const kc of initialKnown) {
      if (this.mastery[kc] !== undefined) {
        this.mastery[kc] = 80;
      }
    }

    this.misconceptionsFound = [];
    this.hintLevel = 0; // 0: hint, 1: example, 2: demonstration, 3: explanation
    this.currentCharacter = characterId || 'wavy';
    this.currentConcept = null;
    this.stage = 'idle'; // idle | build | experiment | observe | explain | create | complete | teamup | memory_boost
    this.xp = 0;
    this.rank = RANKS[0].name;
    this.rankEmoji = RANKS[0].emoji;

    // 5 Learning signals counters (Multi-modal)
    this.signals = {
      say: 0,
      choose: 0,
      build: 0,
      explain: 0,
      confidence: 0
    };

    // Curiosity domains tracking (e.g. biology x2, physics x1)
    this.curiosityDomains = {};

    // Innovation feature tracking
    this.conceptConfidence = {};
    this.memoryBoostQueue = []; // concepts needing spaced revisit
    this.memoryBoostsCount = 0;
    this.lastMemoryBoostTurn = 0;
    this.turnsCount = 0;
    this.activeTeamUp = null; // { chars: [c1, c2], conceptId }

    this.decisionLog = [];
    this.createdAt = Date.now();
    this.lastActiveAt = Date.now();
  }

  recordCuriosityDomain(domain) {
    if (!domain) return;
    this.curiosityDomains[domain] = (this.curiosityDomains[domain] || 0) + 1;
  }

  recordSignal(type) {
    if (this.signals[type] !== undefined) {
      this.signals[type]++;
    }
    this.turnsCount++;
    this.lastActiveAt = Date.now();
  }

  setConceptConfidence(conceptId, level) {
    this.recordSignal('confidence');
    if (conceptId) {
      this.conceptConfidence[conceptId] = level;
    }
  }

  queueMemoryBoost(conceptId) {
    if (conceptId && !this.memoryBoostQueue.includes(conceptId)) {
      this.memoryBoostQueue.push(conceptId);
    }
  }

  getNextMemoryBoost() {
    if (this.memoryBoostQueue.length > 0 && (this.turnsCount - this.lastMemoryBoostTurn >= 3)) {
      const nextConceptId = this.memoryBoostQueue.shift();
      this.lastMemoryBoostTurn = this.turnsCount;
      this.memoryBoostsCount++;
      return nextConceptId;
    }
    return null;
  }

  addDecision(decision) {
    this.decisionLog.unshift({
      timestamp: new Date().toISOString(),
      ...decision
    });
    if (this.decisionLog.length > 10) {
      this.decisionLog.pop();
    }
  }

  adjustMastery(conceptId, delta) {
    if (!conceptId) return 0;
    if (this.mastery[conceptId] === undefined) {
      this.mastery[conceptId] = 0;
    }
    const oldScore = this.mastery[conceptId];
    let newScore = Math.max(0, Math.min(100, oldScore + delta));
    this.mastery[conceptId] = newScore;
    return newScore;
  }

  addXp(amount) {
    const oldXp = this.xp;
    const oldRank = getRankForXp(oldXp);
    this.xp += amount;
    const newRank = getRankForXp(this.xp);
    this.rank = newRank.name;
    this.rankEmoji = newRank.emoji;

    const rankUp = newRank.name !== oldRank.name && this.xp >= newRank.minXp;
    return {
      xpGained: amount,
      totalXp: this.xp,
      rankUp,
      oldRank: oldRank.name,
      newRank: newRank.name,
      rankEmoji: newRank.emoji
    };
  }

  recordMisconception(conceptId, misconceptionId, fixText) {
    const existing = this.misconceptionsFound.find(m => m.conceptId === conceptId && m.misconceptionId === misconceptionId);
    if (!existing) {
      this.misconceptionsFound.push({
        conceptId,
        misconceptionId,
        fixText,
        detectedAt: new Date().toISOString()
      });
    }
    this.adjustMastery(conceptId, -5);
  }

  nextHintLevel() {
    this.hintLevel = Math.min(3, this.hintLevel + 1);
    if (this.currentConcept) {
      this.adjustMastery(this.currentConcept, -3);
    }
    return this.hintLevel;
  }

  resetHintLevel() {
    this.hintLevel = 0;
  }

  toSummary() {
    const currentMastery = this.currentConcept ? (this.mastery[this.currentConcept] || 0) : 0;
    const needsHelp = this.hintLevel >= 2 || (this.stage !== 'idle' && currentMastery < 40 && this.misconceptionsFound.length > 0);

    return {
      sessionId: this.sessionId,
      context: this.context,
      profileId: this.profileId,
      age: this.age,
      ageBand: this.ageBand,
      interests: this.interests,
      language: this.language,
      shortMode: this.shortMode,
      wantsDepth: this.wantsDepth,
      explorer: this.explorer,
      currentCharacter: this.currentCharacter,
      currentConcept: this.currentConcept,
      stage: this.stage,
      xp: this.xp,
      rank: this.rank,
      rankEmoji: this.rankEmoji,
      hintLevel: this.hintLevel,
      needsHelp,
      memoryBoostsCount: this.memoryBoostsCount,
      conceptConfidence: { ...this.conceptConfidence },
      signals: { ...this.signals },
      curiosityDomains: { ...this.curiosityDomains },
      generalStemMode: this.generalStemMode,
      mastery: { ...this.mastery },
      misconceptionsCount: this.misconceptionsFound.length,
      misconceptions: [...this.misconceptionsFound],
      recentDecisions: [...this.decisionLog]
    };

  }

  toTeacherSummary(index = 1) {
    const currentMastery = this.currentConcept ? (this.mastery[this.currentConcept] || 0) : 0;
    const needsHelp = this.hintLevel >= 2 || currentMastery < 40 || this.misconceptionsFound.length > 0;

    return {
      sessionId: this.sessionId,
      learnerLabel: `Learner ${index}`,
      context: this.context,
      ageBand: this.ageBand,
      currentConcept: this.currentConcept,
      currentCharacter: this.currentCharacter,
      mastery: currentMastery,
      stage: this.stage,
      rank: this.rank,
      rankEmoji: this.rankEmoji,
      misconceptionsCount: this.misconceptionsFound.length,
      latestMisconception: this.misconceptionsFound[this.misconceptionsFound.length - 1]?.fixText || null,
      needsHelp,
      lastActiveAt: this.lastActiveAt
    };
  }
}

module.exports = {
  LearningTwin,
  getRankForXp,
  getMasteryLevel,
  RANKS
};
