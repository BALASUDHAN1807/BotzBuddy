require('dotenv').config();
const { callOpenAI, callGemini, callGroq } = require('../src/llm');

async function test() {
  const prompt = `Child asks: "How is curd made?"\n\nExplain and return JSON:`;
  const sys = `You are BotzBuddy's general science explainer for a 7-year-old child (level: little).
Level "little" (Ages 6-8): Maximum 3 sentences. Maximum 12 words per sentence. Everyday words only. One friendly comparison to daily life. No technical terms. Playful and warm tone.
If the activity involves heat or cooking, add a one-line safety tip about asking a grown-up.
Respond in English.
Return JSON only:
{
  "answer": string,
  "safetyTip": string | null,
  "keyTerms": [string],
  "bridgeSkill": "cause_effect" | "observation" | "energy" | "motion" | "circuits" | "light" | "sequencing" | "troubleshooting" | "none",
  "bridgeLine": string,
  "readingLevelCheck": "ok" | "too_hard"
}`;

  console.log('--- Trying OpenAI ---');
  try {
    const res = await callOpenAI(prompt, sys, true);
    console.log('OpenAI result:', res);
  } catch (err) {
    console.error('OpenAI err:', err.message);
  }

  console.log('--- Trying Gemini ---');
  try {
    const res = await callGemini(prompt, sys, true);
    console.log('Gemini result:', res);
  } catch (err) {
    console.error('Gemini err:', err.message);
  }

  console.log('--- Trying Groq ---');
  try {
    const res = await callGroq(prompt, sys, true);
    console.log('Groq result:', res);
  } catch (err) {
    console.error('Groq err:', err.message);
  }
}

test();
