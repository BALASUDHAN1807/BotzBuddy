require('dotenv').config();

async function debugGemini() {
  const geminiKey = process.env.GEMINI_API_KEY;
  const candidates = ['gemini-2.5-flash', 'models/gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.5-flash-lite', 'models/gemini-flash-latest'];

  for (const m of candidates) {
    const url = `https://generativelanguage.googleapis.com/v1beta/${m.startsWith('models/') ? m : 'models/' + m}:generateContent?key=${geminiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'Reply with exactly: BOTZBUDDY_API_TEST_OK' }] }]
      })
    });
    console.log(`Candidate [${m}] Status: ${res.status}`);
    const text = await res.text();
    console.log(`Candidate [${m}] Body: ${text.substring(0, 200)}`);
    if (res.ok) break;
  }
}

debugGemini();
