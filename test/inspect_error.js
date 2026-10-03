require('dotenv').config();

async function inspectError() {
  try {
    const res = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { 'Authorization': `Bearer ${process.env.GROQ_API_KEY}` }
    });
    console.log('Groq status:', res.status);
    const text = await res.text();
    console.log('Groq body:', text);
  } catch (err) {
    console.log('Groq error details:', err);
    if (err.cause) console.log('Groq cause:', err.cause);
  }

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`);
    console.log('Gemini status:', res.status);
    const text = await res.text();
    console.log('Gemini body:', text);
  } catch (err) {
    console.log('Gemini error details:', err);
    if (err.cause) console.log('Gemini cause:', err.cause);
  }
}

inspectError();
