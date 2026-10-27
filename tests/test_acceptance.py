"""21-point acceptance suite (ported from the original Node test/acceptance.js)."""

import json
from pathlib import Path

from botzbuddy.brain import initialize_session, process_message
from botzbuddy.registry import CHAR_DIR, get_all_characters, reload_all
from botzbuddy.storage import get_curiosity_jar_summary, sanitize_question
from botzbuddy.twin import LearningTwin

ROOT = Path(__file__).resolve().parent.parent


async def test_01_full_mission_flow_without_api_keys():
    twin = LearningTwin(age=8, interests=["light"])
    init = await initialize_session(twin=twin)
    assert init["messages"]
    assert twin.stage == "build"

    await process_message(twin=twin, action={"type": "build", "parts": ["torch", "card"]})
    assert twin.stage == "experiment"
    await process_message(twin=twin, action={"type": "observe", "index": 0})
    assert twin.stage == "explain"
    await process_message(twin=twin, text="Light bounces into our eyes so we can see")
    assert twin.stage == "create"
    await process_message(twin=twin, action={"type": "create", "choice": "Paper lantern"})
    assert twin.stage == "complete"
    assert twin.xp >= 40


async def test_02_home_greets_with_wavy_and_kit_page_with_tiko():
    home = LearningTwin(context="home", explorer=True)
    await initialize_session(twin=home)
    assert home.current_character == "wavy"

    kit = LearningTwin(context="kit", age=10)
    await initialize_session(twin=kit, character_slug="tiko-scorpio")
    assert kit.current_character == "tiko"


async def test_03_profile_L01_routes_to_petalo():
    twin = LearningTwin(profile_id="L-01")
    await initialize_session(twin=twin)
    assert twin.current_character == "petalo"
    assert twin.current_concept == "light_everyday"
    assert twin.age_band == "young"


async def test_04_profile_L04_skips_known_circuit_routes_to_tolly():
    twin = LearningTwin(profile_id="L-04")
    assert twin.mastery["simple_circuit"] >= 80
    await initialize_session(twin=twin)
    assert twin.current_character == "tolly"
    assert twin.wants_depth


async def test_05_interest_change_reroutes_and_preserves_mastery():
    twin = LearningTwin(age=9, interests=["light"])
    await initialize_session(twin=twin)
    twin.mastery["light_everyday"] = 45
    res = await process_message(twin=twin, text="Actually I want to learn about motors and movement")
    assert any(m["type"] == "handoff" for m in res["messages"])
    assert twin.current_character in ("quacky", "tiko")
    assert twin.mastery["light_everyday"] == 45


async def test_06_already_know_triggers_micro_check():
    twin = LearningTwin(age=10, interests=["circuits"])
    await initialize_session(twin=twin)
    res = await process_message(twin=twin, text="I already know this")
    assert any(m["type"] == "check" for m in res["messages"])
    await process_message(twin=twin, action={"type": "check", "index": 0})
    assert twin.current_concept in twin.mastery


async def test_07_misconception_detected():
    twin = LearningTwin(age=10, interests=["motors"])
    twin.current_concept = "motor_motion"
    twin.current_character = "quacky"
    twin.stage = "explain"
    res = await process_message(twin=twin, text="The motor makes energy for the robot")
    assert res["decision"]["intent"] == "misconception_handled"
    assert twin.misconceptions_found
    assert "Interesting idea!" in res["messages"][0]["text"]


async def test_08_stuck_three_times_walks_hint_ladder():
    twin = LearningTwin(age=10, interests=["light"])
    twin.current_concept = "light_everyday"
    for expected in (1, 2, 3):
        await process_message(twin=twin, text="I'm stuck")
        assert twin.hint_level == expected


async def test_09_unapproved_fact_goes_to_curiosity_jar():
    twin = LearningTwin(age=10, character_id="cuby")
    res = await process_message(twin=twin, text="What is Cuby's favourite programming language?")
    assert res["decision"]["intent"] == "curiosity_jar"
    assert "I don't have an approved Funobotz fact about that yet" in res["messages"][0]["text"]


async def test_10_behaviour_only_character_suggests_verified():
    twin = LearningTwin(age=9)
    res = await process_message(twin=twin, text="Teach me with Emoti")
    assert res["decision"]["intent"] == "behaviour_only_handoff"
    assert "expression bot" in res["messages"][0]["text"]


async def test_11_vague_query_clarified_by_wavy():
    twin = LearningTwin(age=9)
    res = await process_message(twin=twin, text="tell me something")
    assert res["decision"]["intent"] == "vague_clarification"
    assert res["quickReplies"]


async def test_12_twin_tracks_signals_and_decisions():
    twin = LearningTwin(age=9)
    await initialize_session(twin=twin)
    await process_message(twin=twin, text="I want to build a robot")
    summary = twin.to_summary()
    assert summary["signals"]["say"] > 0
    assert summary["recentDecisions"]


