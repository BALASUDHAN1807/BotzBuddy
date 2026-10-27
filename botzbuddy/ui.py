"""BotzBuddy Streamlit app: Learn chat, Learning Twin dashboard and Teacher View.

Run with:  streamlit run streamlit_app.py
"""

from __future__ import annotations

import asyncio
import base64
import html
from typing import Any

import streamlit as st

from . import service
from .brain import get_persistent_quick_replies
from .config import has_key
from .registry import (
    data_fingerprint,
    get_all_characters,
    get_all_concepts,
    get_all_profiles,
    get_character,
    get_concept,
    reload_all,
)
from .storage import get_curiosity_jar_summary
from .twin import RANKS

USER_AVATAR = "🧒"
CONTEXTS = {
    "home": "🏠 Learning platform (home)",
    "kit": "🛍️ Kit store (product page)",
    "class": "🏫 Classroom",
    "workshop": "🛠️ School workshop",
}
INTERESTS = ["light", "colour", "robotics", "motors", "movement", "machines", "circuits", "signals", "animals", "space", "stories"]
KNOWLEDGE = {"new": "🌱 I'm new to this", "basics": "🔧 I know the basics", "challenge": "🚀 Give me a challenge"}
STAGES = [("build", "🔨 Build"), ("experiment", "🧪 Experiment"), ("observe", "👀 Observe"), ("explain", "💡 Explain"), ("create", "🎨 Create")]
STAGE_POSITION = {"build": 0, "experiment": 1, "explain": 3, "create": 4, "complete": 5}
STATUS_LABEL = {
    "verified": "✅ Verified STEM lessons",
    "behaviour_only": "🎭 Behaviour only",
    "awaiting_concept_sheet": "⏳ Lessons coming soon",
}
PART_ICONS = (("battery", "🔋"), ("wire", "⚡"), ("foil", "⚡"), ("motor", "⚙️"), ("led", "💡"))

_last_fingerprint: tuple | None = None


# ---------------------------------------------------------------- helpers
def run(coro):
    return asyncio.run(coro)


def maybe_hot_reload() -> None:
    """Reload data/ JSON if it changed since the last rerun (cheap mtime check)."""
    global _last_fingerprint
    fp = data_fingerprint()
    if _last_fingerprint is not None and fp != _last_fingerprint:
        reload_all()
    _last_fingerprint = fp


def ss() -> Any:
    return st.session_state


def init_state() -> None:
    defaults = {
        "sid": None,
        "msgs": [],
        "qrs": [],
        "twin_state": None,
        "decision": None,
        "parts": {},
        "celebrate": False,
        "general_stem": True,
        "msg_serial": 0,
    }
    for key, value in defaults.items():
        ss().setdefault(key, value)


def char_of(char_id: str | None) -> dict:
    return get_character(char_id) or get_character("wavy") or {"id": "wavy", "name": "Wavy", "emoji": "👋", "color": "#FFB13B"}


def part_icon(part: str) -> str:
    p = part.lower()
    return next((icon for key, icon in PART_ICONS if key in p), "🧩")


# ----------------------------------------------------------- engine calls
def _absorb(result: dict) -> None:
    ss().msgs.extend(result.get("messages") or [])
    ss().qrs = result.get("quickReplies") or []
    ss().twin_state = result.get("state")
    ss().decision = result.get("decision")
    if any(m.get("type") == "celebration" for m in result.get("messages") or []):
        ss().celebrate = True
    ss().msg_serial += 1


def start_session(params: dict) -> None:
    ss().msgs, ss().parts, ss().qrs = [], {}, []
    ss().general_stem = params.get("general_stem", True)
    result = run(service.create_session(**params))
    ss().sid = result["sessionId"]
    _absorb(result)


def send(text: str = "", action: dict | None = None) -> None:
    if not ss().sid:
        return
    if text:
        ss().msgs.append({"type": "text", "character": "user", "text": text})
    _absorb(run(service.chat(ss().sid, text, action, ss().general_stem)))


def on_quick_reply(qr: dict) -> None:
    send(qr.get("label", ""), qr)


def on_part(msg_idx: int, part: str, all_parts: list[str]) -> None:
    chosen = ss().parts.setdefault(msg_idx, [])
    if part not in chosen:
        chosen.append(part)
    if len(chosen) >= min(3, len(all_parts)):
        send("I've connected all the parts!", {"type": "build", "value": "build_done"})


def on_switch_character(char_id: str) -> None:
    send(f"Learn with {char_of(char_id)['name']}", {"type": "select_character", "characterId": char_id})


