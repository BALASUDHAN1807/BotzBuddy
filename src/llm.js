// LLM integration layer for BotzBuddy
// Calls OpenAI, Google Gemini, and Groq via plain fetch with AbortController timeouts and fallbacks.

const { getAllCharacters } = require('./registry');

const DEFAULT_GEMINI_MODEL = 'gemini-flash-latest';
const DEFAULT_GROQ_MODEL = 'qwen/qwen3.8-27b';
const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';

const TIMEOUT_MS = 12000;
const OPENAI_TIMEOUT_MS = 8000;

async function fetchWithTimeout(url, options = {}, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return res;
  } catch (err) {
    clearTimeout(timeoutId);
    throw err;
  }
}

// -------------------------------------------------------------
// OpenAI Provider (Plain fetch, no SDK)
// -------------------------------------------------------------
async function callOpenAI(prompt, systemInstruction = '', jsonMode = false) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    throw new Error('OpenAI API key not configured');
  }

  const model = process.env.OPENAI_MODEL || DEFAULT_OPENAI_MODEL;
  const url = 'https://api.openai.com/v1/chat/completions';

  const messages = [];
  if (systemInstruction) {
    messages.push({ role: 'system', content: systemInstruction });
  }
  messages.push({ role: 'user', content: prompt });

  const body = {
    model,
    messages,
    temperature: 0.4,
    max_tokens: 350
  };

  if (jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey.trim()}`
    },
    body: JSON.stringify(body)
  }, OPENAI_TIMEOUT_MS);

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`OpenAI API error ${res.status}: ${errText.substring(0, 150)}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error('OpenAI returned empty response');
  }
  return text.trim();
}

