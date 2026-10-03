require('dotenv').config();
const { callGemini, callGroq, talkerRewrite, analyzeWithLLM } = require('../src/llm');
const { getCharacter, getConcept } = require('../src/registry');
const { LearningTwin } = require('../src/twin');

async function verifyAI() {
  console.log('==================================================');
  console.log('🤖 BotzBuddy AI API Configuration & Live Verification');
  console.log('==================================================\n');

  // 1. Environment variables check (without printing keys)
  const geminiKeySet = !!(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim().length > 0);
  const groqKeySet = !!(process.env.GROQ_API_KEY && process.env.GROQ_API_KEY.trim().length > 0);
  const geminiModel = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  const groqModel = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';

  console.log('1. Environment Variables Loaded from .env:');
  console.log(`   - GEMINI_API_KEY configured: ${geminiKeySet ? 'YES (Present & non-empty)' : 'NO (Missing)'}`);
  console.log(`   - GEMINI_MODEL: ${geminiModel}`);
  console.log(`   - GROQ_API_KEY configured: ${groqKeySet ? 'YES (Present & non-empty)' : 'NO (Missing)'}`);
  console.log(`   - GROQ_MODEL: ${groqModel}`);
  console.log('');

  const testPrompt = 'Reply with exactly: BOTZBUDDY_API_TEST_OK';

  // 2. Direct Gemini Test
  console.log('2. Testing Google Gemini API...');
  let geminiStatus = 'NOT WORKING';
  let geminiAuth = 'Failed';
  let geminiResponse = '';
  let geminiError = null;

  try {
    const res = await callGemini(testPrompt);
    geminiResponse = res;
    geminiAuth = 'Successful';
    geminiStatus = 'WORKING';
    console.log(`   ✅ Gemini Direct Call OK -> Response: "${res}"`);
  } catch (err) {
    geminiError = err.message;
    console.error(`   ❌ Gemini Direct Call Failed -> Error: ${err.message}`);
  }

  // 3. Direct Groq Test
  console.log('\n3. Testing Groq API...');
  let groqStatus = 'NOT WORKING';
  let groqAuth = 'Failed';
  let groqResponse = '';
  let groqError = null;

  try {
    const res = await callGroq(testPrompt);
    groqResponse = res;
    groqAuth = 'Successful';
    groqStatus = 'WORKING';
    console.log(`   ✅ Groq Direct Call OK -> Response: "${res}"`);
  } catch (err) {
    groqError = err.message;
    console.error(`   ❌ Groq Direct Call Failed -> Error: ${err.message}`);
  }

  // 4. Testing End-to-End BotzBuddy AI Talker & Analyzer Flow
  console.log('\n4. Testing Full BotzBuddy AI Flow (Talker & Analyzer integration)...');
  const twin = new LearningTwin({ age: 9 });
  const quacky = getCharacter('quacky');
  const concept = getConcept('simple_circuit');

  // Test Talker Chain
  try {
    const talkerRes = await talkerRewrite({
      character: quacky,
      draft: 'Electricity flows in a complete loop from the battery to the motor and back.',
      twin
    });
    console.log(`   ✅ Talker Rewrite Flow OK (Provider: ${talkerRes.provider}) -> "${talkerRes.text}"`);
  } catch (err) {
    console.error(`   ❌ Talker Rewrite Flow Failed: ${err.message}`);
  }

  // Test Analyzer Chain
  try {
    const analyzerRes = await analyzeWithLLM({
      userInput: 'The loop must be closed from positive to negative terminal so current flows through the motor',
      concept,
      character: quacky
    });
    console.log(`   ✅ Analyzer Flow OK (Provider: ${analyzerRes?.provider || 'keyword-fallback'}) -> Understood: ${analyzerRes?.understood}, KeyIdeas: ${JSON.stringify(analyzerRes?.keyIdeasCovered)}`);
  } catch (err) {
    console.error(`   ❌ Analyzer Flow Failed: ${err.message}`);
  }

  console.log('\n==================================================');
  console.log('📋 VERIFICATION SUMMARY REPORT');
  console.log('==================================================');
  console.log(`
Gemini:
[${geminiStatus}]
Model: ${geminiModel}
Authentication: ${geminiAuth}
Response: ${geminiResponse || 'N/A'}
Error (if any): ${geminiError || 'None'}

Groq:
[${groqStatus}]
Model: ${groqModel}
Authentication: ${groqAuth}
Response: ${groqResponse || 'N/A'}
Error (if any): ${groqError || 'None'}
`);
}

verifyAI().catch(err => {
  console.error('Fatal error in verification:', err);
  process.exit(1);
});