# ------------------------------------------------------------ printable card
def challenge_card_html(d: dict) -> str:
    e = html.escape
    steps = "".join(f"<li>{e(s)}</li>" for s in d.get("steps") or [])
    return f"""<!doctype html><html><head><meta charset="utf-8"><title>{e(d.get('characterName', ''))} Challenge Card</title>
<style>@page {{ size: A6; margin: 8mm; }} body {{ font-family: Arial, sans-serif; color: #1F2937; }}
.card {{ border: 3px dashed #F59E0B; border-radius: 14px; padding: 14px; }} h1 {{ font-size: 18px; margin: 0 0 6px; }}
.badge {{ float: right; font-size: 28px; }} .tip {{ background: #FEF3C7; padding: 6px 8px; border-radius: 8px; font-size: 12px; }}
footer {{ font-size: 10px; color: #6B7280; margin-top: 10px; }}</style></head>
<body onload="window.print()"><div class="card"><span class="badge">{e(d.get('badge', '🏅'))}</span>
<h1>{e(d.get('characterEmoji', '🤖'))} {e(d.get('characterName', ''))} STEM Challenge</h1>
<p><b>Concept:</b> {e(d.get('conceptName', ''))}<br><b>Project:</b> {e(d.get('choice', ''))}</p>
<ol>{steps}</ol><p class="tip">⚠️ {e(d.get('safetyTip', ''))}</p><footer>{e(d.get('footer', ''))}</footer></div></body></html>"""


# --------------------------------------------------------------- sidebar
def render_sidebar() -> None:
    sb = st.sidebar
    sb.title("🤖 BotzBuddy")
    sb.caption("The adaptive Funobotz STEM companion for ages 6–14")

    profiles = {p["id"]: p for p in get_all_profiles()}
    choice = sb.selectbox(
        "Learner profile",
        ["custom", *profiles],
        format_func=lambda pid: "✏️ Custom learner" if pid == "custom" else f"{pid} · {profiles[pid].get('description', '')}",
        key="cfg_profile",
    )
    custom = choice == "custom"

    context = sb.radio("Where is BotzBuddy?", list(CONTEXTS), format_func=CONTEXTS.get, key="cfg_context")
    product = None
    if context == "kit":
        kits = [c for c in get_all_characters() if c.get("productSlug")]
        product = sb.selectbox(
            "Kit page being viewed",
            [c["productSlug"] for c in kits],
            format_func=lambda slug: next(f"{c['emoji']} {c['name']}" for c in kits if c["productSlug"] == slug),
            key="cfg_product",
        )

    with sb.expander("🧒 About the learner", expanded=custom):
        age = st.slider("Age", 6, 14, 9, key="cfg_age", disabled=not custom)
        interests = st.multiselect("Interests", INTERESTS, default=["light"], key="cfg_interests", disabled=not custom)
        knowledge = st.radio("Experience", list(KNOWLEDGE), format_func=KNOWLEDGE.get, key="cfg_knowledge", disabled=not custom)
        language = st.radio("Language", ["en", "ta"], format_func={"en": "English", "ta": "தமிழ் Tamil"}.get, horizontal=True, key="cfg_lang", disabled=not custom)
        short_mode = st.toggle("Short answers", key="cfg_short", disabled=not custom)
        wants_depth = st.toggle("Deeper explanations", key="cfg_depth", disabled=not custom)
        explorer = st.toggle("Explorer mode (open discovery)", key="cfg_explorer", disabled=not custom)

    general_stem = sb.toggle(
        "Answer general science questions",
        value=context not in ("class", "workshop"),
        key=f"cfg_stem_{context}",
        help="Off = strict curriculum mode: science questions are saved to the Curiosity Jar and bridged back to today's lesson.",
    )

    if sb.button("🚀 Start learning mission", type="primary", width="stretch", key="start_btn"):
        params: dict[str, Any] = {"context": context, "product_slug": product, "general_stem": general_stem}
        if custom:
            params.update(
                age=age,
                interests=interests or ["general"],
                knowledge=knowledge,
                language=language,
                short_mode=short_mode,
                wants_depth=wants_depth,
                explorer=explorer,
            )
        else:
            params["profile_id"] = choice
        start_session(params)
        st.rerun()

    if ss().sid:
        ss().general_stem = general_stem

    sb.divider()
    keys = [n for n, k in (("OpenAI", "OPENAI_API_KEY"), ("Gemini", "GEMINI_API_KEY"), ("Groq", "GROQ_API_KEY")) if has_key(k)]
    sb.caption(f"🧠 AI providers: {', '.join(keys)}" if keys else "🧠 AI providers: none — running rule-based (add keys in .env)")