// -------------------------------------------------------------
// Gemini Provider
// -------------------------------------------------------------
async function callGemini(prompt, systemInstruction = '', jsonMode = false) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    throw new Error('Gemini API key not configured');
  }

  const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey.trim()}`;

  const body = {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }]
      }
    ],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 600,
      responseMimeType: jsonMode ? 'application/json' : 'text/plain'
    }
  };

  if (systemInstruction) {
    body.systemInstruction = {
      parts: [{ text: systemInstruction }]
    };
  }

  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Gemini API error ${res.status}: ${errText.substring(0, 150)}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error('Gemini returned empty candidate');
  }
  return text.trim();
}

// -------------------------------------------------------------
// Groq Provider (OpenAI compatible)
// -------------------------------------------------------------
async function callGroq(prompt, systemInstruction = '', jsonMode = false) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    throw new Error('Groq API key not configured');
  }

  const model = process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL;
  const url = 'https://api.groq.com/openai/v1/chat/completions';

  const messages = [];
  if (systemInstruction) {
    messages.push({ role: 'system', content: systemInstruction });
  }
  messages.push({ role: 'user', content: prompt });

  const body = {
    model,
    messages,
    temperature: 0.3,
    max_tokens: 600
  };

  let res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey.trim()}`
    },
    body: JSON.stringify(body)
  });

  if (!res.ok && jsonMode) {
    // Retry without response_format json_object if rejected by model
    const retryBody = { ...body };
    delete retryBody.response_format;
    try {
      const retryRes = await fetchWithTimeout(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey.trim()}`
        },
        body: JSON.stringify(retryBody)
      });
      if (retryRes.ok) res = retryRes;
    } catch (e) {}
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Groq API error ${res.status}: ${errText.substring(0, 150)}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text) {
    throw new Error('Groq returned empty response');
  }
  return text.trim();
}


// -------------------------------------------------------------
// Grounding & Hallucination Check for Talker Output
// -------------------------------------------------------------
function validateTalkerOutput(output, draft, character, allCharacters) {
  if (!output || typeof output !== 'string') return false;
  const trimmed = output.trim();
  if (trimmed.length === 0 || trimmed.length > 900) return false;

  // Check if it mentions other character names that were not in the draft
  const draftLower = (draft || '').toLowerCase();
  const outputLower = trimmed.toLowerCase();

  for (const otherChar of allCharacters) {
    if (otherChar.id !== character.id) {
      const nameLower = otherChar.name.toLowerCase();
      // If output mentions another character name not in draft
      if (outputLower.includes(nameLower) && !draftLower.includes(nameLower)) {
        console.warn(`[Grounding] Talker hallucinated character name '${otherChar.name}' not in draft. Rejecting.`);
        return false;
      }
    }
  }

  return true;
}

// -------------------------------------------------------------
// Talker Chain: Gemini -> OpenAI -> Groq -> rule-based draft
// -------------------------------------------------------------
async function talkerRewrite({ character, draft, twin }) {
  if (!draft || !draft.trim()) return { text: draft, provider: 'rule-based' };

  const age = twin?.age || 9;
  const isShort = twin?.shortMode || twin?.ageBand === 'young';
  const factsList = (character.facts || []).join('; ') || 'No extra facts.';
  const lang = twin?.language || 'en';

  const lengthRule = isShort
    ? 'Keep it very short (1-2 friendly sentences max, around 20-30 words).'
    : 'Keep it concise and punchy (2-4 sentences max, around 40-60 words).';

  const langRule = lang === 'ta'
    ? 'Translate into simple, encouraging Tamil for children. Keep technical words like LED, motor, battery, circuit, sensor in English transliteration/terms.'
    : 'Language: English.';

  const systemInstruction = `You are ${character.name}, a Funobotz paper-robot STEM friend talking to a ${age}-year-old child.
Voice style: ${character.voiceStyle}.
CRITICAL CONSTRAINTS:
1. Rewrite the DRAFT message only. Preserve the core instructional meaning and instructions.
2. DO NOT add new scientific facts, character lore, backstories, superpowers, or physical features not in the draft or approved facts.
3. Approved Funobotz character facts: ${factsList}. Never invent facts about other characters.
4. ${lengthRule}
5. Encourage hands-on discovery and curiosity.
6. Never ask for personal information (names, emails, locations).
7. Return plain text only without markdown backticks or greetings.
8. ${langRule}`;

  const prompt = `DRAFT:\n${draft}\n\nRewrite with ${character.name}'s voice:`;
  const allChars = getAllCharacters();

  // 1. Try Gemini
  try {
    const geminiText = await callGemini(prompt, systemInstruction, false);
    if (validateTalkerOutput(geminiText, draft, character, allChars)) {
      return { text: geminiText, provider: 'gemini' };
    }
  } catch (err) {
    // silently proceed to fallback
  }

  // 2. Try OpenAI
  try {
    const openaiText = await callOpenAI(prompt, systemInstruction, false);
    if (validateTalkerOutput(openaiText, draft, character, allChars)) {
      return { text: openaiText, provider: 'openai' };
    }
  } catch (err) {
    // silently proceed to fallback
  }

  // 3. Try Groq
  try {
    const groqText = await callGroq(prompt, systemInstruction, false);
    if (validateTalkerOutput(groqText, draft, character, allChars)) {
      return { text: groqText, provider: 'groq' };
    }
  } catch (err) {
    // silently proceed to fallback
  }

  // 4. Fallback to rule-based draft
  let finalDraft = draft;
  if (lang === 'ta') {
    finalDraft = `${draft} (Tamil mode: connect Gemini or Groq API key in .env for dynamic translation)`;
  }
  return { text: finalDraft, provider: 'rule-based' };
}

// -------------------------------------------------------------
// LLM Analyzer Chain: Groq -> OpenAI -> Gemini -> null (caller uses keywords)
// -------------------------------------------------------------
async function analyzeWithLLM({ userInput, concept, character }) {
  const allowedKeyIdeaIds = (concept.keyIdeas || []).map(k => k.id);
  const allowedMisconceptionIds = (concept.misconceptions || []).map(m => m.id);

  const systemInstruction = `You are a strict JSON learning analyzer for children's STEM explanations.
Evaluate the child's teach-back explanation for the concept "${concept.name}".
Key ideas expected: ${JSON.stringify(concept.keyIdeas || [])}
Known misconceptions: ${JSON.stringify(concept.misconceptions || [])}

You must return ONLY a JSON object matching this schema:
{
  "understood": "strong" | "partial" | "none",
  "keyIdeasCovered": [string],
  "misconceptionId": string | null,
  "wantsSwitchCharacter": string | null,
  "newInterest": string | null
}
Constraints:
- "understood" is "strong" if >=60% of key ideas are conveyed, "partial" if at least 1 key idea or positive understanding is conveyed, "none" if confused or unrelated.
- "keyIdeasCovered" must ONLY contain valid IDs from: ${JSON.stringify(allowedKeyIdeaIds)}.
- "misconceptionId" must ONLY be one of: ${JSON.stringify(allowedMisconceptionIds)}, or null if no misconception.
- "wantsSwitchCharacter" is the character name if the child asks to talk to another robot (e.g., "Quacky", "Tiko", "Tolly", "Petalo", "Emoti"), else null.
- "newInterest" is a concept keyword if the child changed their mind, else null.`;

  const prompt = `Child's response: "${userInput}"\n\nAnalyze and return JSON:`;

  // 1. Try Groq first for fast analyzer
  try {
    const groqJsonStr = await callGroq(prompt, systemInstruction, true);
    const parsed = JSON.parse(groqJsonStr);
    if (parsed && typeof parsed === 'object') {
      const validKeyIdeas = (parsed.keyIdeasCovered || []).filter(id => allowedKeyIdeaIds.includes(id));
      const validMisc = allowedMisconceptionIds.includes(parsed.misconceptionId) ? parsed.misconceptionId : null;
      return {
        understood: ['strong', 'partial', 'none'].includes(parsed.understood) ? parsed.understood : 'partial',
        keyIdeasCovered: validKeyIdeas,
        misconceptionId: validMisc,
        wantsSwitchCharacter: parsed.wantsSwitchCharacter || null,
        newInterest: parsed.newInterest || null,
        provider: 'groq'
      };
    }
  } catch (err) {
    // fallback
  }

  // 2. Try OpenAI
  try {
    const openaiJsonStr = await callOpenAI(prompt, systemInstruction, true);
    const parsed = JSON.parse(openaiJsonStr);
    if (parsed && typeof parsed === 'object') {
      const validKeyIdeas = (parsed.keyIdeasCovered || []).filter(id => allowedKeyIdeaIds.includes(id));
      const validMisc = allowedMisconceptionIds.includes(parsed.misconceptionId) ? parsed.misconceptionId : null;
      return {
        understood: ['strong', 'partial', 'none'].includes(parsed.understood) ? parsed.understood : 'partial',
        keyIdeasCovered: validKeyIdeas,
        misconceptionId: validMisc,
        wantsSwitchCharacter: parsed.wantsSwitchCharacter || null,
        newInterest: parsed.newInterest || null,
        provider: 'openai'
      };
    }
  } catch (err) {
    // fallback
  }

  // 3. Try Gemini
  try {
    const geminiJsonStr = await callGemini(prompt, systemInstruction, true);
    const parsed = JSON.parse(geminiJsonStr);
    if (parsed && typeof parsed === 'object') {
      const validKeyIdeas = (parsed.keyIdeasCovered || []).filter(id => allowedKeyIdeaIds.includes(id));
      const validMisc = allowedMisconceptionIds.includes(parsed.misconceptionId) ? parsed.misconceptionId : null;
      return {
        understood: ['strong', 'partial', 'none'].includes(parsed.understood) ? parsed.understood : 'partial',
        keyIdeasCovered: validKeyIdeas,
        misconceptionId: validMisc,
        wantsSwitchCharacter: parsed.wantsSwitchCharacter || null,
        newInterest: parsed.newInterest || null,
        provider: 'gemini'
      };
    }
  } catch (err) {
    // fallback
  }

  // Fallback to null so caller uses keyword heuristics
  return null;
}

function safeParseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (e2) {}
    }
    return null;
  }
}

