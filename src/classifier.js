// Three-Tier Question Classifier for BotzBuddy
// Classifies free-text user questions into:
// - Tier 1: "funobotz_stem" (approved concepts or character lore questions)
// - Tier 2: "general_stem" (real science/tech/engineering/maths questions)
// - Tier 3: "non_stem" (cricket scores, celebrities, gossip, non-educational)

const { getAllCharacters, getAllConcepts } = require('./registry');
const { callClassifierLLM } = require('./llm');

const CHARACTER_LORE_PATTERNS = [
  /\b(favourite|favorite|age|how old are you|where do you live|family|parents|programming language|superpowers?|powers?|what can you do in real life|who made you|girlfriend|boyfriend|food|eat|pet|hobby)\b/i
];

const COMMON_SCIENCE_KEYWORDS = {
  biology: [
    'curd', 'yogurt', 'milk', 'bacteria', 'ferment', 'plant', 'tree', 'animal', 'cell', 'human', 'body',
    'heart', 'lungs', 'blood', 'flower', 'seed', 'leaf', 'leaves', 'photosynthesis', 'dinosaur', 'digest',
    'germ', 'dna', 'gene', 'bone', 'muscle', 'brain', 'fungi', 'mushroom', 'chlorophyll'
  ],
  chemistry: [
    'chemical', 'acid', 'base', 'reaction', 'bubble', 'gas', 'liquid', 'solid', 'melt', 'freeze',
    'boil', 'rust', 'molecule', 'atom', 'salt', 'sugar', 'water', 'oxygen', 'hydrogen', 'carbon',
    'evaporate', 'condense', 'dissolve', 'element'
  ],
  physics: [
    'sky', 'blue', 'rainbow', 'gravity', 'fall', 'float', 'magnet', 'sound', 'echo', 'friction',
    'shadow', 'sun', 'moon', 'star', 'planet', 'space', 'orbit', 'rocket', 'plane', 'fly', 'flight',
    'bounce', 'push', 'pull', 'pressure', 'wave', 'heat', 'cold', 'speed', 'temperature', 'force',
    'inertia', 'optics', 'prism', 'reflection', 'vacuum', 'universe', 'black hole', 'telescope'
  ],
  maths: [
    'calculate', 'multiply', 'multiplication', 'divide', 'division', 'math', 'maths', 'plus', 'minus',
    'square root', 'geometry', 'triangle', 'fraction', 'percentage', 'algebra', 'equation', 'times'
  ],
  technology: [
    'computer', 'internet', 'wifi', 'phone', 'software', 'hardware', 'code', 'program', 'algorithm',
    'screen', 'chip', 'microprocessor', 'satellite', 'bluetooth'
  ],
  engineering: [
    'bridge', 'building', 'wheel', 'gear', 'pulley', 'lever', 'drone', 'engine', 'machine',
    'turbine', 'crane', 'aerodynamics', 'structure'
  ]
};

const NON_STEM_PATTERNS = [
  /\b(cricket|football|soccer|score|match|ipl|world cup|actor|actress|celebrity|movie|film|song|singer|dance|gossip|politics|president|minister|election|minecraft|fortnite|roblox|vbucks|cheat code|joke)\b/i
];

function isMathExpression(text) {
  if (!text) return false;
  // Match patterns like "7 x 8", "12 * 5", "100 / 4", "15 + 23", "what is 7 times 8"
  return /\b\d+\s*(?:x|\*|\+|\-|\/|times|divided by|plus|minus)\s*\d+\b/i.test(text) ||
         /\bwhat is \d+\s*(?:x|\*|\+|\-|\/|times|divided by|plus|minus)\s*\d+\b/i.test(text);
}

