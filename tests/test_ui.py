"""Streamlit UI tests using Streamlit's headless AppTest runner."""

from pathlib import Path

from streamlit.testing.v1 import AppTest

APP = str(Path(__file__).resolve().parent.parent / "streamlit_app.py")


def _app() -> AppTest:
    at = AppTest.from_file(APP, default_timeout=30)
    at.run()
    assert not at.exception
    return at


def _click(at: AppTest, key: str) -> AppTest:
    at.button(key=key).click().run()
    assert not at.exception, at.exception
    return at


def _qr_keys(at: AppTest) -> list[str]:
    return [b.key for b in at.button if b.key and b.key.startswith("qr_")]


def _qr_by_label(at: AppTest, text: str) -> str:
    return next(b.key for b in at.button if b.key and b.key.startswith("qr_") and text in b.label)


def test_welcome_screen_before_start():
    at = _app()
    assert any("Welcome to BotzBuddy" in m.value for m in at.markdown)
    assert at.session_state.sid is None


def test_full_mission_through_the_ui():
    at = _app()
    at.selectbox(key="cfg_profile").set_value("L-01").run()
    _click(at, "start_btn")
    assert at.session_state.twin_state["currentCharacter"] == "petalo"
    assert at.session_state.twin_state["stage"] == "build"

    # Snap the virtual parts in -> build complete
    part_keys = [b.key for b in at.button if b.key and b.key.startswith("part_")]
    assert len(part_keys) >= 3
    for key in part_keys[:3]:
        _click(at, key)
    assert at.session_state.twin_state["stage"] == "experiment"

    _click(at, _qr_keys(at)[0])  # first observation
    assert at.session_state.twin_state["stage"] == "explain"

    at.chat_input(key="chat_input").set_value("Light bounces off things and reflects into our eyes").run()
    assert not at.exception
    assert at.session_state.twin_state["stage"] == "create"

    _click(at, _qr_keys(at)[0])  # pick a create choice
    assert at.session_state.twin_state["stage"] == "complete"
    assert any(m.get("type") == "challenge_card" for m in at.session_state.msgs)
    assert at.session_state.twin_state["xp"] >= 40


def test_stuck_button_and_robot_switch():
    at = _app()
    _click(at, "start_btn")
    _click(at, "act_stuck")
    assert at.session_state.twin_state["hintLevel"] == 1

    _click(at, "switch_tolly")
    assert at.session_state.twin_state["currentCharacter"] == "tolly"
    assert at.session_state.decision["intent"] == "switch_character"


def test_strict_classroom_mode_bridges_science_question():
    at = _app()
    at.radio(key="cfg_context").set_value("class").run()
    _click(at, "start_btn")
    at.chat_input(key="chat_input").set_value("Why is the sky blue?").run()
    assert at.session_state.decision["intent"] == "general_stem_strict_mode"


def test_explorer_start_chip_and_learning_twin_tab():
    at = _app()
    at.selectbox(key="cfg_profile").set_value("L-05").run()
    _click(at, "start_btn")
    _click(at, _qr_by_label(at, "Traffic signals"))
    assert at.session_state.twin_state["currentConcept"] == "led_sequence"
    assert at.session_state.twin_state["currentCharacter"] == "tolly"
    assert any(m.label == "Rank" for m in at.metric)


def test_kit_page_greets_with_product_character():
    at = _app()
    at.radio(key="cfg_context").set_value("kit").run()
    at.selectbox(key="cfg_product").set_value("tiko-scorpio").run()
    _click(at, "start_btn")
    assert at.session_state.twin_state["currentCharacter"] == "tiko"
