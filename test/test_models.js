require('dotenv').config();

async function testModels() {
  console.log('--- Testing Gemini with gemini-2.0-flash ---');
  const geminiKey = process.env.GEMINI_API_KEY;
  const geminiModel = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'Reply with exactly: BOTZBUDDY_API_TEST_OK' }] }]
      })
    });
    console.log('Gemini HTTP Status:', res.status);
    const data = await res.json();
    console.log('Gemini Response Text:', data.candidates?.[0]?.content?.parts?.[0]?.text);
  } catch (e) {
    console.error('Gemini error:', e.message);
  }

  console.log('\n--- Testing Groq with openai/gpt-oss-120b & qwen/qwen3.8-27b ---');
  const groqKey = process.env.GROQ_API_KEY;
  const testGroqModels = [process.env.GROQ_MODEL, 'openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'openai/gpt-oss-20b'].filter(Boolean);

  for (const m of testGroqModels) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${groqKey}`
        },
        body: JSON.stringify({
          model: m,
          messages: [{ role: 'user', content: 'Reply with exactly: BOTZBUDDY_API_TEST_OK' }],
          max_tokens: 50
        })
      });
      console.log(`Groq Model [${m}] Status:`, res.status);
      const data = await res.json();
      if (res.ok) {
        console.log(`Groq Model [${m}] Response:`, data.choices?.[0]?.message?.content);
        break;
      } else {
        console.log(`Groq Model [${m}] Error:`, data.error?.message);
      }
    } catch (e) {
      console.error(`Groq Model [${m}] Fetch Error:`, e.message);
    }
  }
}

testModels();