// -------------------------------------------------------------
// Explainer LLM Chain: OpenAI -> Gemini -> Groq -> null
// -------------------------------------------------------------
async function callExplainerLLM({ prompt, systemInstruction }) {
  // 1. Try OpenAI
  try {
    const resText = await callOpenAI(prompt, systemInstruction, true);
    const parsed = safeParseJson(resText);
    if (parsed && typeof parsed === 'object' && parsed.answer) {
      return { data: parsed, provider: 'openai' };
    }
  } catch (err) {
    // fallback
  }

  // 2. Try Gemini
  try {
    const resText = await callGemini(prompt, systemInstruction, true);
    const parsed = safeParseJson(resText);
    if (parsed && typeof parsed === 'object' && parsed.answer) {
      return { data: parsed, provider: 'gemini' };
    }
  } catch (err) {
    // fallback
  }

  // 3. Try Groq
  try {
    const resText = await callGroq(prompt, systemInstruction, true);
    const parsed = safeParseJson(resText);
    if (parsed && typeof parsed === 'object' && parsed.answer) {
      return { data: parsed, provider: 'groq' };
    }
  } catch (err) {
    // fallback
  }

  return null;
}

// -------------------------------------------------------------
// Classifier LLM Chain: Groq -> OpenAI -> Gemini -> null
// -------------------------------------------------------------
async function callClassifierLLM({ prompt, systemInstruction }) {
  // 1. Try Groq (fast)
  try {
    const resText = await callGroq(prompt, systemInstruction, true);
    const parsed = safeParseJson(resText);
    if (parsed && typeof parsed === 'object' && parsed.tier) {
      return { data: parsed, provider: 'groq' };
    }
  } catch (err) {}

  // 2. Try OpenAI
  try {
    const resText = await callOpenAI(prompt, systemInstruction, true);
    const parsed = safeParseJson(resText);
    if (parsed && typeof parsed === 'object' && parsed.tier) {
      return { data: parsed, provider: 'openai' };
    }
  } catch (err) {}

  // 3. Try Gemini
  try {
    const resText = await callGemini(prompt, systemInstruction, true);
    const parsed = safeParseJson(resText);
    if (parsed && typeof parsed === 'object' && parsed.tier) {
      return { data: parsed, provider: 'gemini' };
    }
  } catch (err) {}

  return null;
}