# ------------------------------------------------------------- learn tab
def render_header() -> None:
    s = ss().twin_state or {}
    char = char_of(s.get("currentCharacter"))
    left, right = st.columns([3, 2])
    with left:
        st.markdown(f"### {char.get('emoji', '🤖')} {char.get('name', 'BotzBuddy')}")
        st.caption(STATUS_LABEL.get(char.get("status", ""), "") + (f" · {char.get('role', '').title()}" if char.get("role") else ""))
    with right:
        if s:
            st.markdown(f"**{s.get('rankEmoji', '🌱')} {s.get('rank', 'Explorer')}** · {s.get('xp', 0)} XP")
            st.progress(min(1.0, (s.get("xp", 0) or 0) / 200))

    pos = STAGE_POSITION.get(s.get("stage", ""), -1)
    if pos >= 0:
        parts = []
        for i, (_, label) in enumerate(STAGES):
            if i < pos:
                parts.append(f"✅ {label}")
            elif i == pos:
                parts.append(f"**👉 {label}**")
            else:
                parts.append(label)
        st.markdown(" → ".join(parts))


def render_message(i: int, m: dict, is_latest_build: bool) -> None:
    if m.get("character") == "user":
        with st.chat_message("user", avatar=USER_AVATAR):
            st.markdown(m.get("text", ""))
        return

    char = char_of(m.get("character"))
    kind = m.get("type", "text")
    data = m.get("data") or {}
    with st.chat_message("assistant", avatar=char.get("emoji", "🤖")):
        st.caption(char.get("name", "BotzBuddy"))

        if kind == "handoff":
            st.info(f"🔄 {m.get('text', '')}")
        elif kind == "general_stem":
            st.caption("🔬 General science — not a Funobotz lesson yet")
            st.markdown(m.get("text", ""))
            if data.get("safetyTip"):
                st.warning(f"**Safety tip:** {data['safetyTip']}", icon="⚠️")
            if data.get("keyTerms"):
                st.markdown(" ".join(f"`{t}`" for t in data["keyTerms"]))
        elif kind == "challenge_card":
            st.markdown(m.get("text", ""))
            with st.container(border=True):
                st.markdown(f"#### {data.get('characterEmoji', '🤖')} {data.get('characterName', '')} Challenge {data.get('badge', '🏅')}")
                st.markdown(f"**Project:** {data.get('choice', '')}")
                st.markdown("  \n".join(data.get("steps") or []))
                st.warning(data.get("safetyTip", ""), icon="⚠️")
                st.download_button(
                    "🖨️ Download printable card",
                    challenge_card_html(data),
                    file_name=f"{data.get('characterName', 'botzbuddy').lower()}-challenge-card.html",
                    mime="text/html",
                    key=f"card_{i}",
                )
        elif kind == "kit":
            st.markdown(m.get("text", ""))
            st.link_button(f"🛒 Get the {data.get('characterName', '')} kit", data.get("kitUrl", "https://store.funobotz.com"))
        elif kind == "teacher":
            st.success(m.get("text", ""), icon="👩‍🏫")
        elif kind == "celebration":
            st.success(m.get("text", ""))
        elif kind == "teamup":
            st.markdown(f"## {data.get('char1', {}).get('emoji', '')} 🤝 {data.get('char2', {}).get('emoji', '')}")
            st.markdown(m.get("text", ""))
        else:
            st.markdown(m.get("text", ""))

        if kind == "build" and data.get("parts") and is_latest_build:
            parts = data["parts"]
            chosen = ss().parts.get(i, [])
            st.caption("🛠️ Tap the parts in order to snap them into your paper robot:")
            cols = st.columns(len(parts))
            for col, part in zip(cols, parts):
                done = part in chosen
                col.button(
                    f"{'✅' if done else part_icon(part)} {part}",
                    key=f"part_{i}_{part}",
                    disabled=done,
                    width="stretch",
                    on_click=on_part,
                    args=(i, part, parts),
                )


def render_quick_replies() -> None:
    # The always-visible action buttons already cover the engine's persistent replies.
    persistent = {(q["label"], q["value"]) for q in get_persistent_quick_replies()}
    qrs = [q for q in ss().qrs if (q.get("label"), q.get("value")) not in persistent]
    if not qrs:
        return
    serial = ss().msg_serial
    per_row = 2
    for start in range(0, len(qrs), per_row):
        cols = st.columns(per_row)
        for col, (idx, qr) in zip(cols, list(enumerate(qrs))[start : start + per_row]):
            col.button(
                qr.get("label", "…"),
                key=f"qr_{serial}_{idx}",
                width="stretch",
                on_click=on_quick_reply,
                args=(qr,),
            )


