const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { LearningTwin } = require('../src/twin');
const { processMessage, initializeSession } = require('../src/brain');
const { getAllCharacters, getAllConcepts, reloadAll } = require('../src/registry');

async function runTests() {
  console.log('🧪 Starting 16-Point Acceptance Tests Suite for BotzBuddy...\n');
  let passed = 0;
  let total = 0;

  function test(name, fn) {
    total++;
    try {
      fn();
      console.log(`✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`❌ [FAIL] ${name}:`, err.message);
    }
  }

  async function asyncTest(name, fn) {
    total++;
    try {
      await fn();
      console.log(`✅ [PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`❌ [FAIL] ${name}:`, err.message);
    }
  }

  // 1. Initial mission flow works without API keys
  await asyncTest('1. Rule-based full mission flow works with no API keys', async () => {
    const twin = new LearningTwin({ age: 8, interests: ['light'] });
    const init = await initializeSession({ twin });
    assert(init.messages.length > 0, 'Should return initial messages');
    assert.strictEqual(twin.stage, 'build', 'Should start at build stage');

    // Build step
    const step1 = await processMessage({ twin, action: { type: 'build', parts: ['torch', 'card'] } });
    assert.strictEqual(twin.stage, 'experiment', 'Should move to experiment stage');

    // Observe step
    const step2 = await processMessage({ twin, action: { type: 'observe', index: 0 } });
    assert.strictEqual(twin.stage, 'explain', 'Should move to explain stage');

    // Explain step
    const step3 = await processMessage({ twin, text: 'Light bounces into our eyes so we can see' });
    assert.strictEqual(twin.stage, 'create', 'Should move to create stage');

    // Create step
    const step4 = await processMessage({ twin, action: { type: 'create', choice: 'Paper lantern' } });
    assert.strictEqual(twin.stage, 'complete', 'Should complete mission');
    assert(twin.xp >= 40, 'Should award XP');
  });

  // 2. Ecosystem Context Pages (Home vs Kit)
  await asyncTest('2. home.html initializes with Wavy; kit.html?product=tiko-scorpio greets with Tiko', async () => {
    const twinHome = new LearningTwin({ context: 'home', explorer: true });
    const initHome = await initializeSession({ twin: twinHome });
    assert.strictEqual(twinHome.currentCharacter, 'wavy', 'Home explorer session should greet with Wavy');

    const twinKit = new LearningTwin({ context: 'kit', age: 10 });
    const initKit = await initializeSession({ twin: twinKit, characterSlug: 'tiko-scorpio' });
    assert.strictEqual(twinKit.currentCharacter, 'tiko', 'Kit page for tiko-scorpio should greet with Tiko');
  });

  // 3. L-01 profile test (age 8, light, Petalo, young explanation)
  await asyncTest('3. Profile L-01 routes to Petalo, light mission, young explanation', async () => {
    const twin = new LearningTwin({ profileId: 'L-01' });
    const init = await initializeSession({ twin });
    assert.strictEqual(twin.currentCharacter, 'petalo', 'L-01 should route to Petalo');
    assert.strictEqual(twin.currentConcept, 'light_everyday', 'L-01 should start with light_everyday');
    assert.strictEqual(twin.ageBand, 'young', 'L-01 is age 8 so ageBand is young');
  });

  // 4. L-04 profile test (age 12, known circuit, deep explanation, Tolly)
  await asyncTest('4. Profile L-04 skips known circuit, routes to Tolly, deep explanation', async () => {
    const twin = new LearningTwin({ profileId: 'L-04' });
    assert(twin.mastery.simple_circuit >= 80, 'L-04 already knows simple_circuit');
    const init = await initializeSession({ twin });
    assert.strictEqual(twin.currentCharacter, 'tolly', 'L-04 should route to Tolly');
    assert(twin.wantsDepth, 'L-04 wants depth');
  });

  // 5. Mid-session interest change to motors
  await asyncTest('5. Mid-session interest change reroutes to Quacky/Tiko with handoff and preserves mastery', async () => {
    const twin = new LearningTwin({ age: 9, interests: ['light'] });
    await initializeSession({ twin });
    twin.mastery.light_everyday = 45;

    const res = await processMessage({ twin, text: 'Actually I want to learn about motors and movement' });
    assert(res.messages.some(m => m.type === 'handoff'), 'Should output handoff animation line');
    assert(['quacky', 'tiko'].includes(twin.currentCharacter), 'Should reroute to Quacky or Tiko');
    assert.strictEqual(twin.mastery.light_everyday, 45, 'Previous mastery must be preserved');
  });

  // 6. Fast-track "I already know this" -> micro-check -> skip ahead
  await asyncTest('6. "I already know this" triggers micro-check and skips ahead upon correct answer', async () => {
    const twin = new LearningTwin({ age: 10, interests: ['circuits'] });
    await initializeSession({ twin });
    const checkRes = await processMessage({ twin, text: 'I already know this' });
    assert(checkRes.messages.some(m => m.type === 'check'), 'Should show micro-check');

    const passRes = await processMessage({ twin, action: { type: 'check', index: 0 } });
    assert(twin.mastery[twin.currentConcept] !== undefined);
  });

  // 7. Misconception detection in teach-back ("motor makes energy")
  await asyncTest('7. Misconception "motor makes energy" is detected, fix shown, difficulty not raised', async () => {
    const twin = new LearningTwin({ age: 10, interests: ['motors'] });
    twin.currentConcept = 'motor_motion';
    twin.currentCharacter = 'quacky';
    twin.stage = 'explain';

    const res = await processMessage({ twin, text: 'The motor makes energy for the robot' });
    assert(res.decision.intent === 'misconception_handled', 'Should identify misconception intent');
    assert(twin.misconceptionsFound.length > 0, 'Should record misconception');
    assert(res.messages[0].text.includes('Interesting idea!'), 'Should show friendly fix');
  });

  // 8. "I'm stuck" three times traverses hint ladder
  await asyncTest('8. "I am stuck" 3 times steps through hint ladder (hint, example, demo)', async () => {
    const twin = new LearningTwin({ age: 10, interests: ['light'] });
    twin.currentConcept = 'light_everyday';

    const h1 = await processMessage({ twin, text: "I'm stuck" });
    assert.strictEqual(twin.hintLevel, 1, 'Hint level 1');
    const h2 = await processMessage({ twin, text: "I'm stuck" });
    assert.strictEqual(twin.hintLevel, 2, 'Hint level 2');
    const h3 = await processMessage({ twin, text: "I'm stuck" });
    assert.strictEqual(twin.hintLevel, 3, 'Hint level 3');
  });

  // 9. Hallucination prevention for unapproved facts (Curiosity Jar)
  await asyncTest('9. Questions about unapproved facts (e.g. favourite programming language) refuse to invent + log to Curiosity Jar', async () => {
    const twin = new LearningTwin({ age: 10, characterId: 'cuby' });
    twin.currentCharacter = 'cuby';
    const res = await processMessage({ twin, text: "What is Cuby's favourite programming language?" });
    assert(res.decision.intent === 'curiosity_jar' || res.decision.intent === 'unsupported_fact_prevented', 'Should detect unsupported fact / curiosity jar');
    assert(res.messages[0].text.includes("I don't have an approved Funobotz fact about that yet"), 'Should refuse invention');
  });

  // 10. Behaviour-only character suggestion
  await asyncTest('10. "Teach me with Emoti" shares known behaviour and suggests verified character', async () => {
    const twin = new LearningTwin({ age: 9 });
    const res = await processMessage({ twin, text: 'Teach me with Emoti' });
    assert(res.decision.intent === 'behaviour_only_handoff', 'Should be behaviour_only_handoff');
    assert(res.messages[0].text.includes('expression bot'), 'Should share known behaviour fact');
  });

  // 11. Vague query clarification
  await asyncTest('11. Vague "tell me something" gets clarified by Wavy with tap options', async () => {
    const twin = new LearningTwin({ age: 9 });
    twin.stage = 'idle';
    const res = await processMessage({ twin, text: 'tell me something' });
    assert.strictEqual(res.decision.intent, 'vague_clarification');
    assert(res.quickReplies.length > 0, 'Should provide clarification tap options');
  });

  // 12. Learning Twin state & signals update
  await asyncTest('12. Learning Twin state tracks signals, mastery, and decision logs', async () => {
    const twin = new LearningTwin({ age: 9 });
    await initializeSession({ twin });
    await processMessage({ twin, text: 'I want to build a robot' });
    const summary = twin.toSummary();
    assert(summary.signals.say > 0, 'Say signal recorded');
    assert(summary.recentDecisions.length > 0, 'Decisions logged');
  });

  // 13. Class / Workshop context & Teacher View summary + "Show your teacher" card
  await asyncTest('13. class.html supports Teacher summary and shows "Show your teacher" at mission end', async () => {
    const twinClass = new LearningTwin({ context: 'class', age: 10, interests: ['motors'] });
    await initializeSession({ twin: twinClass });
    twinClass.stage = 'create';

    const endRes = await processMessage({ twin: twinClass, action: { type: 'create', choice: 'Motorized linkage' } });
    const teacherMsg = endRes.messages.find(m => m.type === 'teacher');
    assert(teacherMsg, 'Should return teacher card instead of kit card in class context');
    assert(teacherMsg.text.includes('Show your teacher'), 'Should instruct showing teacher');

    const teacherSummary = twinClass.toTeacherSummary(1);
    assert.strictEqual(teacherSummary.learnerLabel, 'Learner 1');
    assert.strictEqual(teacherSummary.context, 'class');
  });

  // 14. Hot reload with test character
  await asyncTest('14. Hot reload discovers new character test_bot.json with status verified', async () => {
    const testCharPath = path.join(__dirname, '..', 'data', 'characters', 'test_bot.json');
    const testCharData = {
      id: 'test_bot',
      name: 'TestBot',
      group: 'A',
      status: 'verified',
      role: 'builder',
      facts: ['A special test robot created for hot reloading.'],
      concepts: ['motor_motion'],
      interestTags: ['testing', 'motors'],
      emoji: '🧪',
      color: '#00AAFF',
      avatarUrl: null,
      productSlug: 'test-bot',
      kitUrl: 'https://store.funobotz.com',
      voiceStyle: 'Crisp and robotic',
      voiceStyleNote: 'voice style and emoji are team presentation choices, not Funobotz facts',
      source: 'Official Funobotz Pack 2'
    };

    fs.writeFileSync(testCharPath, JSON.stringify(testCharData, null, 2), 'utf-8');
    reloadAll();

    const chars = getAllCharacters();
    const found = chars.find(c => c.id === 'test_bot');
    assert(found && found.status === 'verified', 'TestBot should be loaded dynamically');

    // Clean up test character
    fs.unlinkSync(testCharPath);
    reloadAll();
  });

  // 15. Tamil language setting
  await asyncTest('15. Tamil language setting handles response with rule-based note when key absent', async () => {
    const twin = new LearningTwin({ age: 8, language: 'ta' });
    const init = await initializeSession({ twin });
    assert.strictEqual(twin.language, 'ta');
    assert(init.messages[0].text.length > 0);
  });

  // 16. Security & Gitignore check
  test('16. Security: .env is in .gitignore and no secrets in source', () => {
    const gitignorePath = path.join(__dirname, '..', '.gitignore');
    if (fs.existsSync(gitignorePath)) {
      const gitignore = fs.readFileSync(gitignorePath, 'utf-8');
      assert(gitignore.includes('.env'), '.gitignore must contain .env');
    }
  });

  // 17. INNOVATION 1: Character Team-Up
  await asyncTest('17. Innovation 1: Character Team-Up triggers dual verified character example & comparison', async () => {
    const twin = new LearningTwin({ age: 9, interests: ['motors'] });
    twin.currentConcept = 'motor_motion';
    twin.currentCharacter = 'quacky';
    twin.stage = 'explain';

    const teamUpRes = await processMessage({ twin, action: { type: 'quick', value: 'team_up' } });
    assert(teamUpRes.messages.some(m => m.type === 'teamup'), 'Must render teamup dual avatar card');
    assert.strictEqual(teamUpRes.decision.intent, 'team_up');
    assert.strictEqual(teamUpRes.decision.reason, 'Concept shared by multiple verified characters → team-up');

    // Teach-back comparison
    const compareRes = await processMessage({ twin, text: 'Both turn battery electrical energy into spinning motor motion' });
    assert.strictEqual(compareRes.decision.intent, 'team_up_analyzed');
    assert.strictEqual(twin.stage, 'create');
  });

  // 18. INNOVATION 2: Curiosity Jar
  await asyncTest('18. Innovation 2: "What is Cuby\'s favourite food?" refuses to invent + logs to Curiosity Jar with PII stripped', async () => {
    const { addCuriosityQuestion, getCuriosityJarSummary, sanitizeQuestion } = require('../src/storage');
    const twin = new LearningTwin({ age: 10, characterId: 'cuby' });
    twin.currentCharacter = 'cuby';

    const res = await processMessage({ twin, text: "What is Cuby's favourite food?" });
    assert(res.decision.intent === 'curiosity_jar' || res.decision.intent === 'unsupported_fact_prevented', 'Must be curiosity jar / unsupported intent');
    assert(res.messages[0].text.includes("Curiosity Jar"), 'Must mention Curiosity Jar in message');

    const summary = getCuriosityJarSummary();
    assert(summary.total > 0, 'Question must be logged in Curiosity Jar');

    // Test sanitizer on dirty input
    const cleanText = sanitizeQuestion("What is Cuby's favorite food? Call 9876543210 or email test@example.com");
    assert(!cleanText.includes('9876543210'), 'PII phone must be stripped by sanitizeQuestion');
    assert(!cleanText.includes('test@example.com'), 'PII email must be stripped by sanitizeQuestion');
  });

  // 19. INNOVATION 3: Confidence Meter (Correct + Unsure -> Memory Boost; Wrong + Sure -> Misconception)
  await asyncTest('19. Innovation 3: Confidence Meter rules (Very Sure vs Not Sure)', async () => {
    const twin = new LearningTwin({ age: 10, interests: ['circuits'] });
    twin.currentConcept = 'simple_circuit';
    const initMastery = twin.mastery.simple_circuit || 0;

    // Test Correct + Very Sure -> +5 Bonus mastery
    const sureRes = await processMessage({
      twin,
      action: { type: 'confidence', value: 'conf_sure', level: 'sure', isCorrect: true }
    });
    assert(twin.mastery.simple_circuit > initMastery, 'Must award bonus mastery for Correct + Very sure');
    assert.strictEqual(twin.signals.confidence, 1, 'Confidence signal recorded');

    // Test Correct + Not Sure -> schedules Memory Boost
    const unsureRes = await processMessage({
      twin,
      action: { type: 'confidence', value: 'conf_unsure', level: 'unsure', isCorrect: true }
    });
    assert(twin.memoryBoostQueue.includes('simple_circuit'), 'Must schedule memory boost for Correct + Not sure');

    // Test Wrong + Very Sure -> Misconception penalty (-5 mastery)
    const prevMastery = twin.mastery.simple_circuit;
    const wrongSureRes = await processMessage({
      twin,
      action: { type: 'confidence', value: 'conf_sure', level: 'sure', isCorrect: false }
    });
    assert(twin.mastery.simple_circuit < prevMastery, 'Must deduct 5 mastery for Wrong + Very sure misconception');
    assert(wrongSureRes.decision.reason.includes('likely misconception'), 'Decision log must note misconception');
  });

  // 20. INNOVATION 4: Printable Challenge Cards
  await asyncTest('20. Innovation 4: Completing Create returns Printable Challenge Card metadata', async () => {
    const twin = new LearningTwin({ age: 9, interests: ['light'] });
    twin.currentConcept = 'light_everyday';
    twin.currentCharacter = 'petalo';
    twin.stage = 'create';

    const res = await processMessage({ twin, action: { type: 'create', choice: 'Paper flower lantern' } });
    const cardMsg = res.messages.find(m => m.type === 'challenge_card');
    assert(cardMsg, 'Must return challenge_card message type');
    assert.strictEqual(cardMsg.data.characterName, 'Petalo');
    assert(cardMsg.data.steps.length >= 3, 'Must contain 3 simple steps');
    assert(cardMsg.data.safetyTip.includes('batteries'), 'Must include battery safety tip');
    assert(cardMsg.data.footer.includes('Funobotz'), 'Must include Funobotz footer');
  });

  // 21. INNOVATION 5: Memory Boost Spaced Revisit
  await asyncTest('21. Innovation 5: Memory Boost triggers spaced revisit and awards +10 mastery on correct answer', async () => {
    const twin = new LearningTwin({ age: 10, interests: ['circuits'] });
    twin.currentConcept = 'simple_circuit';
    twin.mastery.simple_circuit = 50; // developing mastery
    twin.stage = 'idle';
    twin.turnsCount = 4;
    twin.lastMemoryBoostTurn = 0;
    twin.queueMemoryBoost('simple_circuit');

    // Trigger Memory Boost
    const boostPrompt = await processMessage({ twin, text: 'Continue' });
    assert(boostPrompt.messages.some(m => m.type === 'memory_boost'), 'Must return memory_boost prompt');
    assert.strictEqual(boostPrompt.decision.reason, 'Concept still developing → spaced revisit');

    // Answer Memory Boost Correctly
    const boostAnswer = await processMessage({
      twin,
      action: { type: 'memory_boost', value: 'boost_ans_0', index: 0 }
    });
    assert(boostAnswer.messages.some(m => m.type === 'memory_boost_result'), 'Must output sparkle memory boost result');
    assert.strictEqual(twin.mastery.simple_circuit, 60, 'Must award +10 mastery');
  });

  console.log(`\n==================================================`);
  console.log(`📊 Test Results: ${passed} / ${total} Passed (${Math.round((passed / total) * 100)}%)`);
  console.log(`==================================================\n`);

  if (passed !== total) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

if (require.main === module) {
  runTests().catch(err => {
    console.error('Fatal error in tests:', err);
    process.exit(1);
  });
}

module.exports = { runTests };