// -------------------------------------------------------------
// Photo Check Vision (Gemini Vision)
// -------------------------------------------------------------
async function photoCheckVision({ imageBase64, concept, character, age = 9 }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    throw new Error('Gemini API key not configured for vision check');
  }

  const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  // Clean base64 string
  let rawBase64 = imageBase64;
  let mimeType = 'image/jpeg';
  if (imageBase64.includes(';base64,')) {
    const parts = imageBase64.split(';base64,');
    mimeType = parts[0].replace('data:', '') || 'image/jpeg';
    rawBase64 = parts[1];
  }

  const keyIdeasStr = (concept?.keyIdeas || []).map(k => k.id).join(', ');

  const systemInstruction = `You are ${character.name}, an encouraging Funobotz paper-robot friend helping a ${age}-year-old. Look at this paper robotics build for the concept "${concept.name}". Give 2 short encouraging sentences: one thing done well and one thing to check, using only these key ideas: ${keyIdeasStr}. Do not identify people or read personal details. If the image is not a paper build, kindly ask for a photo of their paper build. Return plain text only.`;

  const body = {
    contents: [
      {
        role: 'user',
        parts: [
          {
            inlineData: {
              mimeType,
              data: rawBase64
            }
          },
          {
            text: `Please check my paper robot build for ${concept.name}!`
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 300
    },
    systemInstruction: {
      parts: [{ text: systemInstruction }]
    }
  };

  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }, 10000);

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Gemini Vision error: ${res.status} ${errText.substring(0, 100)}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Empty vision response');
  return text.trim();
}

module.exports = {
  talkerRewrite,
  analyzeWithLLM,
  callGemini,
  callGroq,
  callOpenAI,
  callExplainerLLM,
  callClassifierLLM,
  photoCheckVision
};