def render_tools() -> None:
    c1, c2, c3, c4 = st.columns([1, 1, 1, 1])
    for col, qr in zip((c1, c2, c3), get_persistent_quick_replies()):
        col.button(qr["label"], key=f"act_{qr['value']}", width="stretch", on_click=on_quick_reply, args=(qr,))

    with c4.popover("🤖 Meet the robots", width="stretch"):
        for status in ("verified", "behaviour_only", "awaiting_concept_sheet"):
            chars = [c for c in get_all_characters() if c.get("status") == status]
            if not chars:
                continue
            st.caption(STATUS_LABEL[status])
            cols = st.columns(3)
            for j, c in enumerate(chars):
                cols[j % 3].button(
                    f"{c['emoji']} {c['name']}",
                    key=f"switch_{c['id']}",
                    width="stretch",
                    on_click=on_switch_character,
                    args=(c["id"],),
                )

    with st.expander("📷 Photo check of my paper build"):
        photo = st.file_uploader("Upload a photo of your build", type=["png", "jpg", "jpeg", "webp"], key="photo")
        if photo is not None and st.button("Check my build", key="photo_btn"):
            data_url = f"data:{photo.type};base64,{base64.b64encode(photo.getvalue()).decode()}"
            result = run(service.photo_check(ss().sid, data_url))
            ss().msgs.append({"type": "text", "character": result["character"]["id"], "text": f"📷 {result['feedback']}"})
            ss().twin_state = result["state"]
            st.rerun()


def render_welcome() -> None:
    st.markdown("## 👋 Welcome to BotzBuddy!")
    st.markdown(
        "BotzBuddy is a STEM companion for Funobotz paper robotics. It adapts every lesson to the child: "
        "**Build → Experiment → Observe → Explain → Create**."
    )
    verified = [c for c in get_all_characters() if c.get("status") == "verified"]
    cols = st.columns(len(verified) or 1)
    for col, c in zip(cols, verified):
        with col.container(border=True):
            st.markdown(f"### {c['emoji']}\n**{c['name']}**")
            st.caption((c.get("facts") or [""])[0])
    st.info("Set up the learner in the sidebar, then press **🚀 Start learning mission**.", icon="👈")


def render_learn_tab() -> None:
    if not ss().sid:
        render_welcome()
        return

    render_header()
    if ss().celebrate:
        st.balloons()
        ss().celebrate = False

    msgs = ss().msgs
    latest_build = max((i for i, m in enumerate(msgs) if m.get("type") == "build"), default=-1)
    stage = (ss().twin_state or {}).get("stage")
    for i, m in enumerate(msgs):
        render_message(i, m, is_latest_build=(i == latest_build and stage == "build"))

    render_quick_replies()
    st.divider()
    render_tools()

    prompt = st.chat_input("Ask a question or teach back in your own words…", key="chat_input")
    if prompt:
        send(prompt)
        st.rerun()


# ------------------------------------------------------- learning twin tab
def render_twin_tab() -> None:
    s = ss().twin_state
    if not s:
        st.info("Start a learning mission to see the Learning Twin.", icon="🧬")
        return

    c = st.columns(5)
    c[0].metric("Rank", f"{s['rankEmoji']} {s['rank']}")
    c[1].metric("XP", s["xp"])
    c[2].metric("Age band", f"{s['age']} · {s['ageBand']}")
    c[3].metric("Stage", s["stage"])
    c[4].metric("Memory boosts", s["memoryBoostsCount"])

    st.markdown("#### 🏆 Learning journey")
    rank_idx = next((i for i, r in enumerate(RANKS) if r["name"] == s["rank"]), 0)
    cols = st.columns(len(RANKS))
    for i, (col, r) in enumerate(zip(cols, RANKS)):
        label = f"{r['emoji']} **{r['name']}**" if i <= rank_idx else f"{r['emoji']} {r['name']}"
        col.markdown(f"{label}  \n{r['minXp']} XP")
    st.progress(min(1.0, s["xp"] / 200))

    st.markdown("#### 📡 Five learning signals")
    sig = s["signals"]
    cols = st.columns(5)
    for col, (key, label) in zip(cols, (("say", "🗣️ Say"), ("choose", "👆 Choose"), ("build", "🔨 Build"), ("explain", "💡 Explain"), ("confidence", "🎯 Confidence"))):
        col.metric(label, sig.get(key, 0))

    st.markdown("#### 📊 Concept mastery")
    for concept in get_all_concepts():
        val = s["mastery"].get(concept["id"], 0)
        tier = "Ready 🚀" if val > 75 else "Developing" if val >= 40 else "Foundation"
        st.progress(val / 100, text=f"{concept['name']} — {val}% ({tier})")

    left, right = st.columns(2)
    with left:
        st.markdown("#### 🔭 Curiosity domains")
        if s["curiosityDomains"]:
            st.bar_chart(s["curiosityDomains"], horizontal=True)
        else:
            st.caption("No general science questions asked yet.")
        st.markdown("#### 🎯 Confidence")
        if s["conceptConfidence"]:
            for cid, level in s["conceptConfidence"].items():
                st.markdown(f"- `{cid}`: {level}")
        else:
            st.caption("No confidence answers yet.")
    with right:
        st.markdown("#### 🤔 Misconceptions found")
        if s["misconceptions"]:
            for mc in s["misconceptions"]:
                st.markdown(f"- **{mc['conceptId']}** — {mc['fixText']}")
        else:
            st.caption("None so far.")

    st.markdown("#### 🧠 Why BotzBuddy did what it did")
    rows = [
        {k: d.get(k) for k in ("intent", "concept", "character", "level", "reason", "provider")}
        for d in s["recentDecisions"]
    ]
    st.dataframe(rows, width="stretch", hide_index=True)


