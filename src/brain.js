const {
  getAllCharacters,
  getCharacter,
  getAllConcepts,
  getConcept,
  getAllProfiles
} = require('./registry');
const { checkSafety } = require('./safety');
const { getMasteryLevel } = require('./twin');
const { analyzeTeachBack } = require('./analyzer');
const { talkerRewrite } = require('./llm');
const { addCuriosityQuestion } = require('./storage');
const { classifyQuestion } = require('./classifier');
const { explainGeneralScience, buildBridgeMessage, getBridgeQuickReplies } = require('./explainer');


function getVerifiedCharactersForConcept(conceptId) {
  if (!conceptId) return [];
  const allChars = getAllCharacters();
  return allChars.filter(c => c.status === 'verified' && (c.concepts || []).includes(conceptId));
}

function getApprovedFactForConcept(charId, conceptId) {
  const c = getCharacter(charId);
  if (!c) return '';
  if (charId === 'quacky') {
    return 'In my build, a BO motor powered through a simple circuit creates rotational spin to make me waddle! 🦆';
  }
  if (charId === 'tiko') {
    return 'In my build, a motor creates up-and-down thread-based tail movement so I can strike like a scorpion! 🦂';
  }
  if (charId === 'tolly') {
    return 'In my build, circuit connections power the timer and red-yellow-green LED sequence! 🚦';
  }
  if (charId === 'petalo') {
    return 'In my build, light from challenge cards illuminates everyday objects and creates bright reflections! 🌸';
  }
  return (c.facts && c.facts[0]) || '';
}

