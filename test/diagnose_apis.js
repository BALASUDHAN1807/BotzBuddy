require('dotenv').config();

async function diagnose() {
  console.log('--- Diagnosing Groq Models ---');
  const groqKey = process.env.GROQ_API_KEY;
  if (groqKey) {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { 'Authorization': `Bearer ${groqKey}` }
      });
      const data = await res.json();
      if (data.data) {
        console.log('Available Groq models on this key:');
        console.log(data.data.map(m => m.id).join(', '));
      } else {
        console.log('Groq models response:', data);
      }
    } catch (e) {
      console.log('Groq diagnose error:', e.message);
    }
  }

  console.log('\n--- Diagnosing Gemini Models & Connectivity ---');
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${geminiKey}`, {
        signal: controller.signal
      });
      clearTimeout(timeout);
      const data = await res.json();
      if (data.models) {
        console.log('Available Gemini models on this key:');
        console.log(data.models.map(m => m.name.replace('models/', '')).filter(name => name.includes('flash') || name.includes('pro')).join(', '));
      } else {
        console.log('Gemini models response:', data);
      }
    } catch (e) {
      console.log('Gemini diagnose error:', e.message);
    }
  }
}

diagnose();