# ---------------------------------------------------------- teacher tab
@st.fragment(run_every=5)
def render_teacher_monitor(context: str) -> None:
    rows = service.teacher_sessions(context)
    needs = sum(1 for r in rows if r["needsHelp"])
    c = st.columns(3)
    c[0].metric("Active learners", len(rows))
    c[1].metric("Need help", needs)
    c[2].metric("Avg. mastery", f"{round(sum(r['mastery'] for r in rows) / len(rows)) if rows else 0}%")

    if rows:
        table = [
            {
                "Learner": r["learnerLabel"],
                "Concept": (get_concept(r["currentConcept"]) or {}).get("name", r["currentConcept"] or "—"),
                "Robot": f"{char_of(r['currentCharacter']).get('emoji', '')} {char_of(r['currentCharacter']).get('name', '')}",
                "Mastery": r["mastery"],
                "Stage": r["stage"],
                "Rank": f"{r['rankEmoji']} {r['rank']}",
                "Misconceptions": r["misconceptionsCount"],
                "Status": "⚠️ Needs help" if r["needsHelp"] else "✅ On track",
                "Latest misconception": r["latestMisconception"] or "",
            }
            for r in rows
        ]
        st.dataframe(
            table,
            width="stretch",
            hide_index=True,
            column_config={"Mastery": st.column_config.ProgressColumn("Mastery", min_value=0, max_value=100, format="%d%%")},
        )
    else:
        st.caption("No learners in this context yet.")

    jar = get_curiosity_jar_summary()
    st.markdown(f"#### 🏺 Curiosity Jar — {jar['total']} questions")
    st.caption("Anonymous questions kids asked that aren't in the lessons yet. Personal details are removed.")
    if jar["topKeywords"]:
        st.markdown(" ".join(f"`{k['word']} ×{k['count']}`" for k in jar["topKeywords"]))
    if jar["recentQuestions"]:
        st.dataframe(
            [
                {"Question": q["question"], "Asked": q["characterAsked"], "Tier": q["tier"], "Domain": q["domain"], "Age band": q["ageBand"]}
                for q in jar["recentQuestions"]
            ],
            width="stretch",
            hide_index=True,
        )


def render_teacher_tab() -> None:
    st.markdown("### 👩‍🏫 Live classroom monitor")
    st.caption("Anonymised progress of every learner connected to this server. Refreshes every 5 seconds.")
    context = st.selectbox(
        "Show learners in",
        ["all", *CONTEXTS],
        format_func=lambda c: "🌐 All contexts" if c == "all" else CONTEXTS[c],
        key="teacher_ctx",
    )
    render_teacher_monitor(context)


# ------------------------------------------------------------------ main
def main() -> None:
    st.set_page_config(page_title="BotzBuddy", page_icon="🤖", layout="wide")
    maybe_hot_reload()
    service.cleanup_old_sessions()
    init_state()
    render_sidebar()

    learn, twin, teacher = st.tabs(["💬 Learn", "🧬 Learning Twin", "👩‍🏫 Teacher View"])
    with learn:
        render_learn_tab()
    with twin:
        render_twin_tab()
    with teacher:
        render_teacher_tab()
