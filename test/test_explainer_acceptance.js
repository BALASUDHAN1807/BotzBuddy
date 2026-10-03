const assert = require('assert');

async function runTests() {
  console.log('🧪 Running Age-Adaptive Explainer & 3-Tier Classifier Acceptance Tests...\n');

  const base = 'http://localhost:3000';

  async function post(url, data) {
    const res = await fetch(`${base}${url}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return { status: res.status, body: await res.json() };
  }

  // 1. "How is curd made?" with age 7 (little)
  console.log('Test 1: "How is curd made?" with age 7 (little)...');
  const s1 = await post('/api/session', { age: 7, interests: ['general'], generalStem: 'on' });
  const r1 = await post('/api/chat', { sessionId: s1.body.sessionId, text: 'How is curd made?' });
  assert(r1.body.decision.tier === 'general_stem', 'Must be Tier 2 general_stem');
  assert(r1.body.decision.ageLevel === 'little' || r1.body.decision.level === 'little', 'Must be level little');
  const genMsg1 = r1.body.messages.find(m => m.type === 'general_stem');
  assert(genMsg1, 'Must include general_stem message');
  console.log('   ✅ Level Little Answer:', genMsg1.text);
  console.log('   ✅ Safety Tip:', genMsg1.data?.safetyTip);
  console.log('   ✅ Provider:', r1.body.decision.provider);

  // 2. "How is curd made?" with age 10 (middle)
  console.log('\nTest 2: "How is curd made?" with age 10 (middle)...');
  const s2 = await post('/api/session', { age: 10, interests: ['general'], generalStem: 'on' });
  const r2 = await post('/api/chat', { sessionId: s2.body.sessionId, text: 'How is curd made?' });
  assert(r2.body.decision.ageLevel === 'middle' || r2.body.decision.level === 'middle', 'Must be level middle');
  const genMsg2 = r2.body.messages.find(m => m.type === 'general_stem');
  console.log('   ✅ Level Middle Answer:', genMsg2.text);

  // 3. "How is curd made?" with age 13 (senior)
  console.log('\nTest 3: "How is curd made?" with age 13 (senior)...');
  const s3 = await post('/api/session', { age: 13, interests: ['general'], generalStem: 'on' });
  const r3 = await post('/api/chat', { sessionId: s3.body.sessionId, text: 'How is curd made?' });
  assert(r3.body.decision.ageLevel === 'senior' || r3.body.decision.level === 'senior', 'Must be level senior');
  const genMsg3 = r3.body.messages.find(m => m.type === 'general_stem');
  console.log('   ✅ Level Senior Answer:', genMsg3.text);

  // 4. "Why is the sky blue?" age 8 vs 13
  console.log('\nTest 4: "Why is the sky blue?" depth test...');
  const s4a = await post('/api/session', { age: 8, generalStem: 'on' });
  const r4a = await post('/api/chat', { sessionId: s4a.body.sessionId, text: 'Why is the sky blue?' });
  const s4b = await post('/api/session', { age: 13, generalStem: 'on' });
  const r4b = await post('/api/chat', { sessionId: s4b.body.sessionId, text: 'Why is the sky blue?' });
  assert(r4a.body.decision.tier === 'general_stem' && r4b.body.decision.tier === 'general_stem');
  console.log('   ✅ Sky Blue (Age 8):', r4a.body.messages.find(m => m.type === 'general_stem')?.text);
  console.log('   ✅ Sky Blue (Age 13):', r4b.body.messages.find(m => m.type === 'general_stem')?.text);

  // 5. "What is Cuby's favourite food?" -> character lore, never Tier 2
  console.log('\nTest 5: Character lore: "What is Cuby\'s favourite food?"...');
  const s5 = await post('/api/session', { age: 9 });
  const r5 = await post('/api/chat', { sessionId: s5.body.sessionId, text: "What is Cuby's favourite food?" });
  assert(r5.body.decision.intent === 'curiosity_jar', 'Must stay in unsupported lore flow');
  assert(r5.body.decision.tier === 'funobotz_stem', 'Must stay in Tier 1');
  console.log('   ✅ Unsupported Fact Flow Preserved:', r5.body.messages[0].text.substring(0, 70) + '...');

  // 6. "Who won the cricket match?" -> Tier 3 redirect + Curiosity Jar
  console.log('\nTest 6: Non-STEM: "Who won the cricket match?"...');
  const s6 = await post('/api/session', { age: 9 });
  const r6 = await post('/api/chat', { sessionId: s6.body.sessionId, text: 'Who won the cricket match?' });
  assert(r6.body.decision.tier === 'non_stem' || r6.body.decision.intent === 'non_stem_redirect', 'Must be Tier 3 redirect');
  console.log('   ✅ Tier 3 Non-STEM Redirected:', r6.body.messages[0].text.substring(0, 60) + '...');

  // 7. Strict Class Mode (general-stem off) + "How is curd made?"
  console.log('\nTest 7: Strict Mode on Class Portal (general-stem off)...');
  const s7 = await post('/api/session', { age: 9, context: 'class', generalStem: 'off' });
  const r7 = await post('/api/chat', { sessionId: s7.body.sessionId, text: 'How is curd made?' });
  assert(r7.body.decision.intent === 'general_stem_strict_mode', 'Must be strict mode redirect');
  assert(!r7.body.messages.some(m => m.type === 'general_stem'), 'No science card rendered in strict mode');
  console.log('   ✅ Strict Mode Message:', r7.body.messages[0].text);

  // 8. Curiosity Domains recorded in Learning Twin
  console.log('\nTest 8: Learning Twin Curiosity Domains...');
  assert(r3.body.state.curiosityDomains?.biology || r3.body.state.curiosityDomains?.chemistry, 'Curiosity domain must be recorded');
  console.log('   ✅ Twin Curiosity Domains:', JSON.stringify(r3.body.state.curiosityDomains));

  console.log('\n🎉 ALL ACCEPTANCE TESTS PASSED 100%!');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