function checkRuleBasedClassification(text, currentCharacter) {
  if (!text) return null;
  const clean = text.trim();
  const lower = clean.toLowerCase();

  const allChars = getAllCharacters();
  const allConcepts = getAllConcepts();

  // 1. Check if the question mentions any character name or character lore
  let mentionedChar = null;
  for (const c of allChars) {
    if (lower.includes(c.name.toLowerCase()) || lower.includes(c.id.toLowerCase())) {
      mentionedChar = c;
      break;
    }
  }

  // Check character lore / unsupported questions
  const isLoreQuestion = CHARACTER_LORE_PATTERNS.some(p => p.test(lower));
  if (isLoreQuestion) {
    // Character fact questions about unapproved facts ALWAYS stay in Tier 1 / unsupported fact flow
    return {
      tier: 'funobotz_stem',
      isUnsupportedCharacterFact: true,
      domain: 'funobotz',
      bridgeSkill: 'none',
      character: mentionedChar ? mentionedChar.id : (currentCharacter?.id || 'wavy'),
      reason: 'Character lore / unapproved character fact question'
    };
  }

  // If a character name is explicitly mentioned along with a command/switch
  if (mentionedChar && (lower.includes('switch') || lower.includes('meet') || lower.includes('learn with') || lower.includes('talk to'))) {
    return {
      tier: 'funobotz_stem',
      isUnsupportedCharacterFact: false,
      domain: 'funobotz',
      bridgeSkill: 'none',
      character: mentionedChar.id,
      reason: 'Character switch request'
    };
  }

  // Check if navigation / continuation command
  if (/^(continue|next|go ahead|ready|start)$/i.test(lower)) {
    return {
      tier: 'funobotz_stem',
      isUnsupportedCharacterFact: false,
      isNavigation: true,
      domain: 'funobotz',
      bridgeSkill: 'none',
      reason: 'Navigation continuation keyword'
    };
  }

  // Check if vague greeting or prompt
  if (/\b(tell me something|hello|hi|hey|what can you do|who are you|greetings|help me choose)\b/i.test(lower)) {
    return {
      tier: 'funobotz_stem',
      isVague: true,
      domain: 'funobotz',
      bridgeSkill: 'none',
      reason: 'Vague query or greeting'
    };
  }

  // 2. Check if text matches approved Funobotz concepts directly

  for (const c of allConcepts) {
    for (const kw of c.keywords || []) {
      if (lower.includes(kw.toLowerCase())) {
        return {
          tier: 'funobotz_stem',
          isUnsupportedCharacterFact: false,
          domain: 'funobotz',
          bridgeSkill: 'none',
          conceptId: c.id,
          reason: `Matched Funobotz concept keyword: ${kw}`
        };
      }
    }
  }

  // Check if active mission phrases
  if (/\b(build|assembled|experiment|observe|loop|circuit|motor|battery|switch|wire|led|stuck|already know|team up)\b/i.test(lower)) {
    return {
      tier: 'funobotz_stem',
      isUnsupportedCharacterFact: false,
      domain: 'funobotz',
      bridgeSkill: 'none',
      reason: 'Active mission instruction or keyword'
    };
  }

  return null;
}

function keywordFallbackClassification(text) {
  const lower = (text || '').toLowerCase();

  // 1. Math expression check
  if (isMathExpression(text)) {
    return {
      tier: 'general_stem',
      domain: 'maths',
      bridgeSkill: 'sequencing',
      reason: 'Keyword fallback: Math expression detected'
    };
  }

  // 2. Non-STEM pattern check
  for (const p of NON_STEM_PATTERNS) {
    if (p.test(lower)) {
      return {
        tier: 'non_stem',
        domain: 'other',
        bridgeSkill: 'none',
        reason: 'Keyword fallback: Non-STEM topic detected'
      };
    }
  }

  // 3. STEM domain checks
  for (const [domain, keywords] of Object.entries(COMMON_SCIENCE_KEYWORDS)) {
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        let bridgeSkill = 'cause_effect';
        if (domain === 'physics') {
          if (lower.includes('light') || lower.includes('sky') || lower.includes('blue') || lower.includes('rainbow') || lower.includes('shadow')) {
            bridgeSkill = 'light';
          } else if (lower.includes('plane') || lower.includes('fly') || lower.includes('flight') || lower.includes('motion') || lower.includes('gravity') || lower.includes('speed')) {
            bridgeSkill = 'motion';
          } else if (lower.includes('heat') || lower.includes('energy') || lower.includes('sun') || lower.includes('star')) {
            bridgeSkill = 'energy';
          }
        } else if (domain === 'biology' || domain === 'chemistry') {
          bridgeSkill = 'cause_effect';
        } else if (domain === 'maths') {
          bridgeSkill = 'sequencing';
        } else if (domain === 'technology' || domain === 'engineering') {
          bridgeSkill = 'circuits';
        }

        return {
          tier: 'general_stem',
          domain,
          bridgeSkill,
          reason: `Keyword fallback: Matched science term '${kw}' in ${domain}`
        };
      }
    }
  }

  // 4. Default: If it's a science-sounding question (e.g. why does X happen, how does X work)
  if (/\b(why|how does|what is|how do|how is|where does)\b/i.test(lower)) {
    return {
      tier: 'general_stem',
      domain: 'physics',
      bridgeSkill: 'observation',
      reason: 'Keyword fallback: General inquisitive query'
    };
  }

  // Default to non-STEM
  return {
    tier: 'non_stem',
    domain: 'other',
    bridgeSkill: 'none',
    reason: 'Keyword fallback: No STEM keywords found'
  };
}

