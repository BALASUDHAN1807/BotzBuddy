"""HTTP-level tests for the FastAPI app, using the same payloads the browser plugin sends."""

from fastapi.testclient import TestClient

from botzbuddy.main import app

client = TestClient(app)


def test_health():
    body = client.get("/api/health").json()
    assert body["ok"] is True
    assert body["providers"]["ruleBasedFallback"] is True


def test_registry_endpoints():
    chars = client.get("/api/characters").json()
    assert any(c["id"] == "quacky" for c in chars)
    assert len(client.get("/api/concepts").json()) == 8
    assert any(p["id"] == "L-01" for p in client.get("/api/profiles").json())


def test_static_plugin_and_demo_served():
    assert client.get("/plugin/botzbuddy.js").status_code == 200
    assert client.get("/demo/").status_code == 200
    r = client.get("/", follow_redirects=False)
    assert r.status_code in (302, 307) and r.headers["location"] == "/demo/"


def test_session_and_full_chat_flow_via_plugin_payloads():
    s = client.post("/api/session", json={"context": "home", "generalStem": "on", "age": 9, "interests": ["light"]}).json()
    sid = s["sessionId"]
    assert s["state"]["stage"] == "build"

    # Quick-reply chip, sent exactly as the plugin does: action = the chip object itself
    chip = next(q for q in s["quickReplies"] if q["value"] == "build_done")
    r = client.post("/api/chat", json={"sessionId": sid, "text": chip["label"], "action": chip}).json()
    assert r["state"]["stage"] == "experiment"

    chip = r["quickReplies"][0]
    r = client.post("/api/chat", json={"sessionId": sid, "text": chip["label"], "action": chip}).json()
    assert r["state"]["stage"] == "explain"

    r = client.post("/api/chat", json={"sessionId": sid, "text": "Light bounces off things into our eyes"}).json()
    assert r["state"]["stage"] == "create"

    chip = r["quickReplies"][1]
    r = client.post("/api/chat", json={"sessionId": sid, "text": chip["label"], "action": chip}).json()
    assert r["state"]["stage"] == "complete"
    assert any(m["type"] == "challenge_card" and m["data"]["choice"] == chip["label"] for m in r["messages"])


def test_start_chip_routes_to_concept():
    sid = client.post("/api/session", json={"context": "home", "explorer": True}).json()["sessionId"]
    r = client.post(
        "/api/chat",
        json={"sessionId": sid, "text": "🚦 Traffic signals", "action": {"label": "🚦 Traffic signals", "value": "start_led_sequence", "action": "quick"}},
    ).json()
    assert r["state"]["currentConcept"] == "led_sequence"
    assert r["state"]["currentCharacter"] == "tolly"


def test_switch_chip_and_select_character():
    sid = client.post("/api/session", json={}).json()["sessionId"]
    r = client.post("/api/chat", json={"sessionId": sid, "text": "Learn", "action": {"value": "switch_quacky", "action": "quick"}}).json()
    assert r["decision"]["intent"] == "switch_character"
    assert r["state"]["currentCharacter"] == "quacky"

    r = client.post("/api/chat", json={"sessionId": sid, "action": {"type": "select_character", "characterId": "tiko"}}).json()
    assert r["state"]["currentCharacter"] == "tiko"


def test_general_stem_on_and_off():
    sid = client.post("/api/session", json={"generalStem": "on"}).json()["sessionId"]
    r = client.post("/api/chat", json={"sessionId": sid, "text": "Why is the sky blue?", "generalStem": "on"}).json()
    assert r["decision"]["intent"] == "general_stem_explained"
    assert r["messages"][0]["type"] == "general_stem"

    sid = client.post("/api/session", json={"generalStem": "off"}).json()["sessionId"]
    r = client.post("/api/chat", json={"sessionId": sid, "text": "Why is the sky blue?", "generalStem": "off"}).json()
    assert r["decision"]["intent"] == "general_stem_strict_mode"


def test_safety_and_non_stem():
    sid = client.post("/api/session", json={}).json()["sessionId"]
    r = client.post("/api/chat", json={"sessionId": sid, "text": "can I plug it into the wall socket"}).json()
    assert r["decision"]["intent"] == "safety"
    r = client.post("/api/chat", json={"sessionId": sid, "text": "who won the cricket match"}).json()
    assert r["decision"]["intent"] == "non_stem_redirect"


def test_chat_requires_session_id():
    assert client.post("/api/chat", json={"text": "hi"}).status_code == 400


def test_teacher_view_and_curiosity_jar():
    client.post("/api/session", json={"context": "class"})
    body = client.get("/api/teacher/sessions", params={"context": "class"}).json()
    assert body["ok"] and body["count"] >= 1
    assert body["sessions"][0]["learnerLabel"] == "Learner 1"
    jar = client.get("/api/curiosity-jar").json()
    assert jar["storageMode"] == "in-memory"


def test_photo_check_falls_back_without_key():
    sid = client.post("/api/session", json={}).json()["sessionId"]
    r = client.post("/api/photo-check", json={"sessionId": sid, "image": "data:image/png;base64,AAAA"}).json()
    assert r["ok"] and r["provider"] == "rule-based" and r["xpAwarded"] == 0


def test_admin_reload():
    r = client.post("/api/admin/reload").json()
    assert r["ok"] and r["charactersCount"] >= 12
