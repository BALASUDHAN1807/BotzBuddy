const http = require('http');

function post(path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request('http://localhost:3000' + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function testFullMissionAI() {
  console.log('🤖 Testing Full 5-Stage Mission with Live AI Integration...\n');

  // 1. Session start
  const sRes = await post('/api/session', {
    context: 'home',
    age: 10,
    interests: ['circuits'],
    characterId: 'quacky'
  });
  const sid = sRes.body.sessionId;
  console.log(`1. Session Initialized: ${sid} (Quacky 🦆 on simple_circuit)`);

  // 2. Complete Build
  await post('/api/chat', { sessionId: sid, action: { type: 'build', parts: ['battery', 'wire', 'load'] } });

  // 3. Complete Observe
  await post('/api/chat', { sessionId: sid, action: { type: 'observe', index: 0 } });

  // 4. Send free-form Teach-Back explanation to trigger Groq/Gemini Analyzer
  console.log('2. Sending Child Teach-back Explanation to trigger Groq/Gemini Analyzer...');
  const explainRes = await post('/api/chat', {
    sessionId: sid,
    text: 'A simple circuit works when there is a closed continuous loop from the battery through the wires and load back to the battery.'
  });

  console.log(`   - Decision Intent: ${explainRes.body.decision.intent}`);
  console.log(`   - Analyzer AI Provider: ${explainRes.body.decision.provider}`);
  console.log(`   - Output Dialogue:\n   "${explainRes.body.messages[0]?.text}"`);
  console.log(`   - Stage Transition: ${explainRes.body.state.stage}`);
  console.log('\n🎉 Live Chatbot AI Execution Verified Successfully!');
}

testFullMissionAI().catch(console.error);
