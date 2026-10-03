require('dotenv').config();

async function testUpdatedModels() {
  console.log('Testing Gemini with gemini-2.5-flash:');
  const geminiKey = process.env.GEMINI_API_KEY;
  const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: 'Reply with exactly: BOTZBUDDY_API_TEST_OK' }] }]
    })
  });
  console.log('Gemini HTTP Status:', geminiRes.status);
  const geminiData = await geminiRes.json();
  console.log('Gemini Output:', geminiData.candidates?.[0]?.content?.parts?.[0]?.text);

  console.log('\nTesting Groq with openai/gpt-oss-120b:');
  const groqKey = process.env.GROQ_API_KEY;
  const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${groqKey}`
    },
    body: JSON.stringify({
      model: 'openai/gpt-oss-120b',
      messages: [{ role: 'user', content: 'Reply with exactly: BOTZBUDDY_API_TEST_OK' }]
    })
  });
  console.log('Groq HTTP Status:', groqRes.status);
  const groqData = await groqRes.json();
  console.log('Groq Output:', groqData.choices?.[0]?.message?.content);
}

testUpdatedModels();
