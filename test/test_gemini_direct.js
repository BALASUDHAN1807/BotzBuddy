require('dotenv').config();

async function testGeminiDirect() {
  const geminiKey = process.env.GEMINI_API_KEY;
  const modelsToTry = ['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.0-flash'];

  for (const m of modelsToTry) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${geminiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Reply with exactly: BOTZBUDDY_API_TEST_OK' }] }]
        })
      });
      console.log(`Model [${m}] -> HTTP ${res.status}`);
      const data = await res.json();
      if (res.ok) {
        console.log(`Success! Response: ${data.candidates?.[0]?.content?.parts?.[0]?.text}`);
        return m;
      } else {
        console.log(`Error details:`, JSON.stringify(data));
      }
    } catch (e) {
      console.log(`Fetch error on [${m}]:`, e.message, e.cause ? `(Cause: ${e.cause.code || e.cause.message})` : '');
    }
  }
}

testGeminiDirect();