async function classifyQuestion({ text, currentCharacter, twin }) {
  if (!text || typeof text !== 'string') {
    return {
      tier: 'non_stem',
      domain: 'other',
      bridgeSkill: 'none',
      reason: 'Empty text'
    };
  }

  const cleanText = text.trim();

  // 1. Rule-based check
  const ruleResult = checkRuleBasedClassification(cleanText, currentCharacter);
  if (ruleResult) {
    return ruleResult;
  }

  // 2. Ask Analyzer LLM
  const systemInstruction = `You are a strict 3-tier question classifier for BotzBuddy, an adaptive STEM companion for children.
Classify the child's input into one of these 3 tiers:
- "funobotz_stem": Specifically about Funobotz paper robotics kits, character names (Quacky, Tiko, Tolly, Petalo, Cuby, Emoti, Wavy), or paper circuits.
- "general_stem": A genuine science, technology, engineering, biology, chemistry, physics, astronomy, or mathematics question (e.g., "how is curd made", "why is the sky blue", "how do planes fly", "what is 7 x 8", "why do leaves change color").
- "non_stem": Non-STEM topics such as cricket/football scores, video games, movie celebrities, gossip, or general chit-chat.

You must return ONLY a JSON object:
{
  "tier": "funobotz_stem" | "general_stem" | "non_stem",
  "domain": "biology" | "chemistry" | "physics" | "technology" | "engineering" | "maths" | "other",
  "bridgeSkill": "cause_effect" | "observation" | "energy" | "motion" | "circuits" | "light" | "sequencing" | "troubleshooting" | "none"
}`;

  const prompt = `Child question: "${cleanText}"\n\nClassify and return JSON:`;

  try {
    const llmRes = await callClassifierLLM({ prompt, systemInstruction });
    if (llmRes && llmRes.data && llmRes.data.tier) {
      const validTiers = ['funobotz_stem', 'general_stem', 'non_stem'];
      const validDomains = ['biology', 'chemistry', 'physics', 'technology', 'engineering', 'maths', 'other'];
      const validSkills = ['cause_effect', 'observation', 'energy', 'motion', 'circuits', 'light', 'sequencing', 'troubleshooting', 'none'];

      const tier = validTiers.includes(llmRes.data.tier) ? llmRes.data.tier : 'general_stem';
      const domain = validDomains.includes(llmRes.data.domain) ? llmRes.data.domain : 'physics';
      const bridgeSkill = validSkills.includes(llmRes.data.bridgeSkill) ? llmRes.data.bridgeSkill : 'cause_effect';

      return {
        tier,
        domain,
        bridgeSkill,
        provider: llmRes.provider,
        reason: `LLM classified as ${tier} (${domain})`
      };
    }
  } catch (err) {
    // fallback to keyword classifier
  }

  // 3. Fallback to keyword heuristics
  return keywordFallbackClassification(cleanText);
}

module.exports = {
  classifyQuestion,
  checkRuleBasedClassification,
  keywordFallbackClassification
};
