require('dotenv').config();

async function listGeminiGenModels() {
  const geminiKey = process.env.GEMINI_API_KEY;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${geminiKey}`);
  const data = await res.json();
  const genModels = (data.models || []).filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent'));
  console.log('Gemini Generate Content Models:');
  for (const m of genModels) {
    console.log(`- ${m.name}`);
  }
}

listGeminiGenModels();
