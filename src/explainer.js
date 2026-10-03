// Age-Adaptive Explainer for BotzBuddy (OpenAI -> Gemini -> Groq -> Safe Template)
// Explains Tier 2 General STEM questions tailored to the child's age band and Learning Twin.

const { callExplainerLLM } = require('./llm');
const { getAllCharacters } = require('./registry');

const SAFE_TEMPLATE = "That's a great science question! I'm not sure enough to explain it well right now. I've saved it in the Curiosity Jar. Want to explore a Funobotz topic instead?";

function determineAgeLevel(age, wantsDepth = false) {
  let numAge = Number(age) || 9;
  
  if (wantsDepth) {
    if (numAge <= 8) numAge = 10;
    else if (numAge <= 11) numAge = 13;
  }

  if (numAge <= 8) return 'little';
  if (numAge <= 11) return 'middle';
  return 'senior';
}

function getLevelRules(level, shortMode = false) {
  if (level === 'little') {
    const maxSentences = shortMode ? 2 : 3;
    return `Level "little" (Ages 6-8): Maximum ${maxSentences} sentences. Maximum 12 words per sentence. Everyday words only. One friendly comparison to daily life. No technical terms (or at most one, explained simply in plain words). Playful and warm tone.`;
  }
  if (level === 'middle') {
    const maxSentences = shortMode ? 2 : 4;
    return `Level "middle" (Ages 9-11): Maximum ${maxSentences} sentences. Clear cause -> effect explanation. Up to 2 key terms explained in brackets, like 'fermentation (good bacteria transforming milk)'. One simple 'try this at home safely' idea when safe.`;
  }
  // senior
  const maxSentences = shortMode ? 3 : 5;
  return `Level "senior" (Ages 12-14): Maximum ${maxSentences} sentences. Use correct scientific terms (e.g., lactic acid bacteria, protein coagulation, Rayleigh scattering, aerodynamics). Explain the underlying physical or biological mechanism. Include one real-world engineering or scientific application. Include one 'think deeper' inquiry question.`;
}

function getMaxSentenceCount(level, shortMode = false) {
  if (level === 'little') return shortMode ? 2 : 3;
  if (level === 'middle') return shortMode ? 2 : 4;
  return shortMode ? 3 : 5;
}

function splitSentences(text) {
  if (!text) return [];
  // Split on sentence-ending punctuation followed by space or end
  const raw = text.split(/(?<=[.!?])\s+/);
  return raw.map(s => s.trim()).filter(s => s.length > 0);
}

function containsCharacterNames(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  const allChars = getAllCharacters();
  for (const c of allChars) {
    if (lower.includes(c.name.toLowerCase()) || lower.includes(c.id.toLowerCase())) {
      return true;
    }
  }
  // Also check common aliases
  return /\b(quacky|tiko|tolly|petalo|cuby|emoti|wavy|zen|spike|bolt|kutty)\b/i.test(lower);
}

function enforceGuardrails(data, level, shortMode = false) {
  if (!data || typeof data !== 'object' || !data.answer) {
    return null;
  }

  // 1. Reject if mentions Funobotz character names
  if (containsCharacterNames(data.answer) || containsCharacterNames(data.bridgeLine || '')) {
    console.warn('[Explainer Guardrail] Response hallucinated character name. Rejecting.');
    return null;
  }

  // 2. Sentence count trimming
  const maxSentences = getMaxSentenceCount(level, shortMode);
  let sentences = splitSentences(data.answer);

  if (sentences.length > maxSentences) {
    sentences = sentences.slice(0, maxSentences);
  }

  // 3. For 'little' level, check sentence word length
  if (level === 'little') {
    const maxWords = 14; // tolerance around 12-14 words
    sentences = sentences.map(s => {
      const words = s.split(/\s+/);
      if (words.length > maxWords) {
        return words.slice(0, maxWords).join(' ') + '...';
      }
      return s;
    });
  }

  const cleanAnswer = sentences.join(' ');

  // 4. Validate bridgeSkill
  const validSkills = ['cause_effect', 'observation', 'energy', 'motion', 'circuits', 'light', 'sequencing', 'troubleshooting', 'none'];
  const bridgeSkill = validSkills.includes(data.bridgeSkill) ? data.bridgeSkill : 'cause_effect';

  return {
    answer: cleanAnswer,
    safetyTip: data.safetyTip || null,
    keyTerms: Array.isArray(data.keyTerms) ? data.keyTerms.slice(0, 3) : [],
    bridgeSkill,
    bridgeLine: data.bridgeLine || ''
  };
}

