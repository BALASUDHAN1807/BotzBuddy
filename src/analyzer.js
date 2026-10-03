// Learning Analyzer for teach-back explanations and misconceptions
const { analyzeWithLLM } = require('./llm');

function analyzeKeywords(userInput, concept) {
  if (!userInput || !concept) {
    return {
      understood: 'none',
      keyIdeasCovered: [],
      misconceptionId: null,
      fix: null,
      wantsSwitchCharacter: null,
      newInterest: null,
      provider: 'keyword-fallback'
    };
  }

  const text = userInput.toLowerCase();

  // 1. Misconceptions check
  let foundMisconception = null;
  let fixText = null;
  if (Array.isArray(concept.misconceptions)) {
    for (const misc of concept.misconceptions) {
      for (const pattern of misc.patterns) {
        if (text.includes(pattern.toLowerCase())) {
          foundMisconception = misc.id;
          fixText = misc.fix;
          break;
        }
      }
      if (foundMisconception) break;
    }
  }

  // 2. Key ideas check
  const coveredKeyIdeas = [];
  if (Array.isArray(concept.keyIdeas)) {
    for (const ki of concept.keyIdeas) {
      let matched = false;
      for (const term of ki.terms) {
        if (text.includes(term.toLowerCase())) {
          matched = true;
          break;
        }
      }
      if (matched) {
        coveredKeyIdeas.push(ki.id);
      }
    }
  }

  // 3. Understood level
  const totalIdeas = (concept.keyIdeas || []).length || 1;
  const ratio = coveredKeyIdeas.length / totalIdeas;

  let understood = 'none';
  if (ratio >= 0.6) {
    understood = 'strong';
  } else if (coveredKeyIdeas.length > 0 || text.length > 15) {
    // If some keywords matched or child gave a thoughtful attempt
    understood = coveredKeyIdeas.length > 0 ? 'partial' : 'none';
  }

  // If a clear positive phrase is used like "because it connects in a loop"
  if (text.includes('loop') || text.includes('circle') || text.includes('bounce') || text.includes('reflect') || text.includes('spin') || text.includes('convert')) {
    if (understood === 'none') understood = 'partial';
  }

  return {
    understood,
    keyIdeasCovered: coveredKeyIdeas,
    misconceptionId: foundMisconception,
    fix: fixText,
    wantsSwitchCharacter: null,
    newInterest: null,
    provider: 'keyword-fallback'
  };
}

async function analyzeTeachBack({ userInput, concept, character }) {
  if (!userInput || !concept) {
    return analyzeKeywords(userInput, concept);
  }

  // Try LLM analyzer first
  try {
    const llmResult = await analyzeWithLLM({ userInput, concept, character });
    if (llmResult) {
      let fix = null;
      if (llmResult.misconceptionId && Array.isArray(concept.misconceptions)) {
        const m = concept.misconceptions.find(item => item.id === llmResult.misconceptionId);
        if (m) fix = m.fix;
      }
      return {
        ...llmResult,
        fix,
        provider: llmResult.provider
      };
    }
  } catch (err) {
    // fall through to keyword fallback
  }

  // Fallback to keyword analyzer
  return analyzeKeywords(userInput, concept);
}

module.exports = {
  analyzeTeachBack,
  analyzeKeywords
};