async def test_13_class_context_shows_teacher_card():
    twin = LearningTwin(context="class", age=10, interests=["motors"])
    await initialize_session(twin=twin)
    twin.stage = "create"
    res = await process_message(twin=twin, action={"type": "create", "choice": "Motorized linkage"})
    teacher = next((m for m in res["messages"] if m["type"] == "teacher"), None)
    assert teacher and "Show your teacher" in teacher["text"]
    summary = twin.to_teacher_summary(1)
    assert summary["learnerLabel"] == "Learner 1"
    assert summary["context"] == "class"


def test_14_hot_reload_discovers_new_character():
    path = CHAR_DIR / "test_bot.json"
    data = {
        "id": "test_bot",
        "name": "TestBot",
        "status": "verified",
        "facts": ["A special test robot created for hot reloading."],
        "concepts": ["motor_motion"],
        "interestTags": ["testing", "motors"],
        "emoji": "🧪",
    }
    try:
        path.write_text(json.dumps(data), encoding="utf-8")
        reload_all()
        found = next((c for c in get_all_characters() if c["id"] == "test_bot"), None)
        assert found and found["status"] == "verified"
    finally:
        path.unlink(missing_ok=True)
        reload_all()
    assert not any(c["id"] == "test_bot" for c in get_all_characters())


async def test_15_tamil_language_without_keys():
    twin = LearningTwin(age=8, language="ta")
    init = await initialize_session(twin=twin)
    assert twin.language == "ta"
    assert init["messages"][0]["text"]


def test_16_env_is_gitignored():
    assert ".env" in (ROOT / ".gitignore").read_text(encoding="utf-8")


async def test_17_team_up():
    twin = LearningTwin(age=9, interests=["motors"])
    twin.current_concept = "motor_motion"
    twin.current_character = "quacky"
    twin.stage = "explain"
    res = await process_message(twin=twin, action={"type": "quick", "value": "team_up"})
    assert any(m["type"] == "teamup" for m in res["messages"])
    assert res["decision"]["intent"] == "team_up"
    assert res["decision"]["reason"] == "Concept shared by multiple verified characters → team-up"

    res = await process_message(twin=twin, text="Both turn battery electrical energy into spinning motor motion")
    assert res["decision"]["intent"] == "team_up_analyzed"
    assert twin.stage == "create"


async def test_18_curiosity_jar_strips_pii():
    twin = LearningTwin(age=10, character_id="cuby")
    res = await process_message(twin=twin, text="What is Cuby's favourite food?")
    assert res["decision"]["intent"] == "curiosity_jar"
    assert "Curiosity Jar" in res["messages"][0]["text"]
    assert get_curiosity_jar_summary()["total"] > 0

    clean = sanitize_question("What is Cuby's favorite food? Call 9876543210 or email test@example.com")
    assert "9876543210" not in clean
    assert "test@example.com" not in clean


async def test_19_confidence_meter_rules():
    twin = LearningTwin(age=10, interests=["circuits"])
    twin.current_concept = "simple_circuit"
    start = twin.mastery["simple_circuit"]

    await process_message(twin=twin, action={"type": "confidence", "value": "conf_sure", "level": "sure", "isCorrect": True})
    assert twin.mastery["simple_circuit"] > start
    assert twin.signals["confidence"] == 1

    await process_message(twin=twin, action={"type": "confidence", "value": "conf_unsure", "level": "unsure", "isCorrect": True})
    assert "simple_circuit" in twin.memory_boost_queue

    prev = twin.mastery["simple_circuit"]
    res = await process_message(twin=twin, action={"type": "confidence", "value": "conf_sure", "level": "sure", "isCorrect": False})
    assert twin.mastery["simple_circuit"] < prev
    assert "likely misconception" in res["decision"]["reason"]


async def test_20_challenge_card():
    twin = LearningTwin(age=9, interests=["light"])
    twin.current_concept = "light_everyday"
    twin.current_character = "petalo"
    twin.stage = "create"
    res = await process_message(twin=twin, action={"type": "create", "choice": "Paper flower lantern"})
    card = next(m for m in res["messages"] if m["type"] == "challenge_card")
    assert card["data"]["characterName"] == "Petalo"
    assert len(card["data"]["steps"]) >= 3
    assert "batteries" in card["data"]["safetyTip"]
    assert "Funobotz" in card["data"]["footer"]


async def test_21_memory_boost():
    twin = LearningTwin(age=10, interests=["circuits"])
    twin.current_concept = "simple_circuit"
    twin.mastery["simple_circuit"] = 50
    twin.stage = "idle"
    twin.turns_count = 4
    twin.last_memory_boost_turn = 0
    twin.queue_memory_boost("simple_circuit")

    res = await process_message(twin=twin, text="Continue")
    assert any(m["type"] == "memory_boost" for m in res["messages"])
    assert res["decision"]["reason"] == "Concept still developing → spaced revisit"

    res = await process_message(twin=twin, action={"type": "memory_boost", "value": "boost_ans_0", "index": 0})
    assert any(m["type"] == "memory_boost_result" for m in res["messages"])
    assert twin.mastery["simple_circuit"] == 60