function buildBridgeMessage(bridgeSkill, twin) {
  const interests = twin?.interests || [];
  
  switch (bridgeSkill) {
    case 'cause_effect':
    case 'observation':
    case 'light':
      return {
        character: 'petalo',
        conceptId: 'light_everyday',
        message: "That's cause and effect! Petalo 🌸 loves observing cause and effect with light. In Petalo's build, light creates bright reflections! Want to explore light reflection?",
        primaryReply: { label: '🌸 Explore with Petalo', value: 'start_light_everyday', action: 'quick' }
      };
    case 'energy':
      return {
        character: 'quacky',
        conceptId: 'battery_energy',
        message: "That connects to energy! Quacky 🦆 uses battery energy to power real paper robots. Want to explore battery power with Quacky?",
        primaryReply: { label: '🦆 Explore with Quacky', value: 'start_battery_energy', action: 'quick' }
      };
    case 'motion':
      const prefersScorpio = interests.includes('scorpions') || interests.includes('animals') || interests.includes('mechanics');
      const motionChar = prefersScorpio ? 'tiko' : 'quacky';
      return {
        character: motionChar,
        conceptId: 'motor_motion',
        message: motionChar === 'tiko'
          ? "That's mechanical motion! Tiko 🦂 uses a spinning motor to move his scorpion tail up and down. Want to explore motion with Tiko?"
          : "That's mechanical motion! Quacky 🦆 uses a spinning DC motor to waddle. Want to explore motor motion with Quacky?",
        primaryReply: motionChar === 'tiko'
          ? { label: '🦂 Explore with Tiko', value: 'start_motor_motion', action: 'quick' }
          : { label: '🦆 Explore with Quacky', value: 'start_motor_motion', action: 'quick' }
      };
    case 'circuits':
      return {
        character: 'quacky',
        conceptId: 'simple_circuit',
        message: "That connects to electrical circuits! In Quacky's 🦆 build, a simple closed loop powers the robot. Want to explore circuits with Quacky?",
        primaryReply: { label: '🦆 Explore with Quacky', value: 'start_simple_circuit', action: 'quick' }
      };
    case 'sequencing':
      return {
        character: 'tolly',
        conceptId: 'led_sequence',
        message: "That connects to step-by-step sequencing! Tolly 🚦 uses timer circuits to power red-yellow-green LED sequences. Want to explore sequencing with Tolly?",
        primaryReply: { label: '🚦 Explore with Tolly', value: 'start_led_sequence', action: 'quick' }
      };
    case 'troubleshooting':
      return {
        character: 'tiko',
        conceptId: 'troubleshooting',
        message: "That connects to finding solutions and troubleshooting! Tiko 🦂 loves diagnosing why a mechanism stops. Want to explore troubleshooting with Tiko?",
        primaryReply: { label: '🦂 Explore with Tiko', value: 'start_troubleshooting', action: 'quick' }
      };
    default:
      return {
        character: 'wavy',
        conceptId: 'simple_circuit',
        message: "Science is full of amazing discoveries! Want to explore a hands-on Funobotz STEM project?",
        primaryReply: { label: '🚀 Explore with Wavy', value: 'start_simple_circuit', action: 'quick' }
      };
  }
}

function getBridgeQuickReplies(bridgeInfo) {
  const allVerified = [
    { label: '🦆 Quacky (Circuits)', value: 'start_simple_circuit', char: 'quacky' },
    { label: '🌸 Petalo (Light)', value: 'start_light_everyday', char: 'petalo' },
    { label: '🚦 Tolly (LED Timing)', value: 'start_led_sequence', char: 'tolly' },
    { label: '🦂 Tiko (Motion)', value: 'start_motor_motion', char: 'tiko' }
  ];

  const otherChips = allVerified
    .filter(item => item.char !== bridgeInfo.character)
    .slice(0, 2)
    .map(item => ({ label: item.label, value: item.value, action: 'quick' }));

  return [
    bridgeInfo.primaryReply,
    ...otherChips,
    { label: '🎲 Surprise me', value: 'surprise_me', action: 'quick' }
  ];
}

async function explainGeneralScience({ question, twin, domain = 'physics', fallbackSkill = 'cause_effect' }) {
  const age = twin?.age || 9;
  const level = determineAgeLevel(age, twin?.wantsDepth);
  const shortMode = !!twin?.shortMode;
  const language = twin?.language || 'en';
  const levelRules = getLevelRules(level, shortMode);

  const langInstruction = language === 'ta'
    ? 'IMPORTANT: Respond in simple, child-friendly Tamil. Keep scientific and technical terms in English.'
    : 'Respond in English.';

  const systemInstruction = `You are BotzBuddy's general science explainer for a ${age}-year-old child (level: ${level}).
Answer the question accurately, safely, and at exactly this level:
${levelRules}

Label it as general science, not a Funobotz lesson.
Do not mention or invent any facts about Funobotz characters.
Do not give medical, dangerous, or adult instructions.
If the activity involves heat, sharp tools, chemicals, electricity from wall sockets, or cooking, add a one-line safety tip about asking a grown-up.
Never ask for personal information.
${langInstruction}

Return JSON only:
{
  "answer": string,
  "safetyTip": string | null,
  "keyTerms": [string],
  "bridgeSkill": "cause_effect" | "observation" | "energy" | "motion" | "circuits" | "light" | "sequencing" | "troubleshooting" | "none",
  "bridgeLine": string,
  "readingLevelCheck": "ok" | "too_hard"
}`;

  const prompt = `Child asks: "${question}"\n\nExplain and return JSON:`;

  // Call LLM chain (OpenAI -> Gemini -> Groq)
  try {
    const result = await callExplainerLLM({ prompt, systemInstruction });
    if (result && result.data) {
      const guarded = enforceGuardrails(result.data, level, shortMode);
      if (guarded) {
        return {
          ...guarded,
          level,
          age,
          provider: result.provider
        };
      }
    }
  } catch (err) {
    console.warn('[Explainer] LLM call error:', err.message);
  }

  // Safe fallback template if all LLMs fail or output was rejected by guardrails
  return {
    answer: SAFE_TEMPLATE,
    safetyTip: null,
    keyTerms: [],
    bridgeSkill: fallbackSkill || 'cause_effect',
    bridgeLine: 'Curiosity is how every great scientist starts.',
    level,
    age,
    provider: 'safe-template'
  };
}

module.exports = {
  explainGeneralScience,
  determineAgeLevel,
  getLevelRules,
  buildBridgeMessage,
  getBridgeQuickReplies,
  SAFE_TEMPLATE
};