// -------------------------------------------------------------
// Intent & Pattern Helpers
// -------------------------------------------------------------
const STUCK_PATTERNS = [
  /\b(i'?m stuck|stuck|help me|i don'?t get it|i don'?t understand|huh|confused|what do you mean|i am lost|too hard)\b/i
];

const ALREADY_KNOW_PATTERNS = [
  /\b(i already know this|i know this|too easy|skip this|already learned|already know)\b/i
];

const CHANGE_INTEREST_PATTERNS = [
  /\b(actually i want|change interest|i like|i want to learn about|let'?s talk about|switch to|something else)\b/i
];

const UNSUPPORTED_QUESTION_PATTERNS = [
  /\b(favourite|favorite|age|how old are you|where do you live|family|parents|programming language|superpowers?|powers?|what can you do in real life|who made you|girlfriend|boyfriend)\b/i
];

function isStuckIntent(text) {
  if (!text) return false;
  return STUCK_PATTERNS.some(p => p.test(text));
}

function isAlreadyKnowIntent(text) {
  if (!text) return false;
  return ALREADY_KNOW_PATTERNS.some(p => p.test(text));
}

function isChangeInterestIntent(text) {
  if (!text) return false;
  return CHANGE_INTEREST_PATTERNS.some(p => p.test(text));
}

function isUnsupportedQuestion(text, character) {
  if (!text) return false;
  const isQuestion = text.includes('?') || /\b(what|who|where|how|why|does|is|can)\b/i.test(text);
  if (!isQuestion) return false;

  for (const p of UNSUPPORTED_QUESTION_PATTERNS) {
    if (p.test(text)) return true;
  }
  return false;
}

// -------------------------------------------------------------
// Character Routing & Scoring
// -------------------------------------------------------------
function selectBestCharacter({ conceptId, interests = [], currentCharacterId = 'wavy', requestedCharacterId = null, contextSlug = null, twin }) {
  const allChars = getAllCharacters();
  const verifiedChars = allChars.filter(c => c.status === 'verified');
  const scores = [];

  for (const c of verifiedChars) {
    let score = 0;
    const reasons = [];

    // 1. Concept match (crucial: character must teach concept)
    const teachesConcept = c.concepts.includes(conceptId);
    if (teachesConcept) {
      score += 15;
      reasons.push(`teaches ${conceptId} (+15)`);
    } else {
      score -= 20; // heavily penalized if cannot teach concept
    }

    // 2. Interest match (+2 per tag hit)
    let interestHits = 0;
    for (const tag of c.interestTags || []) {
      for (const userInt of interests) {
        if (tag.toLowerCase().includes(userInt.toLowerCase()) || userInt.toLowerCase().includes(tag.toLowerCase())) {
          interestHits++;
        }
      }
    }
    if (interestHits > 0) {
      score += interestHits * 2;
      reasons.push(`interest matches (${interestHits}x2)`);
    }

    // 3. Continuity (+3 if current character)
    if (c.id === currentCharacterId) {
      score += 3;
      reasons.push('current character continuity (+3)');
    }

    // 4. Requested character (+10)
    if (requestedCharacterId && c.id === requestedCharacterId.toLowerCase()) {
      score += 10;
      reasons.push('explicitly requested (+10)');
    }

    // 5. Context match (+5 if on that character's kit page)
    if (contextSlug && (c.productSlug === contextSlug || c.id === contextSlug)) {
      score += 5;
      reasons.push('kit page context match (+5)');
    }

    // 6. Next unmastered concept knowledge match (+1)
    if (twin && twin.mastery) {
      const nextUnmastered = getAllConcepts().find(cn => (twin.mastery[cn.id] || 0) < 75);
      if (nextUnmastered && c.concepts.includes(nextUnmastered.id)) {
        score += 1;
        reasons.push('teaches next unmastered concept (+1)');
      }
    }

    scores.push({
      character: c,
      score,
      reasons: reasons.join(', ')
    });
  }

  // Sort descending
  scores.sort((a, b) => b.score - a.score);

  const best = scores[0]?.character || getCharacter('wavy');
  const alternatives = scores.slice(1, 4).map(s => ({
    id: s.character.id,
    name: s.character.name,
    score: s.score
  }));

  return {
    best,
    alternatives,
    score: scores[0]?.score || 0,
    reason: scores[0]?.reasons || 'Default selection'
  };
}

// -------------------------------------------------------------
// Concept Finder based on interests or text
// -------------------------------------------------------------
function findConceptForInterests(interests = [], mastery = {}) {
  const concepts = getAllConcepts();

  // Try to find matching concept with mastery < 75
  let bestConcept = null;
  let highestHit = -1;

  for (const c of concepts) {
    // If already mastered, lower priority
    const score = mastery[c.id] || 0;
    if (score >= 75) continue;

    let hits = 0;
    for (const kw of c.keywords) {
      for (const intr of interests) {
        if (kw.includes(intr.toLowerCase()) || intr.toLowerCase().includes(kw)) {
          hits++;
        }
      }
    }

    if (hits > highestHit) {
      highestHit = hits;
      bestConcept = c;
    }
  }

  // Fallback to first unmastered concept
  if (!bestConcept) {
    bestConcept = concepts.find(c => (mastery[c.id] || 0) < 75) || concepts[0];
  }

  return bestConcept;
}

function findConceptInText(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  const concepts = getAllConcepts();

  for (const c of concepts) {
    for (const kw of c.keywords) {
      if (lower.includes(kw)) {
        return c;
      }
    }
  }
  return null;
}

function detectCharacterMention(text) {
  if (!text) return null;
  const lower = text.toLowerCase();
  const allChars = getAllCharacters();

  for (const c of allChars) {
    if (lower.includes(c.name.toLowerCase()) || lower.includes(c.id.toLowerCase())) {
      return c;
    }
  }
  return null;
}

// -------------------------------------------------------------
// Message Generator Helpers
// -------------------------------------------------------------
function getPersistentQuickReplies() {
  return [
    { label: '🧠 I already know this', value: 'already_know', action: 'quick' },
    { label: "🆘 I'm stuck", value: 'stuck', action: 'quick' },
    { label: '🔄 Change my interest', value: 'change_interest', action: 'quick' }
  ];
}

function formatExplanation(concept, twin) {
  if (!concept || !concept.explain) return '';
  if (twin.wantsDepth || (twin.mastery[concept.id] || 0) > 75) {
    return concept.explain.deep || concept.explain.older || concept.explain.young;
  }
  if (twin.shortMode || twin.ageBand === 'young') {
    return concept.explain.young || concept.explain.older;
  }
  return concept.explain.older || concept.explain.young;
}

// -------------------------------------------------------------
// Main Adaptive Brain Processor
// -------------------------------------------------------------
async function processMessage({ twin, text = '', action = null }) {
  const cleanText = (text || '').trim();
  const actionType = action?.type || null;

  let messages = [];
  let quickReplies = [];
  let decisionIntent = 'general';
  let decisionReason = 'Normal flow';
  let llmProviderUsed = 'rule-based';
  let level = getMasteryLevel(twin.mastery[twin.currentConcept] || 0).level;

  // Record signals
  if (cleanText) twin.recordSignal('say');
  if (actionType === 'quick' || actionType === 'observe' || actionType === 'check') twin.recordSignal('choose');
  if (actionType === 'build') twin.recordSignal('build');

  // ============================================================
  // 1. SAFETY CHECK
  // ============================================================
  const safetyResult = checkSafety(cleanText);
  if (safetyResult && !safetyResult.safe) {
    twin.addDecision({
      intent: 'safety',
      concept: twin.currentConcept,
      character: twin.currentCharacter,
      level,
      reason: `Safety triggered: ${safetyResult.category}`,
      signalsUsed: { ...twin.signals },
      provider: 'rule-based'
    });

    return {
      messages: [
        {
          type: 'text',
          character: twin.currentCharacter,
          text: safetyResult.message
        }
      ],
      quickReplies: [
        { label: 'Continue learning', value: 'continue', action: 'quick' },
        ...getPersistentQuickReplies()
      ],
      state: twin.toSummary(),
      decision: {
        intent: 'safety',
        concept: twin.currentConcept,
        character: twin.currentCharacter,
        alternatives: [],
        level,
        reason: `Safety violation handled: ${safetyResult.category}`,
        signalsUsed: { ...twin.signals },
        provider: 'rule-based'
      }
    };
  }

  // ============================================================
  // 2. CHARACTER SWITCH / DIRECT SELECTION INTENT
  // ============================================================
  const mentionedChar = detectCharacterMention(cleanText) || (actionType === 'select_character' ? getCharacter(action.characterId) : null);
  const wantsSwitchText = /\b(teach me with|talk to|switch to|meet|choose|select|i want to learn with)\b/i.test(cleanText);

  if (mentionedChar && (wantsSwitchText || actionType === 'select_character' || cleanText.toLowerCase() === mentionedChar.name.toLowerCase())) {
    decisionIntent = 'switch_character';

    // Status branch 1: Verified
    if (mentionedChar.status === 'verified') {
      const oldChar = getCharacter(twin.currentCharacter);
      twin.currentCharacter = mentionedChar.id;
      
      // Select concept taught by this character
      let targetConceptId = mentionedChar.concepts[0];
      if (mentionedChar.concepts.includes(twin.currentConcept)) {
        targetConceptId = twin.currentConcept;
      }
      twin.currentConcept = targetConceptId;
      twin.stage = 'build';
      twin.resetHintLevel();

      const targetConcept = getConcept(targetConceptId);
      const draftText = `Woohoo! I'm ${mentionedChar.name} ${mentionedChar.emoji}! ${(mentionedChar.facts || [])[0] || ''} Let's dive into ${targetConcept.name}!`;

      const rewritten = await talkerRewrite({
        character: mentionedChar,
        draft: draftText,
        twin
      });
      llmProviderUsed = rewritten.provider;

      messages.push({
        type: 'handoff',
        character: mentionedChar.id,
        text: `Handoff: Meet ${mentionedChar.name}!`,
        data: { from: oldChar?.id, to: mentionedChar.id, emoji: mentionedChar.emoji }
      });

      messages.push({
        type: 'text',
        character: mentionedChar.id,
        text: rewritten.text
      });

      // Start Build Stage
      const explainText = formatExplanation(targetConcept, twin);
      messages.push({
        type: 'build',
        character: mentionedChar.id,
        text: `${explainText}\n\n🔨 Step 1 (Build): ${targetConcept.build}`,
        data: {
          conceptId: targetConcept.id,
          parts: targetConcept.virtualBuild || ['battery', 'wire', 'load']
        }
      });

      quickReplies = [
        { label: '✅ I did the build!', value: 'build_done', action: 'quick' },
        ...getPersistentQuickReplies()
      ];

      twin.addDecision({
        intent: 'switch_character',
        concept: twin.currentConcept,
        character: twin.currentCharacter,
        level,
        reason: `Switched to verified character ${mentionedChar.name}`,
        signalsUsed: { ...twin.signals },
        provider: llmProviderUsed
      });

      return {
        messages,
        quickReplies,
        state: twin.toSummary(),
        decision: {
          intent: 'switch_character',
          concept: twin.currentConcept,
          character: twin.currentCharacter,
          alternatives: [],
          level,
          reason: `Switched to verified character ${mentionedChar.name}`,
          signalsUsed: { ...twin.signals },
          provider: llmProviderUsed
        }
      };
    }

    // Status branch 2: Behaviour Only
    if (mentionedChar.status === 'behaviour_only') {
      const knownBehavior = (mentionedChar.facts || [])[0] || 'A wonderful interactive Funobotz friend.';
      const verifiedList = getAllCharacters().filter(c => c.status === 'verified');
      const suggestedChar = verifiedList[0];

      messages.push({
        type: 'text',
        character: mentionedChar.id,
        text: `Hi there! I'm ${mentionedChar.name} ${mentionedChar.emoji}. ${knownBehavior}\n\nMy full STEM concept lessons are coming soon! In the meantime, my friend ${suggestedChar.name} ${suggestedChar.emoji} is ready with an exciting hands-on mission. Want to learn with ${suggestedChar.name}?`
      });

      quickReplies = [
        { label: `🚀 Learn with ${suggestedChar.name}`, value: `switch_${suggestedChar.id}`, action: 'quick' },
        { label: '👋 Back to Wavy', value: 'switch_wavy', action: 'quick' }
      ];

      twin.addDecision({
        intent: 'behaviour_only_handoff',
        concept: twin.currentConcept,
        character: mentionedChar.id,
        level,
        reason: `Behaviour-only character ${mentionedChar.name} suggested verified character`,
        signalsUsed: { ...twin.signals },
        provider: 'rule-based'
      });

      return {
        messages,
        quickReplies,
        state: twin.toSummary(),
        decision: {
          intent: 'behaviour_only_handoff',
          concept: twin.currentConcept,
          character: mentionedChar.id,
          alternatives: verifiedList.map(v => ({ id: v.id, name: v.name })),
          level,
          reason: `Behaviour-only character ${mentionedChar.name} suggested verified character`,
          signalsUsed: { ...twin.signals },
          provider: 'rule-based'
        }
      };
    }

    // Status branch 3: Awaiting Concept Sheet
    if (mentionedChar.status === 'awaiting_concept_sheet') {
      const verifiedList = getAllCharacters().filter(c => c.status === 'verified');
      const suggestedChar = verifiedList[0];

      messages.push({
        type: 'text',
        character: mentionedChar.id,
        text: `Hello! I'm ${mentionedChar.name} ${mentionedChar.emoji}. Honestly, my STEM lessons haven't been released yet by Funobotz engineers! But our verified friends like ${suggestedChar.name} ${suggestedChar.emoji}, Quacky 🦆, Tolly 🚦, and Tiko 🦂 are ready right now. Let's explore with one of them!`
      });

      quickReplies = verifiedList.slice(0, 3).map(v => ({
        label: `${v.emoji} ${v.name}`,
        value: `switch_${v.id}`,
        action: 'quick'
      }));

      twin.addDecision({
        intent: 'awaiting_concept_sheet_honest',
        concept: twin.currentConcept,
        character: mentionedChar.id,
        level,
        reason: `Honest declaration of awaiting concept sheet for ${mentionedChar.name}`,
        signalsUsed: { ...twin.signals },
        provider: 'rule-based'
      });

      return {
        messages,
        quickReplies,
        state: twin.toSummary(),
        decision: {
          intent: 'awaiting_concept_sheet_honest',
          concept: twin.currentConcept,
          character: mentionedChar.id,
          alternatives: verifiedList.map(v => ({ id: v.id, name: v.name })),
          level,
          reason: `Honest declaration of awaiting concept sheet for ${mentionedChar.name}`,
          signalsUsed: { ...twin.signals },
          provider: 'rule-based'
        }
      };
    }
  }

  // ============================================================
  // 3. THREE-TIER QUESTION CLASSIFICATION & AGE-ADAPTIVE EXPLAINER
  // ============================================================
  const currentCharObj = getCharacter(twin.currentCharacter) || getCharacter('wavy');

  // Check if this is a free-text inquiry/question
  const isContinueCmd = cleanText && cleanText.toLowerCase() === 'continue';
  const isTeamUpRequest = action?.value === 'team_up' || cleanText.toLowerCase().includes('team-up') || cleanText.toLowerCase().includes('team up');
  const isQuestionOrInquiry = cleanText && !actionType && !isStuckIntent(cleanText) && !isAlreadyKnowIntent(cleanText) && !isChangeInterestIntent(cleanText) && !isTeamUpRequest && !isContinueCmd;

  if (isQuestionOrInquiry) {
    const classification = await classifyQuestion({ text: cleanText, currentCharacter: currentCharObj, twin });

    // Vague greeting / prompt
    if (classification.isVague) {
      const wavy = getCharacter('wavy') || currentCharObj;
      const allConcepts = getAllConcepts();

      messages.push({
        type: 'text',
        character: wavy.id,
        text: `I'm Wavy 👋, your Funobotz welcoming guide! I'm here to connect you with our wonderful STEM friends. What are you most curious to build today?`
      });

      quickReplies = [
        ...allConcepts.slice(0, 4).map(c => ({
          label: `✨ ${c.name}`,
          value: `start_${c.id}`,
          action: 'quick'
        })),
        { label: '🎲 Surprise me!', value: 'surprise_me', action: 'quick' }
      ];

      twin.addDecision({
        intent: 'vague_clarification',
        concept: twin.currentConcept,
        character: 'wavy',
        level,
        reason: 'Vague query or unmapped input: Wavy clarified with tap options',
        signalsUsed: { ...twin.signals },
        provider: 'rule-based'
      });

      return {
        messages,
        quickReplies,
        state: twin.toSummary(),
        decision: {
          intent: 'vague_clarification',
          concept: twin.currentConcept,
          character: 'wavy',
          alternatives: [],
          level,
          reason: 'Wavy clarified vague query with options',
          signalsUsed: { ...twin.signals },
          provider: 'rule-based'
        }
      };
    }

    // ------------------------------------------------------------
    // TIER 1A: UNSUPPORTED CHARACTER FACT (LORE)
    // ------------------------------------------------------------
    if (classification.tier === 'funobotz_stem' && classification.isUnsupportedCharacterFact) {

      const knownFactsList = (currentCharObj.facts || []).map(f => `• ${f}`).join('\n');
      
      // Add to Curiosity Jar anonymously
      addCuriosityQuestion({
        question: cleanText,
        characterAsked: currentCharObj.name,
        ageBand: twin.ageBand,
        context: twin.context,
        tier: 'unsupported_fact',
        domain: 'funobotz'
      });

      const replyText = `I don't have an approved Funobotz fact about that yet, so I won't make one up! 🛡️\n\nI've dropped your question into the 🏺 **Curiosity Jar** so the Funobotz team can see what kids want to learn!\n\nHere are the approved facts I know about ${currentCharObj.name}:\n${knownFactsList || '• Official Funobotz guide'}\n\nWant to explore an approved STEM topic instead?`;

      twin.addDecision({
        intent: 'curiosity_jar',
        tier: 'funobotz_stem',
        domain: 'funobotz',
        concept: twin.currentConcept,
        character: twin.currentCharacter,
        level,
        reason: `Unsupported character fact detected → logged to Curiosity Jar`,
        signalsUsed: { ...twin.signals },
        provider: 'rule-based'
      });

      return {
        messages: [
          {
            type: 'text',
            character: twin.currentCharacter,
            text: replyText
          }
        ],
        quickReplies: [
          { label: '🚀 Continue STEM mission', value: 'continue', action: 'quick' },
          ...getPersistentQuickReplies()
        ],
        state: twin.toSummary(),
        decision: {
          intent: 'curiosity_jar',
          tier: 'funobotz_stem',
          domain: 'funobotz',
          concept: twin.currentConcept,
          character: twin.currentCharacter,
          alternatives: [],
          level,
          reason: `Unsupported fact logged to Curiosity Jar`,
          signalsUsed: { ...twin.signals },
          provider: 'rule-based'
        }
      };
    }

    // ------------------------------------------------------------
    // TIER 2: GENERAL STEM (Age-Adaptive Explainer)
    // ------------------------------------------------------------
    if (classification.tier === 'general_stem') {
      const domain = classification.domain || 'physics';
      const bridgeSkill = classification.bridgeSkill || 'cause_effect';
      const isStrictMode = twin.generalStemMode === false || twin.generalStemMode === 'off';

      // Log question into Curiosity Jar with tier "general_stem" and domain
      addCuriosityQuestion({
        question: cleanText,
        characterAsked: currentCharObj.name,
        ageBand: twin.ageBand,
        context: twin.context,
        tier: 'general_stem',
        domain
      });

      // Update Learning Twin curiosity domains tracking
      twin.recordCuriosityDomain(domain);

      if (isStrictMode) {
        // STRICT CURRICULUM MODE (e.g. classroom portal):
        // Does not give free science answers, politely redirects with bridge to today's topic
        const bridgeInfo = buildBridgeMessage(bridgeSkill, twin);
        const bridgeQuickReplies = getBridgeQuickReplies(bridgeInfo);

        const strictMessage = "That's real science! 🔬 It's not in today's Funobotz lessons, so I've saved it for the team in the Curiosity Jar.";

        messages.push({
          type: 'text',
          character: currentCharObj.id,
          text: strictMessage
        });

        messages.push({
          type: 'text',
          character: bridgeInfo.character,
          text: bridgeInfo.message
        });

        twin.addDecision({
          intent: 'general_stem_strict_mode',
          tier: 'general_stem',
          domain,
          concept: twin.currentConcept,
          character: currentCharObj.id,
          level: 'strict_curriculum',
          bridgeSkill,
          bridgeChoice: bridgeInfo.character,
          reason: `General STEM question asked with general-stem mode OFF → saved to Curiosity Jar & bridged`,
          signalsUsed: { ...twin.signals },
          provider: 'rule-based'
        });

        return {
          messages,
          quickReplies: bridgeQuickReplies,
          state: twin.toSummary(),
          decision: {
            intent: 'general_stem_strict_mode',
            tier: 'general_stem',
            domain,
            concept: twin.currentConcept,
            character: currentCharObj.id,
            alternatives: [],
            level: 'strict_curriculum',
            bridgeSkill,
            bridgeChoice: bridgeInfo.character,
            reason: `General STEM redirected (strict curriculum mode)`,
            signalsUsed: { ...twin.signals },
            provider: 'rule-based'
          }
        };
      } else {
        // ACTIVE AGE-ADAPTIVE EXPLAINER MODE
        const explainerResult = await explainGeneralScience({
          question: cleanText,
          twin,
          domain,
          fallbackSkill: bridgeSkill
        });

        const activeBridgeSkill = explainerResult.bridgeSkill || bridgeSkill;
        const bridgeInfo = buildBridgeMessage(activeBridgeSkill, twin);
        const bridgeQuickReplies = getBridgeQuickReplies(bridgeInfo);

        messages.push({
          type: 'general_stem',
          character: 'wavy',
          text: explainerResult.answer,
          data: {
            safetyTip: explainerResult.safetyTip,
            keyTerms: explainerResult.keyTerms,
            domain,
            level: explainerResult.level,
            readingLevelCheck: explainerResult.readingLevelCheck
          }
        });

        messages.push({
          type: 'text',
          character: bridgeInfo.character,
          text: bridgeInfo.message
        });

        twin.addDecision({
          intent: 'general_stem_explained',
          tier: 'general_stem',
          domain,
          ageLevel: explainerResult.level,
          concept: twin.currentConcept,
          character: currentCharObj.id,
          level: explainerResult.level,
          bridgeSkill: activeBridgeSkill,
          bridgeChoice: bridgeInfo.character,
          reason: `General STEM explained at '${explainerResult.level}' level via ${explainerResult.provider}`,
          signalsUsed: { ...twin.signals },
          provider: explainerResult.provider
        });

        return {
          messages,
          quickReplies: bridgeQuickReplies,
          state: twin.toSummary(),
          decision: {
            intent: 'general_stem_explained',
            tier: 'general_stem',
            domain,
            ageLevel: explainerResult.level,
            concept: twin.currentConcept,
            character: currentCharObj.id,
            alternatives: [],
            level: explainerResult.level,
            bridgeSkill: activeBridgeSkill,
            bridgeChoice: bridgeInfo.character,
            reason: `General STEM explained at '${explainerResult.level}' level via ${explainerResult.provider}`,
            signalsUsed: { ...twin.signals },
            provider: explainerResult.provider
          }
        };
      }
    }

    // ------------------------------------------------------------
    // TIER 3: NON-STEM TOPIC (Redirect + Curiosity Jar)
    // ------------------------------------------------------------
    if (classification.tier === 'non_stem') {
      addCuriosityQuestion({
        question: cleanText,
        characterAsked: currentCharObj.name,
        ageBand: twin.ageBand,
        context: twin.context,
        tier: 'non_stem',
        domain: classification.domain || 'other'
      });

      const redirectText = `I'm BotzBuddy, your STEM and robotics friend! 🤖 I don't know much about ${cleanText.length > 40 ? 'that topic' : cleanText}, but I've saved your question in the 🏺 **Curiosity Jar**!\n\nWant to explore moving paper robots, glowing lights, or traffic circuits instead?`;

      twin.addDecision({
        intent: 'non_stem_redirect',
        tier: 'non_stem',
        domain: 'other',
        concept: twin.currentConcept,
        character: currentCharObj.id,
        level,
        reason: 'Non-STEM topic detected → redirected with Curiosity Jar log',
        signalsUsed: { ...twin.signals },
        provider: 'rule-based'
      });

      return {
        messages: [
          {
            type: 'text',
            character: currentCharObj.id,
            text: redirectText
          }
        ],
        quickReplies: [
          { label: '🦆 Circuits with Quacky', value: 'start_simple_circuit', action: 'quick' },
          { label: '🌸 Light with Petalo', value: 'start_light_everyday', action: 'quick' },
          { label: '🚦 LEDs with Tolly', value: 'start_led_sequence', action: 'quick' },
          ...getPersistentQuickReplies()
        ],
        state: twin.toSummary(),
        decision: {
          intent: 'non_stem_redirect',
          tier: 'non_stem',
          domain: 'other',
          concept: twin.currentConcept,
          character: currentCharObj.id,
          alternatives: [],
          level,
          reason: 'Non-STEM topic redirected',
          signalsUsed: { ...twin.signals },
          provider: 'rule-based'
        }
      };
    }
  }


  // ============================================================
  // INNOVATION FEATURE 3: CONFIDENCE METER HANDLER
  // ============================================================
  if (actionType === 'confidence' || action?.value?.startsWith('conf_')) {
    const rawVal = action?.value || 'conf_sure';
    const confLevel = action.level || (rawVal === 'conf_sure' ? 'sure' : (rawVal === 'conf_unsure' ? 'unsure' : 'medium'));
    const isCorrect = action.isCorrect !== undefined ? action.isCorrect : (!rawVal.includes('unsure'));
    const targetConcept = twin.currentConcept || 'simple_circuit';

    twin.setConceptConfidence(targetConcept, confLevel);

    let feedbackText = '';
    let reasonText = '';

    if (isCorrect && confLevel === 'sure') {
      twin.adjustMastery(targetConcept, 5);
      twin.addXp(5);
      feedbackText = '😎 High confidence & spot on! +5 Bonus Mastery awarded!';
      reasonText = 'Correct and very sure (+5 bonus mastery)';
    } else if (isCorrect && confLevel === 'unsure') {
      twin.queueMemoryBoost(targetConcept);
      feedbackText = '🙂 Great job! We will do a quick Memory Boost later to cement this concept!';
      reasonText = 'Correct but not sure → scheduled Memory Boost';
    } else if (!isCorrect && confLevel === 'sure') {
      twin.adjustMastery(targetConcept, -5);
      feedbackText = '🤔 You felt sure, but let\'s test this with a concrete experiment! (-5 mastery)';
      reasonText = 'Wrong but very sure → likely misconception';
    } else {
      feedbackText = '🌱 That\'s okay! Step-by-step discovery is how great engineers learn.';
      reasonText = 'Wrong and unsure → encouraging hint';
    }

    messages.push({
      type: 'text',
      character: twin.currentCharacter,
      text: feedbackText
    });

    quickReplies = [
      { label: '🚀 Continue mission', value: 'continue', action: 'quick' },
      ...getPersistentQuickReplies()
    ];

    twin.addDecision({
      intent: 'confidence_rule',
      concept: targetConcept,
      character: twin.currentCharacter,
      level: getMasteryLevel(twin.mastery[targetConcept] || 0).level,
      reason: reasonText,
      signalsUsed: { ...twin.signals },
      provider: 'rule-based'
    });

    return {
      messages,
      quickReplies,
      state: twin.toSummary(),
      decision: {
        intent: 'confidence_rule',
        concept: targetConcept,
        character: twin.currentCharacter,
        alternatives: [],
        level: getMasteryLevel(twin.mastery[targetConcept] || 0).level,
        reason: reasonText,
        signalsUsed: { ...twin.signals },
        provider: 'rule-based'
      }
    };
  }

  // ============================================================
  // INNOVATION FEATURE 5: MEMORY BOOST ANSWER HANDLER
  // ============================================================
  if (actionType === 'memory_boost' || action?.value?.startsWith('boost_ans_')) {
    const ansIdx = action.index !== undefined ? action.index : parseInt((action?.value || 'boost_ans_0').replace('boost_ans_', ''), 10);
    const boostConcept = getConcept(twin.activeBoostConcept || twin.currentConcept) || getAllConcepts()[0];
    const wasCorrect = boostConcept && ansIdx === boostConcept.check.answer;

    if (wasCorrect) {
      twin.adjustMastery(boostConcept.id, 10);
      twin.addXp(15);
      messages.push({
        type: 'memory_boost_result',
        character: twin.currentCharacter,
        text: `✨ **Sparkle!** Perfect memory recall! +10 mastery awarded for **${boostConcept.name}**!`
      });
    } else {
      const shortHint = boostConcept.hints?.[0] || 'Remember to check the closed circuit loop!';
      messages.push({
        type: 'text',
        character: twin.currentCharacter,
        text: `🌱 Good try! Quick tip for next time: ${shortHint}`
      });
    }

    twin.stage = 'build';
    quickReplies = [
      { label: '🚀 Continue to next challenge', value: 'continue', action: 'quick' },
      ...getPersistentQuickReplies()
    ];

    twin.addDecision({
      intent: 'memory_boost_completed',
      concept: boostConcept.id,
      character: twin.currentCharacter,
      level: getMasteryLevel(twin.mastery[boostConcept.id] || 0).level,
      reason: wasCorrect ? 'Memory boost correct (+10 mastery)' : 'Memory boost hint provided (no penalty)',
      signalsUsed: { ...twin.signals },
      provider: 'rule-based'
    });

    return {
      messages,
      quickReplies,
      state: twin.toSummary(),
      decision: {
        intent: 'memory_boost_completed',
        concept: boostConcept.id,
        character: twin.currentCharacter,
        alternatives: [],
        level: getMasteryLevel(twin.mastery[boostConcept.id] || 0).level,
        reason: wasCorrect ? 'Memory boost correct (+10 mastery)' : 'Memory boost hint provided',
        signalsUsed: { ...twin.signals },
        provider: 'rule-based'
      }
    };
  }

  // Memory Boost Spaced Revisit Trigger (Checks every 3 turns or after mission or continue)
  const scheduledBoostConceptId = (twin.stage === 'idle' || twin.stage === 'complete' || action?.value === 'continue' || cleanText.toLowerCase() === 'continue') ? twin.getNextMemoryBoost() : null;

  if (scheduledBoostConceptId) {
    const boostConcept = getConcept(scheduledBoostConceptId);
    if (boostConcept) {
      twin.stage = 'memory_boost';
      twin.activeBoostConcept = boostConcept.id;
      const charObj = getCharacter(twin.currentCharacter) || getCharacter('wavy');

      messages.push({
        type: 'memory_boost',
        character: charObj.id,
        text: `✨ **Quick Memory Boost!** Let's see how much you remember about **${boostConcept.name}**!\n\n❓ ${boostConcept.check.q}`,
        data: {
          conceptId: boostConcept.id,
          options: boostConcept.check.options
        }
      });

      quickReplies = (boostConcept.check.options || []).map((opt, i) => ({
        label: opt,
        value: `boost_ans_${i}`,
        action: 'memory_boost'
      }));

      twin.addDecision({
        intent: 'memory_boost',
        concept: boostConcept.id,
        character: charObj.id,
        level: getMasteryLevel(twin.mastery[boostConcept.id] || 0).level,
        reason: 'Concept still developing → spaced revisit',
        signalsUsed: { ...twin.signals },
        provider: 'rule-based'
      });

      return {
        messages,
        quickReplies,
        state: twin.toSummary(),
        decision: {
          intent: 'memory_boost',
          concept: boostConcept.id,
          character: charObj.id,
          alternatives: [],
          level: getMasteryLevel(twin.mastery[boostConcept.id] || 0).level,
          reason: 'Concept still developing → spaced revisit',
          signalsUsed: { ...twin.signals },
          provider: 'rule-based'
        }
      };
    }
  }

  // ============================================================
  // INNOVATION FEATURE 1: CHARACTER TEAM-UP TRIGGER
  // ============================================================
  if (isTeamUpRequest) {

    const conceptObj = getConcept(twin.currentConcept) || getAllConcepts()[0];
    const verifiedTeam = getVerifiedCharactersForConcept(conceptObj.id);

    if (verifiedTeam.length >= 2) {
      const c1 = verifiedTeam[0];
      const c2 = verifiedTeam[1];
      twin.stage = 'teamup';
      twin.activeTeamUp = { chars: [c1.id, c2.id], conceptId: conceptObj.id };

      const fact1 = getApprovedFactForConcept(c1.id, conceptObj.id);
      const fact2 = getApprovedFactForConcept(c2.id, conceptObj.id);
      const teamPrompt = conceptObj.teamUp?.prompt || "What's the same in both of our robots?";

      messages.push({
        type: 'teamup',
        character: c1.id,
        text: `🤝 **Funobotz Team-Up!** ${c1.name} ${c1.emoji} and ${c2.name} ${c2.emoji} are working together!\n\n**${c1.name}:** "${fact1}"\n\n**${c2.name}:** "${fact2}"\n\n❓ **Team-Up Question:** ${teamPrompt}`,
        data: {
          char1: { id: c1.id, name: c1.name, emoji: c1.emoji, fact: fact1 },
          char2: { id: c2.id, name: c2.name, emoji: c2.emoji, fact: fact2 },
          prompt: teamPrompt
        }
      });

      quickReplies = [
        { label: 'Both turn electrical energy into motion!', value: 'tb_team_energy', action: 'quick' },
        { label: 'Both need a closed circuit loop!', value: 'tb_team_circuit', action: 'quick' },
        { label: 'Both use a spinning DC motor!', value: 'tb_team_motor', action: 'quick' }
      ];

      twin.addDecision({
        intent: 'team_up',
        concept: conceptObj.id,
        character: c1.id,
        level: getMasteryLevel(twin.mastery[conceptObj.id]).level,
        reason: 'Concept shared by multiple verified characters → team-up',
        signalsUsed: { ...twin.signals },
        provider: 'rule-based'
      });

      return {
        messages,
        quickReplies,
        state: twin.toSummary(),
        decision: {
          intent: 'team_up',
          concept: conceptObj.id,
          character: c1.id,
          alternatives: [{ id: c2.id, name: c2.name }],
          level: getMasteryLevel(twin.mastery[conceptObj.id]).level,
          reason: 'Concept shared by multiple verified characters → team-up',
          signalsUsed: { ...twin.signals },
          provider: 'rule-based'
        }
      };
    }
  }

  // Handle Team-Up Teach-Back Response
  if (twin.stage === 'teamup' && cleanText) {
    twin.recordSignal('explain');
    const conceptObj = getConcept(twin.currentConcept);
    twin.adjustMastery(conceptObj.id, 15);
    const xpRes = twin.addXp(20);
    twin.stage = 'create';

    messages.push({
      type: 'text',
      character: twin.currentCharacter,
      text: `🎉 Brilliant team-up observation! Even though our shapes and actions look different, the underlying STEM concept is identical!\n\n🚀 **Step 5 (Create):** ${conceptObj.create.prompt}`
    });

    quickReplies = (conceptObj.create.choices || []).map((ch, i) => ({
      label: ch,
      value: `create_${i}`,
      action: 'create'
    }));

    twin.addDecision({
      intent: 'team_up_analyzed',
      concept: conceptObj.id,
      character: twin.currentCharacter,
      level: getMasteryLevel(twin.mastery[conceptObj.id]).level,
      reason: 'Team-up comparison understood (+15 mastery, +20 XP)',
      signalsUsed: { ...twin.signals },
      provider: 'rule-based'
    });

    return {
      messages,
      quickReplies,
      state: twin.toSummary(),
      decision: {
        intent: 'team_up_analyzed',
        concept: conceptObj.id,
        character: twin.currentCharacter,
        alternatives: [],
        level: getMasteryLevel(twin.mastery[conceptObj.id]).level,
        reason: 'Team-up comparison analyzed successfully',
        signalsUsed: { ...twin.signals },
        provider: 'rule-based'
      }
    };
  }

  // ============================================================
  // 4. "I ALREADY KNOW THIS" INTENT / MICRO-CHECK FAST-TRACK
  // ============================================================
  if (isAlreadyKnowIntent(cleanText) || action?.value === 'already_know') {
    const currentConceptObj = getConcept(twin.currentConcept) || findConceptForInterests(twin.interests, twin.mastery);
    twin.currentConcept = currentConceptObj.id;

    messages.push({
      type: 'text',
      character: twin.currentCharacter,
      text: `Awesome confidence! Let's do a super quick micro-check on **${currentConceptObj.name}** to verify your superpowers!`
    });

    messages.push({
      type: 'check',
      character: twin.currentCharacter,
      text: currentConceptObj.check.q,
      data: {
        conceptId: currentConceptObj.id,
        options: currentConceptObj.check.options
      }
    });

    quickReplies = currentConceptObj.check.options.map((opt, idx) => ({
      label: opt,
      value: `check_ans_${idx}`,
      action: 'check'
    }));

    twin.addDecision({
      intent: 'fast_track_micro_check',
      concept: currentConceptObj.id,
      character: twin.currentCharacter,
      level,
      reason: 'Learner requested fast-track, presented micro-check MCQ',
      signalsUsed: { ...twin.signals },
      provider: 'rule-based'
    });

    return {
      messages,
      quickReplies,
      state: twin.toSummary(),
      decision: {
        intent: 'fast_track_micro_check',
        concept: currentConceptObj.id,
        character: twin.currentCharacter,
        alternatives: [],
        level,
        reason: 'Fast-track micro check presented',
        signalsUsed: { ...twin.signals },
        provider: 'rule-based'
      }
    };
  }

  // Micro-check answer handler
  if (actionType === 'check' || action?.value?.startsWith('check_ans_')) {
    const ansIdx = action.index !== undefined ? action.index : parseInt(action.value.replace('check_ans_', ''), 10);
    const conceptObj = getConcept(twin.currentConcept);
    const wasCorrect = conceptObj && ansIdx === conceptObj.check.answer;

    if (wasCorrect) {
      twin.mastery[conceptObj.id] = Math.max(twin.mastery[conceptObj.id] || 0, 80);
      const xpResult = twin.addXp(20);

      // Find next concept
      const nextConcept = getAllConcepts().find(c => (twin.mastery[c.id] || 0) < 75) || getAllConcepts()[0];
      const routing = selectBestCharacter({
        conceptId: nextConcept.id,
        interests: twin.interests,
        currentCharacterId: twin.currentCharacter,
        twin
      });

      twin.currentCharacter = routing.best.id;
      twin.currentConcept = nextConcept.id;
      twin.stage = 'build';
      twin.resetHintLevel();

      messages.push({
        type: 'text',
        character: routing.best.id,
        text: `🎯 Spot on! You already understand the basics of ${conceptObj.name}. How confident did you feel about that answer?`
      });

      // Show Confidence Meter buttons
      quickReplies = [
        { label: '😎 Very sure', value: 'conf_sure', action: 'confidence', isCorrect: true },
        { label: '🙂 Kind of sure', value: 'conf_medium', action: 'confidence', isCorrect: true },
        { label: '😟 Not sure', value: 'conf_unsure', action: 'confidence', isCorrect: true }
      ];

      twin.addDecision({
        intent: 'micro_check_passed_skip',
        concept: nextConcept.id,
        character: routing.best.id,
        level: getMasteryLevel(twin.mastery[nextConcept.id]).level,
        reason: `Micro-check passed, mastery set to >=80, skipped to ${nextConcept.name}`,
        signalsUsed: { ...twin.signals },
        provider: 'rule-based'
      });

      return {
        messages,
        quickReplies,
        state: twin.toSummary(),
        decision: {
          intent: 'micro_check_passed_skip',
          concept: nextConcept.id,
          character: routing.best.id,
          alternatives: routing.alternatives,
          level: getMasteryLevel(twin.mastery[nextConcept.id]).level,
          reason: `Micro-check passed, advanced to ${nextConcept.name}`,
          signalsUsed: { ...twin.signals },
          provider: 'rule-based'
        }
      };
    } else {
      // Incorrect micro-check
      messages.push({
        type: 'text',
        character: twin.currentCharacter,
        text: `Interesting idea! How confident did you feel about that choice?`
      });

      quickReplies = [
        { label: '😎 Very sure', value: 'conf_sure', action: 'confidence', isCorrect: false },
        { label: '🙂 Kind of sure', value: 'conf_medium', action: 'confidence', isCorrect: false },
        { label: '😟 Not sure', value: 'conf_unsure', action: 'confidence', isCorrect: false }
      ];

      twin.stage = 'build';
      return {
        messages,
        quickReplies,
        state: twin.toSummary(),
        decision: {
          intent: 'micro_check_wrong',
          concept: twin.currentConcept,
          character: twin.currentCharacter,
          alternatives: [],
          level: getMasteryLevel(twin.mastery[twin.currentConcept] || 0).level,
          reason: 'Micro-check answered incorrectly',
          signalsUsed: { ...twin.signals },
          provider: 'rule-based'
        }
      };
    }
  }

  // ============================================================
  // 5. "I'M STUCK" / HINT LADDER
  // ============================================================
  if (isStuckIntent(cleanText) || action?.value === 'stuck') {
    const currentConceptObj = getConcept(twin.currentConcept) || getAllConcepts()[0];
    const hintIdx = twin.nextHintLevel();
    const hintLabels = ['💡 Hint', '🔍 Concrete Example', '🛠️ Step-by-Step Demonstration', '📖 Full Explanation'];
    const hintText = currentConceptObj.hints?.[hintIdx] || currentConceptObj.hints?.[0] || 'Take your time to explore the parts!';

    messages.push({
      type: 'text',
      character: twin.currentCharacter,
      text: `${hintLabels[hintIdx]}: ${hintText}`
    });

    quickReplies = [
      { label: '👍 Got it, ready!', value: 'continue', action: 'quick' },
      { label: "🆘 Still need another hint", value: 'stuck', action: 'quick' },
      ...getPersistentQuickReplies()
    ];

    twin.addDecision({
      intent: 'stuck_hint_ladder',
      concept: currentConceptObj.id,
      character: twin.currentCharacter,
      level: getMasteryLevel(twin.mastery[currentConceptObj.id]).level,
      reason: `Delivered hint level ${hintIdx + 1} (${hintLabels[hintIdx]}), mastery adjusted -3`,
      signalsUsed: { ...twin.signals },
      provider: 'rule-based'
    });

    return {
      messages,
      quickReplies,
      state: twin.toSummary(),
      decision: {
        intent: 'stuck_hint_ladder',
        concept: currentConceptObj.id,
        character: twin.currentCharacter,
        alternatives: [],
        level: getMasteryLevel(twin.mastery[currentConceptObj.id]).level,
        reason: `Hint ladder level ${hintIdx + 1}`,
        signalsUsed: { ...twin.signals },
        provider: 'rule-based'
      }
    };
  }

  // ============================================================
  // 6. INTEREST CHANGE INTENT
  // ============================================================
  const foundConceptInText = findConceptInText(cleanText);
  if (isChangeInterestIntent(cleanText) || action?.value === 'change_interest' || (foundConceptInText && foundConceptInText.id !== twin.currentConcept && !twin.currentConcept)) {
    const targetConcept = foundConceptInText || getAllConcepts().find(c => c.id !== twin.currentConcept) || getAllConcepts()[0];
    const routing = selectBestCharacter({
      conceptId: targetConcept.id,
      interests: [targetConcept.name, ...(targetConcept.keywords || [])],
      currentCharacterId: twin.currentCharacter,
      twin
    });

    const oldChar = getCharacter(twin.currentCharacter);
    twin.currentCharacter = routing.best.id;
    twin.currentConcept = targetConcept.id;
    twin.stage = 'build';
    twin.resetHintLevel();

    messages.push({
      type: 'handoff',
      character: routing.best.id,
      text: `That connects to another exciting idea! Let's explore ${targetConcept.name} with ${routing.best.name}!`,
      data: { from: oldChar?.id, to: routing.best.id, emoji: routing.best.emoji }
    });

    const explainText = formatExplanation(targetConcept, twin);
    messages.push({
      type: 'build',
      character: routing.best.id,
      text: `Hey! I'm ${routing.best.name} ${routing.best.emoji}.\n\n${explainText}\n\n🔨 Step 1 (Build): ${targetConcept.build}`,
      data: {
        conceptId: targetConcept.id,
        parts: targetConcept.virtualBuild || ['battery', 'wire', 'motor']
      }
    });

    // Check if Team-Up is available for this concept
    const canTeamUp = getVerifiedCharactersForConcept(targetConcept.id).length >= 2;

    quickReplies = [
      { label: '✅ Build completed!', value: 'build_done', action: 'quick' },
      ...(canTeamUp ? [{ label: '🤝 Team-Up!', value: 'team_up', action: 'quick' }] : []),
      ...getPersistentQuickReplies()
    ];

    twin.addDecision({
      intent: 'interest_reroute',
      concept: targetConcept.id,
      character: routing.best.id,
      level: getMasteryLevel(twin.mastery[targetConcept.id]).level,
      reason: `Rerouted to ${targetConcept.name} and ${routing.best.name}, preserving existing mastery`,
      signalsUsed: { ...twin.signals },
      provider: 'rule-based'
    });

    return {
      messages,
      quickReplies,
      state: twin.toSummary(),
      decision: {
        intent: 'interest_reroute',
        concept: targetConcept.id,
        character: routing.best.id,
        alternatives: routing.alternatives,
        level: getMasteryLevel(twin.mastery[targetConcept.id]).level,
        reason: `Interest rerouted to ${targetConcept.name}`,
        signalsUsed: { ...twin.signals },
        provider: 'rule-based'
      }
    };
  }

  // ============================================================
  // 7. ACTIVE MISSION ENGINE STAGES
  // Build -> Experiment -> Observe -> Explain -> Create -> Complete
  // ============================================================
  const currentConceptObj = getConcept(twin.currentConcept) || findConceptForInterests(twin.interests, twin.mastery);
  twin.currentConcept = currentConceptObj.id;
  const currentChar = getCharacter(twin.currentCharacter) || getCharacter('wavy');

  // STAGE A: BUILD
  if (twin.stage === 'build' || actionType === 'build' || action?.value === 'build_done' || cleanText.toLowerCase().includes('done') || cleanText.toLowerCase().includes('built')) {
    twin.stage = 'experiment';
    twin.adjustMastery(currentConceptObj.id, 10);
    twin.addXp(10);

    messages.push({
      type: 'text',
      character: currentChar.id,
      text: `🎉 Fantastic hands-on build! You just assembled the real foundation.\n\n🧪 **Step 2 (Experiment):** ${currentConceptObj.experiment}`
    });

    quickReplies = (currentConceptObj.observeOptions || []).map((opt, i) => ({
      label: opt,
      value: `observe_${i}`,
      action: 'observe'
    }));

    twin.addDecision({
      intent: 'mission_experiment_stage',
      concept: currentConceptObj.id,
      character: currentChar.id,
      level: getMasteryLevel(twin.mastery[currentConceptObj.id]).level,
      reason: 'Build completed (+10 mastery, +10 XP), transitioned to Experiment prediction',
      signalsUsed: { ...twin.signals },
      provider: 'rule-based'
    });

    return {
      messages,
      quickReplies,
      state: twin.toSummary(),
      decision: {
        intent: 'mission_experiment_stage',
        concept: currentConceptObj.id,
        character: currentChar.id,
        alternatives: [],
        level: getMasteryLevel(twin.mastery[currentConceptObj.id]).level,
        reason: 'Transition to experiment prediction',
        signalsUsed: { ...twin.signals },
        provider: 'rule-based'
      }
    };
  }

  // STAGE B: OBSERVE
  if (twin.stage === 'experiment' || actionType === 'observe' || action?.value?.startsWith('observe_')) {
    twin.stage = 'explain';
    const chosenIdx = action?.index !== undefined ? action.index : parseInt((action?.value || 'observe_0').replace('observe_', ''), 10);
    const wasCorrect = chosenIdx === 0;

    if (wasCorrect) {
      twin.adjustMastery(currentConceptObj.id, 10);
      twin.addXp(10);
    }

    const canTeamUp = getVerifiedCharactersForConcept(currentConceptObj.id).length >= 2;

    messages.push({
      type: 'text',
      character: currentChar.id,
      text: `👀 **Step 3 (Observe):** ${currentConceptObj.observe}\n\n🧠 **Step 4 (Explain):** ${currentConceptObj.teachBack}`
    });

    quickReplies = [
      { label: 'Because it connects in a loop!', value: 'tb_loop', action: 'quick' },
      { label: 'Because light reflects into our eyes!', value: 'tb_light', action: 'quick' },
      { label: 'Because motor turns energy into motion!', value: 'tb_motor', action: 'quick' },
      ...(canTeamUp ? [{ label: '🤝 Team-Up!', value: 'team_up', action: 'quick' }] : []),
      ...getPersistentQuickReplies()
    ];

    twin.addDecision({
      intent: 'mission_explain_stage',
      concept: currentConceptObj.id,
      character: currentChar.id,
      level: getMasteryLevel(twin.mastery[currentConceptObj.id]).level,
      reason: 'Observation reviewed, transitioned to Teach-back Explain stage',
      signalsUsed: { ...twin.signals },
      provider: 'rule-based'
    });

    return {
      messages,
      quickReplies,
      state: twin.toSummary(),
      decision: {
        intent: 'mission_explain_stage',
        concept: currentConceptObj.id,
        character: currentChar.id,
        alternatives: [],
        level: getMasteryLevel(twin.mastery[currentConceptObj.id]).level,
        reason: 'Teach-back question presented',
        signalsUsed: { ...twin.signals },
        provider: 'rule-based'
      }
    };
  }

  // STAGE C: EXPLAIN / TEACH-BACK ANALYSIS
  if (twin.stage === 'explain') {
    twin.recordSignal('explain');

    const analysis = await analyzeTeachBack({
      userInput: cleanText,
      concept: currentConceptObj,
      character: currentChar
    });

    // Check for misconception
    if (analysis.misconceptionId && analysis.fix) {
      twin.recordMisconception(currentConceptObj.id, analysis.misconceptionId, analysis.fix);

      messages.push({
        type: 'text',
        character: currentChar.id,
        text: `🤔 Interesting idea! Let's test it: ${analysis.fix}\n\nNow, how would you explain it in your own words?`
      });

      quickReplies = [
        { label: 'Electricity needs a full round-trip loop!', value: 'tb_fix_loop', action: 'quick' },
        { label: 'Batteries give power to motors!', value: 'tb_fix_power', action: 'quick' },
        ...getPersistentQuickReplies()
      ];

      twin.addDecision({
        intent: 'misconception_handled',
        concept: currentConceptObj.id,
        character: currentChar.id,
        level: getMasteryLevel(twin.mastery[currentConceptObj.id]).level,
        reason: `Misconception '${analysis.misconceptionId}' detected. Kept stage, applied fix (-5 mastery).`,
        signalsUsed: { ...twin.signals },
        provider: analysis.provider
      });

      return {
        messages,
        quickReplies,
        state: twin.toSummary(),
        decision: {
          intent: 'misconception_handled',
          concept: currentConceptObj.id,
          character: currentChar.id,
          alternatives: [],
          level: getMasteryLevel(twin.mastery[currentConceptObj.id]).level,
          reason: `Misconception detected: ${analysis.misconceptionId}`,
          signalsUsed: { ...twin.signals },
          provider: analysis.provider
        }
      };
    }

    // Normal teach-back scoring
    let xpGained = 15;
    let masteryDelta = 8;
    let feedback = "Great job explaining that in your own words!";

    if (analysis.understood === 'strong') {
      masteryDelta = 20;
      xpGained = 25;
      feedback = "🌟 Outstanding! You explained that like a true STEM Master Engineer!";
    } else if (analysis.understood === 'none') {
      masteryDelta = 3;
      xpGained = 10;
      feedback = "You're getting closer! Connecting real parts is how we master it.";
    }

    twin.adjustMastery(currentConceptObj.id, masteryDelta);
    const xpResult = twin.addXp(xpGained);
    twin.stage = 'create';

    messages.push({
      type: 'text',
      character: currentChar.id,
      text: `${feedback}\n\n🚀 **Step 5 (Create):** ${currentConceptObj.create.prompt}`
    });

    if (xpResult.rankUp) {
      messages.push({
        type: 'celebration',
        character: currentChar.id,
        text: `🎉 RANK UP! You reached **${xpResult.newRank}** ${xpResult.rankEmoji}!`,
        data: xpResult
      });
    }

    quickReplies = (currentConceptObj.create.choices || []).map((ch, i) => ({
      label: ch,
      value: `create_${i}`,
      action: 'create'
    }));

    twin.addDecision({
      intent: 'mission_create_stage',
      concept: currentConceptObj.id,
      character: currentChar.id,
      level: getMasteryLevel(twin.mastery[currentConceptObj.id]).level,
      reason: `Teach-back evaluated as ${analysis.understood} (+${masteryDelta} mastery, +${xpGained} XP). Moved to Create stage.`,
      signalsUsed: { ...twin.signals },
      provider: analysis.provider
    });

    return {
      messages,
      quickReplies,
      state: twin.toSummary(),
      decision: {
        intent: 'mission_create_stage',
        concept: currentConceptObj.id,
        character: currentChar.id,
        alternatives: [],
        level: getMasteryLevel(twin.mastery[currentConceptObj.id]).level,
        reason: `Teach-back understood: ${analysis.understood}`,
        signalsUsed: { ...twin.signals },
        provider: analysis.provider
      }
    };
  }

  // STAGE D: CREATE / MISSION COMPLETE, CHALLENGE CARD, & KIT / TEACHER CARD
  if (twin.stage === 'create' || actionType === 'create' || action?.value?.startsWith('create_')) {
    twin.stage = 'complete';
    const xpResult = twin.addXp(20);
    twin.adjustMastery(currentConceptObj.id, 10);

    // Feature 5: Queue Memory Boost if concept is developing (40-75 mastery)
    const endMastery = twin.mastery[currentConceptObj.id] || 0;
    if (endMastery >= 40 && endMastery <= 75) {
      twin.queueMemoryBoost(currentConceptObj.id);
    }

    const chosenChoice = action?.choice || (currentConceptObj.create?.choices?.[0] || 'A wonderful creative project');

    messages.push({
      type: 'text',
      character: currentChar.id,
      text: `🎨 Masterpiece chosen: **"${chosenChoice}"**! You've mastered **${currentConceptObj.name}**!`
    });

    if (xpResult.rankUp) {
      messages.push({
        type: 'celebration',
        character: currentChar.id,
        text: `🏆 CELEBRATION! You are now a **${xpResult.newRank}** ${xpResult.rankEmoji}!`,
        data: xpResult
      });
    }

    // FEATURE 4: Printable STEM Challenge Card
    messages.push({
      type: 'challenge_card',
      character: currentChar.id,
      text: `📋 Here is your official Printable Funobotz STEM Challenge Card:`,
      data: {
        characterName: currentChar.name,
        characterEmoji: currentChar.emoji,
        conceptName: currentConceptObj.name,
        choice: chosenChoice,
        badge: xpResult.rankEmoji || '🏅',
        steps: [
          `1. Fold and cut the ${currentChar.name} paper robot template.`,
          `2. Lay the conductive copper foil tape tracks according to the circuit diagram.`,
          `3. Test and decorate your creation: "${chosenChoice}"!`
        ],
        safetyTip: 'Safety Tip: Only use small batteries (like AA or 3V coin cells), never wall sockets!',
        footer: 'Made with BotzBuddy for Funobotz Paper Robotics'
      }
    });

    // Output Kit Card or Teacher View Card based on Context
    if (twin.context === 'class' || twin.context === 'workshop') {
      messages.push({
        type: 'teacher',
        character: currentChar.id,
        text: `🎉 Outstanding build! Show your teacher what you built: "${chosenChoice}"`,
        data: {
          choice: chosenChoice,
          conceptName: currentConceptObj.name,
          characterName: currentChar.name
        }
      });
    } else if (currentChar.productSlug && currentChar.kitUrl) {
      messages.push({
        type: 'kit',
        character: currentChar.id,
        text: `Want to build this in real life with official paper kits?`,
        data: {
          characterName: currentChar.name,
          productSlug: currentChar.productSlug,
          kitUrl: currentChar.kitUrl,
          emoji: currentChar.emoji,
          color: currentChar.color
        }
      });
    }

    // Next concept recommendation
    const nextConcept = getAllConcepts().find(c => (twin.mastery[c.id] || 0) < 75);
    if (nextConcept) {
      const nextRouting = selectBestCharacter({
        conceptId: nextConcept.id,
        interests: twin.interests,
        currentCharacterId: twin.currentCharacter,
        twin
      });

      messages.push({
        type: 'text',
        character: currentChar.id,
        text: `Ready for your next adventure? Let's explore **${nextConcept.name}** with ${nextRouting.best.name} ${nextRouting.best.emoji}!`
      });

      quickReplies = [
        { label: `🚀 Start ${nextConcept.name}`, value: `start_${nextConcept.id}`, action: 'quick' },
        ...getPersistentQuickReplies()
      ];
    } else {
      messages.push({
        type: 'text',
        character: currentChar.id,
        text: `🌟 AMAZING! You have explored every STEM concept in the Funobotz universe! You can revisit any bot anytime.`
      });
      quickReplies = getPersistentQuickReplies();
    }

    twin.addDecision({
      intent: 'mission_completed',
      concept: currentConceptObj.id,
      character: currentChar.id,
      level: getMasteryLevel(twin.mastery[currentConceptObj.id]).level,
      reason: `Mission completed, challenge card generated, next concept suggested`,
      signalsUsed: { ...twin.signals },
      provider: 'rule-based'
    });

    return {
      messages,
      quickReplies,
      state: twin.toSummary(),
      decision: {
        intent: 'mission_completed',
        concept: currentConceptObj.id,
        character: currentChar.id,
        alternatives: [],
        level: getMasteryLevel(twin.mastery[currentConceptObj.id]).level,
        reason: 'Mission completed successfully',
        signalsUsed: { ...twin.signals },
        provider: 'rule-based'
      }
    };
  }

  // ============================================================
  // 8. VAGUE / OFF-TOPIC / ONBOARDING CLARIFICATION
  // ============================================================
  const wavy = getCharacter('wavy') || currentChar;
  const verified = getAllCharacters().filter(c => c.status === 'verified');
  const allConcepts = getAllConcepts();

  messages.push({
    type: 'text',
    character: wavy.id,
    text: `I'm Wavy 👋, your Funobotz welcoming guide! I'm here to connect you with our wonderful STEM friends. What are you most curious to build today?`
  });

  quickReplies = [
    ...allConcepts.slice(0, 4).map(c => ({
      label: `✨ ${c.name}`,
      value: `start_${c.id}`,
      action: 'quick'
    })),
    { label: '🎲 Surprise me!', value: 'surprise_me', action: 'quick' }
  ];

  twin.addDecision({
    intent: 'vague_clarification',
    concept: twin.currentConcept,
    character: 'wavy',
    level,
    reason: 'Vague query or unmapped input: Wavy clarified with tap options',
    signalsUsed: { ...twin.signals },
    provider: 'rule-based'
  });

  return {
    messages,
    quickReplies,
    state: twin.toSummary(),
    decision: {
      intent: 'vague_clarification',
      concept: twin.currentConcept,
      character: 'wavy',
      alternatives: verified.map(v => ({ id: v.id, name: v.name })),
      level,
      reason: 'Wavy clarified vague query with options',
      signalsUsed: { ...twin.signals },
      provider: 'rule-based'
    }
  };
}

// -------------------------------------------------------------
// Onboarding / Initial Session Creator
// -------------------------------------------------------------
async function initializeSession({ twin, characterSlug = null }) {
  // Check if context-aware product slug is provided
  let requestedChar = null;
  if (characterSlug) {
    const allChars = getAllCharacters();
    requestedChar = allChars.find(c => c.productSlug === characterSlug || c.id === characterSlug);
  }

  let startingConcept = null;
  let routing = null;

  if (twin.explorer) {
    // Explorer profile (L-05) starts with Wavy asking open-ended curious questions
    twin.currentCharacter = 'wavy';
    twin.stage = 'idle';

    twin.addDecision({
      intent: 'explorer_onboarding',
      concept: null,
      character: 'wavy',
      level: 'Developing',
      reason: 'Explorer learner: Wavy initiates open discovery dialogue',
      signalsUsed: { ...twin.signals },
      provider: 'rule-based'
    });

    return {
      messages: [
        {
          type: 'text',
          character: 'wavy',
          text: `Hello, young explorer! 👋 I'm Wavy! Funobotz is full of moving paper robots, glowing circuits, and secret signals. What kind of invention are you curious about today?`
        }
      ],
      quickReplies: [
        { label: '🤖 Walking robots', value: 'start_motor_motion', action: 'quick' },
        { label: '🌸 Glowing lights', value: 'start_light_everyday', action: 'quick' },
        { label: '🚦 Traffic signals', value: 'start_led_sequence', action: 'quick' },
        { label: '🎲 Surprise me!', value: 'surprise_me', action: 'quick' }
      ],
      state: twin.toSummary(),
      decision: {
        intent: 'explorer_onboarding',
        concept: null,
        character: 'wavy',
        alternatives: [],
        level: 'Developing',
        reason: 'Explorer onboarding initiated',
        signalsUsed: { ...twin.signals },
        provider: 'rule-based'
      }
    };
  }

  // If specific character requested (e.g. from product page or switcher)
  if (requestedChar) {
    twin.currentCharacter = requestedChar.id;
    if (requestedChar.status === 'verified') {
      startingConcept = getConcept(requestedChar.concepts[0]) || getAllConcepts()[0];
    } else {
      startingConcept = findConceptForInterests(twin.interests, twin.mastery);
    }
  } else {
    startingConcept = findConceptForInterests(twin.interests, twin.mastery);
    routing = selectBestCharacter({
      conceptId: startingConcept.id,
      interests: twin.interests,
      currentCharacterId: twin.currentCharacter,
      contextSlug: characterSlug,
      twin
    });
    twin.currentCharacter = routing.best.id;
  }

  twin.currentConcept = startingConcept.id;
  twin.stage = 'build';

  const charObj = getCharacter(twin.currentCharacter) || getCharacter('wavy');
  const explainText = formatExplanation(startingConcept, twin);

  let draftGreeting = `Hi there! I'm ${charObj.name} ${charObj.emoji}! ${(charObj.facts || [])[0] || ''}\n\nToday we are exploring **${startingConcept.name}**!\n\n${explainText}\n\n🔨 Step 1 (Build): ${startingConcept.build}`;

  const rewritten = await talkerRewrite({
    character: charObj,
    draft: draftGreeting,
    twin
  });

  const messages = [
    {
      type: 'text',
      character: charObj.id,
      text: rewritten.text
    },
    {
      type: 'build',
      character: charObj.id,
      text: `Let's assemble our build! Tap the parts in order:`,
      data: {
        conceptId: startingConcept.id,
        parts: startingConcept.virtualBuild || ['battery', 'wire', 'load']
      }
    }
  ];

  const quickReplies = [
    { label: '✅ I finished the build!', value: 'build_done', action: 'quick' },
    ...getPersistentQuickReplies()
  ];

  twin.addDecision({
    intent: 'session_init',
    concept: startingConcept.id,
    character: charObj.id,
    level: getMasteryLevel(twin.mastery[startingConcept.id]).level,
    reason: `Initial session matched concept ${startingConcept.name} to character ${charObj.name}`,
    signalsUsed: { ...twin.signals },
    provider: rewritten.provider
  });

  return {
    messages,
    quickReplies,
    state: twin.toSummary(),
    decision: {
      intent: 'session_init',
      concept: startingConcept.id,
      character: charObj.id,
      alternatives: routing ? routing.alternatives : [],
      level: getMasteryLevel(twin.mastery[startingConcept.id]).level,
      reason: `Initial session initialized with ${charObj.name} for ${startingConcept.name}`,
      signalsUsed: { ...twin.signals },
      provider: rewritten.provider
    }
  };
}

module.exports = {
  processMessage,
  initializeSession,
  selectBestCharacter,
  findConceptForInterests,
  getPersistentQuickReplies
};
