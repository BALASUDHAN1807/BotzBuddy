/**
 * BotzBuddy — The Adaptive Funobotz STEM Companion Plugin
 * Professional "Paper Workshop" Design System with Shadow DOM Encapsulation.
 * Supports Website, Kit Store, Online Classes, and School Workshop portals.
 */
(function () {
  'use strict';

  // Prevent multiple initializations
  if (window.__BOTZBUDDY_INITIALIZED__) return;
  window.__BOTZBUDDY_INITIALIZED__ = true;

  // Extract config from script tag
  const scriptTag = document.currentScript || document.querySelector('script[src*="botzbuddy.js"]') || {};
  const config = {
    api: scriptTag.getAttribute?.('data-api') || window.location.origin,
    context: scriptTag.getAttribute?.('data-context') || 'home', // 'home' | 'kit' | 'class' | 'workshop'
    initialCharacter: scriptTag.getAttribute?.('data-character') || 'wavy',
    lang: scriptTag.getAttribute?.('data-lang') || 'en',
    theme: scriptTag.getAttribute?.('data-theme') || '#FFB13B',
    position: scriptTag.getAttribute?.('data-position') || 'right',
    generalStem: scriptTag.getAttribute?.('data-general-stem') || 'on',
    teacher: scriptTag.getAttribute?.('data-teacher') === 'true',
    demo: scriptTag.getAttribute?.('data-demo') === 'true'
  };

  // State
  let state = {
    isOpen: false,
    activeTab: 'chat', // 'chat' | 'twin' | 'teacher'
    context: config.context,
    soundEnabled: true,
    sessionId: null,
    currentCharacter: null,
    characters: [],
    concepts: [],
    profiles: [],
    messages: [],
    quickReplies: [],
    twinSummary: null,
    latestDecision: null,
    teacherSessions: [],
    curiosityJarData: null,
    isLoading: false,
    mood: 'happy', // 'happy' | 'thinking' | 'celebrating' | 'curious'
    selectedBuildParts: [],
    onboardingStep: 1, // 1: Age, 2: Interests, 3: Knowledge, 4: Mode & Lang
    onboardingData: {
      age: 9,
      interests: ['light'],
      knowledge: 'new',
      language: config.lang || 'en',
      shortMode: false,
      wantsDepth: false,
      explorer: false
    },
    showCharSwitcher: false,
    showTooltip: true,
    isListening: false
  };

  const eventListeners = new Map();
  let teacherPollInterval = null;
  let avatarBlinkInterval = null;

  function triggerEvent(name, data) {
    const list = eventListeners.get(name) || [];
    list.forEach(fn => {
      try { fn(data); } catch (e) { console.error(e); }
    });
    window.dispatchEvent(new CustomEvent(`botzbuddy:${name}`, { detail: data }));
  }

  // Create Container & Shadow DOM
  const hostElement = document.createElement('div');
  hostElement.id = 'botzbuddy-root';
  document.body.appendChild(hostElement);
  const shadow = hostElement.attachShadow({ mode: 'open' });

  // Inject Google Fonts into Host Head (Fonts must be loaded at document level)
  if (!document.querySelector('link[href*="Baloo+2"]')) {
    const fontLink = document.createElement('link');
    fontLink.rel = 'stylesheet';
    fontLink.href = 'https://fonts.googleapis.com/css2?family=Baloo+2:wght@600;700;800&family=Nunito:wght@400;600;700;800&display=swap';
    document.head.appendChild(fontLink);
  }

  // Shadow DOM Stylesheet
  const styleEl = document.createElement('style');
  styleEl.textContent = `
    :host {
      --bb-orange: #FFB13B;
      --bb-orange-deep: #E8890C;
      --bb-navy: #1E2A4A;
      --bb-navy-dark: #141B2E;
      --bb-ink: #3A4560;
      --bb-muted: #7A8399;
      --bb-paper: #FFFFFF;
      --bb-paper-2: #F6F8FB;
      --bb-paper-3: #EDF2F7;
      --bb-line: #E3E8F0;
      --bb-red: #E5484D;
      --bb-yellow: #F5B800;
      --bb-green: #2FA36B;
      --bb-accent: var(--bb-orange);
      
      --bb-radius-panel: 18px;
      --bb-radius-card: 14px;
      --bb-radius-btn: 12px;
      --bb-radius-chip: 999px;
      
      --bb-shadow-paper: 0 1px 0 rgba(30,42,74,.06), 0 6px 16px rgba(30,42,74,.08);
      --bb-shadow-float: 0 12px 32px rgba(30,42,74,.15), 0 4px 12px rgba(30,42,74,.08);
      --bb-shadow-launcher: 0 8px 24px rgba(255, 140, 0, 0.35), 0 3px 8px rgba(0,0,0,0.1);
      
      --bb-font-display: 'Baloo 2', cursive, sans-serif;
      --bb-font-body: 'Nunito', system-ui, -apple-system, sans-serif;
      
      all: initial;
      font-family: var(--bb-font-body);
      color: var(--bb-ink);
      box-sizing: border-box;
      z-index: 999999;
      position: fixed;
      ${config.position === 'left' ? 'left: 20px;' : 'right: 20px;'}
      bottom: 20px;
    }

    *, *::before, *::after {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      font-family: inherit;
      -webkit-font-smoothing: antialiased;
    }

    /* ---------------------------------------------------------
       Keyframe Animations & Moods
       --------------------------------------------------------- */
    @keyframes bb-idle-bob {
      0%, 100% { transform: translateY(0); }
      50% { transform: translateY(-5px); }
    }
    @keyframes bb-pop-in {
      0% { opacity: 0; transform: scale(0.92) translateY(16px); }
      100% { opacity: 1; transform: scale(1) translateY(0); }
    }
    @keyframes bb-fade-rise {
      0% { opacity: 0; transform: translateY(6px); }
      100% { opacity: 1; transform: translateY(0); }
    }
    @keyframes bb-pulse-soft {
      0%, 100% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.08); opacity: 0.85; }
    }
    @keyframes bb-dot-bounce {
      0%, 80%, 100% { transform: translateY(0); }
      40% { transform: translateY(-6px); }
    }
    @keyframes bb-shake-soft {
      0%, 100% { transform: translateX(0); }
      20%, 60% { transform: translateX(-4px); }
      40%, 80% { transform: translateX(4px); }
    }
    @keyframes bb-wiggle {
      0%, 100% { transform: rotate(0deg); }
      25% { transform: rotate(-6deg); }
      75% { transform: rotate(6deg); }
    }
    @keyframes bb-avatar-blink {
      0%, 90%, 100% { transform: scaleY(1); }
      95% { transform: scaleY(0.1); }
    }

    /* ---------------------------------------------------------
       Launcher Bubble & Tooltip
       --------------------------------------------------------- */
    .bb-launcher-wrap {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: ${config.position === 'left' ? 'flex-start' : 'flex-end'};
    }

    .bb-tooltip {
      position: absolute;
      bottom: 74px;
      ${config.position === 'left' ? 'left: 0;' : 'right: 0;'}
      background: var(--bb-navy);
      color: #FFFFFF;
      font-size: 13px;
      font-weight: 700;
      padding: 8px 14px;
      border-radius: 12px;
      white-space: nowrap;
      box-shadow: var(--bb-shadow-float);
      border: 1.5px solid rgba(255,255,255,0.15);
      animation: bb-fade-rise 0.3s ease;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      z-index: 10;
      transition: opacity 0.4s ease, transform 0.4s ease;
    }
    .bb-tooltip::after {
      content: '';
      position: absolute;
      bottom: -6px;
      ${config.position === 'left' ? 'left: 24px;' : 'right: 24px;'}
      width: 12px;
      height: 12px;
      background: var(--bb-navy);
      transform: rotate(45deg);
    }
    .bb-tooltip.hidden {
      opacity: 0;
      transform: translateY(8px);
      pointer-events: none;
    }

    .bb-launcher {
      width: 64px;
      height: 64px;
      border-radius: 50%;
      background: var(--bb-paper);
      border: 3.5px solid var(--bb-accent);
      box-shadow: var(--bb-shadow-launcher);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      position: relative;
      transition: all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
      animation: bb-idle-bob 3s ease-in-out infinite;
      touch-action: manipulation;
    }
    .bb-launcher:hover {
      transform: scale(1.08) rotate(3deg);
      box-shadow: 0 12px 28px rgba(255, 140, 0, 0.45);
    }
    .bb-launcher:active {
      transform: scale(0.96);
    }
    .bb-launcher-avatar {
      font-size: 32px;
      line-height: 1;
      filter: drop-shadow(0 2px 4px rgba(0,0,0,0.12));
    }
    .bb-launcher-badge {
      position: absolute;
      top: -2px;
      right: -2px;
      width: 20px;
      height: 20px;
      background: var(--bb-orange);
      color: #FFFFFF;
      border: 2px solid #FFFFFF;
      border-radius: 50%;
      font-size: 11px;
      font-weight: 800;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 2px 6px rgba(0,0,0,0.2);
    }

    /* ---------------------------------------------------------
       Panel Main Window
       --------------------------------------------------------- */
    .bb-panel {
      position: fixed;
      ${config.position === 'left' ? 'left: 20px;' : 'right: 20px;'}
      bottom: 92px;
      width: 400px;
      height: min(680px, 85vh);
      max-width: calc(100vw - 32px);
      max-height: calc(100vh - 110px);
      background: var(--bb-paper);
      border-radius: var(--bb-radius-panel);
      box-shadow: var(--bb-shadow-float);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border: 2px solid var(--bb-line);
      opacity: 0;
      transform: scale(0.92) translateY(16px);
      pointer-events: none;
      transition: opacity 0.22s ease-out, transform 0.22s cubic-bezier(0.34, 1.4, 0.64, 1);
      z-index: 999999;
    }
    .bb-panel.open {
      opacity: 1;
      transform: scale(1) translateY(0);
      pointer-events: auto;
    }

    /* Mobile Sheet Drag Handle */
    .bb-drag-handle-bar {
      display: none;
      width: 100%;
      height: 16px;
      background: var(--bb-navy);
      align-items: center;
      justify-content: center;
      cursor: grab;
      flex-shrink: 0;
    }
    .bb-drag-handle-pill {
      width: 36px;
      height: 4px;
      background: rgba(255,255,255,0.3);
      border-radius: 2px;
    }

    /* ---------------------------------------------------------
       Header (Navy)
       --------------------------------------------------------- */
    .bb-header {
      background: var(--bb-navy);
      color: #FFFFFF;
      padding: 12px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
      border-bottom: 1px solid rgba(255,255,255,0.1);
    }
    .bb-header-left {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .bb-header-avatar-wrap {
      width: 42px;
      height: 42px;
      border-radius: 50%;
      background: #FFFFFF;
      border: 2.5px solid var(--bb-accent);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 22px;
      box-shadow: 0 2px 6px rgba(0,0,0,0.2);
      flex-shrink: 0;
      transition: transform 0.2s;
    }
    .bb-header-avatar-wrap.mood-happy { animation: bb-wiggle 1.5s infinite ease-in-out; }
    .bb-header-avatar-wrap.mood-thinking { transform: rotate(12deg); }
    .bb-header-avatar-wrap.mood-celebrating { animation: bb-pulse-soft 0.8s infinite; }
    
    .bb-header-info h2 {
      font-family: var(--bb-font-display);
      font-size: 18px;
      font-weight: 700;
      line-height: 1.1;
      color: #FFFFFF;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .bb-status-pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 10.5px;
      font-weight: 700;
      padding: 2px 7px;
      border-radius: 8px;
      margin-top: 2px;
      letter-spacing: 0.2px;
    }
    .bb-status-pill.verified {
      background: rgba(47, 163, 107, 0.2);
      color: #4ADE80;
      border: 1px solid rgba(74, 222, 128, 0.3);
    }
    .bb-status-pill.behaviour {
      background: rgba(245, 184, 0, 0.2);
      color: #FDE047;
      border: 1px solid rgba(253, 224, 71, 0.3);
    }
    .bb-status-pill.coming {
      background: rgba(255, 255, 255, 0.15);
      color: #CBD5E1;
      border: 1px solid rgba(255, 255, 255, 0.2);
    }

    .bb-header-actions {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .bb-icon-btn {
      width: 32px;
      height: 32px;
      border-radius: 8px;
      background: rgba(255,255,255,0.1);
      border: none;
      color: #FFFFFF;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-size: 14px;
      transition: background 0.2s, transform 0.15s;
    }
    .bb-icon-btn:hover {
      background: rgba(255,255,255,0.2);
      transform: scale(1.05);
    }
    .bb-icon-btn:focus-visible {
      outline: 2.5px solid var(--bb-orange);
    }

    /* ---------------------------------------------------------
       Navigation Tabs with Sliding Underline
       --------------------------------------------------------- */
    .bb-tabs-wrap {
      background: #FFFFFF;
      border-bottom: 1.5px solid var(--bb-line);
      position: relative;
      display: flex;
      flex-shrink: 0;
    }
    .bb-tab {
      flex: 1;
      text-align: center;
      padding: 10px 6px;
      font-size: 13.5px;
      font-weight: 700;
      color: var(--bb-muted);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      transition: color 0.2s ease;
      user-select: none;
    }
    .bb-tab.active {
      color: var(--bb-navy);
      font-weight: 800;
    }
    .bb-tabs-indicator {
      position: absolute;
      bottom: -1.5px;
      left: 0;
      height: 3px;
      width: 50%;
      background: var(--bb-orange);
      border-radius: 3px 3px 0 0;
      transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1), width 0.25s ease;
    }

    /* ---------------------------------------------------------
       Scrollable Body
       --------------------------------------------------------- */
    .bb-body {
      flex: 1;
      background: var(--bb-paper-2);
      overflow-y: auto;
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      scroll-behavior: smooth;
    }
    .bb-body::-webkit-scrollbar {
      width: 6px;
    }
    .bb-body::-webkit-scrollbar-track {
      background: transparent;
    }
    .bb-body::-webkit-scrollbar-thumb {
      background: #CBD5E1;
      border-radius: 3px;
    }

    /* ---------------------------------------------------------
       Mission Stage Tracker (5 Connected Steps)
       --------------------------------------------------------- */
    .bb-stage-tracker {
      background: var(--bb-paper);
      border: 1.5px solid var(--bb-line);
      border-radius: var(--bb-radius-card);
      padding: 8px 10px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      box-shadow: var(--bb-shadow-paper);
      margin-bottom: 4px;
    }
    .bb-stage-node {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 2px;
      flex: 1;
      position: relative;
    }
    .bb-stage-node:not(:last-child)::after {
      content: '';
      position: absolute;
      top: 13px;
      left: 55%;
      width: 90%;
      height: 2px;
      background: var(--bb-line);
      z-index: 1;
    }
    .bb-stage-node.completed:not(:last-child)::after {
      background: var(--bb-orange);
    }
    .bb-stage-icon {
      width: 26px;
      height: 26px;
      border-radius: 50%;
      background: var(--bb-paper-3);
      border: 2px solid var(--bb-line);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 11px;
      z-index: 2;
      transition: all 0.25s ease;
    }
    .bb-stage-node.active .bb-stage-icon {
      background: var(--bb-orange);
      border-color: #FFFFFF;
      color: #FFFFFF;
      box-shadow: 0 0 0 3px rgba(255, 177, 59, 0.35);
      animation: bb-pulse-soft 1.8s infinite ease-in-out;
    }
    .bb-stage-node.completed .bb-stage-icon {
      background: var(--bb-orange);
      border-color: var(--bb-orange);
      color: #FFFFFF;
    }
    .bb-stage-label {
      font-size: 10px;
      font-weight: 700;
      color: var(--bb-muted);
    }
    .bb-stage-node.active .bb-stage-label {
      color: var(--bb-navy);
      font-weight: 800;
    }

    /* ---------------------------------------------------------
       Chat Messages (Paper Workshop Cards)
       --------------------------------------------------------- */
    .bb-msg {
      display: flex;
      gap: 8px;
      max-width: 100%;
      animation: bb-fade-rise 0.2s ease;
    }
    .bb-msg-bot {
      align-self: flex-start;
    }
    .bb-msg-user {
      align-self: flex-end;
      flex-direction: row-reverse;
    }

    .bb-msg-avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: #FFFFFF;
      border: 2px solid var(--bb-accent);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      flex-shrink: 0;
      box-shadow: 0 1px 4px rgba(0,0,0,0.1);
      margin-top: 2px;
    }

    .bb-msg-content {
      max-width: 330px;
      background: var(--bb-paper);
      border: 1.5px solid var(--bb-line);
      border-left: 4.5px solid var(--bb-accent);
      border-radius: var(--bb-radius-card);
      padding: 11px 14px;
      box-shadow: var(--bb-shadow-paper);
      font-size: 15px;
      line-height: 1.5;
      color: var(--bb-ink);
      position: relative;
      word-break: break-word;
    }

    /* Folded corner detail on bot paper cards */
    .bb-msg-bot .bb-msg-content::after {
      content: '';
      position: absolute;
      top: 0;
      right: 0;
      width: 0;
      height: 0;
      border-style: solid;
      border-width: 0 10px 10px 0;
      border-color: transparent #E2E8F0 transparent transparent;
    }

    .bb-msg-user .bb-msg-content {
      background: #FFF1DC;
      border: 1.5px solid #FCD38D;
      border-left: 1.5px solid #FCD38D;
      color: var(--bb-navy);
      font-weight: 600;
      border-top-right-radius: 4px;
    }

    .bb-msg-author {
      font-size: 11px;
      font-weight: 800;
      color: var(--bb-navy);
      margin-bottom: 4px;
      display: flex;
      align-items: center;
      gap: 4px;
    }

    /* Typing Dots Card */
    .bb-typing {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 4px 6px;
    }
    .bb-typing-dot {
      width: 7px;
      height: 7px;
      background: var(--bb-orange);
      border-radius: 50%;
      animation: bb-dot-bounce 1.2s infinite ease-in-out;
    }
    .bb-typing-dot:nth-child(2) { animation-delay: 0.2s; }
    .bb-typing-dot:nth-child(3) { animation-delay: 0.4s; }

    /* ---------------------------------------------------------
       Special Cards (General Science, Team-Up, Challenge, Kit)
       --------------------------------------------------------- */
    /* Tier 2 General Science Card */
    .bb-general-card {
      background: #F0F9FF;
      border: 1.5px solid #BAE6FD;
      border-left: 4.5px solid #0284C7;
      border-radius: var(--bb-radius-card);
      padding: 12px 14px;
      margin-top: 4px;
      position: relative;
    }
    .bb-general-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: #E0F2FE;
      color: #0369A1;
      font-size: 10.5px;
      font-weight: 800;
      padding: 2px 8px;
      border-radius: 6px;
      margin-bottom: 6px;
      border: 1px solid #BAE6FD;
    }
    .bb-safety-tip {
      background: #FEF3C7;
      border-left: 3px solid var(--bb-yellow);
      padding: 6px 10px;
      border-radius: 6px;
      font-size: 11.5px;
      color: #92400E;
      margin-top: 8px;
      font-weight: 600;
    }
    .bb-key-terms {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-top: 6px;
    }
    .bb-term-tag {
      background: #FFFFFF;
      border: 1px solid #7DD3FC;
      color: #0284C7;
      font-size: 11px;
      font-weight: 700;
      padding: 1px 6px;
      border-radius: 6px;
    }

    /* Team-Up Card */
    .bb-teamup-card {
      background: #F0FDF4;
      border: 1.5px dashed #10B981;
      border-radius: var(--bb-radius-card);
      padding: 12px;
      margin-top: 6px;
      text-align: center;
    }
    .bb-teamup-duo {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      margin-bottom: 6px;
    }
    .bb-teamup-duo span {
      font-size: 28px;
    }

    /* Virtual Build Workbench */
    .bb-build-bench {
      background: #FFFFFF;
      border: 1.5px solid var(--bb-line);
      border-radius: var(--bb-radius-card);
      padding: 10px;
      margin-top: 6px;
    }
    .bb-build-bench-title {
      font-size: 11.5px;
      font-weight: 800;
      color: var(--bb-navy);
      margin-bottom: 6px;
    }
    .bb-parts-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(80px, 1fr));
      gap: 6px;
    }
    .bb-part-tile {
      background: var(--bb-paper-2);
      border: 1.5px dashed #94A3B8;
      border-radius: 10px;
      padding: 8px 6px;
      text-align: center;
      font-size: 12px;
      font-weight: 700;
      color: var(--bb-ink);
      cursor: pointer;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      transition: all 0.2s ease;
    }
    .bb-part-tile:hover {
      background: #FFFFFF;
      border-color: var(--bb-orange);
      transform: translateY(-2px);
    }
    .bb-part-tile.snapped {
      background: #DCFCE7;
      border: 1.5px solid #22C55E;
      color: #15803D;
    }

    /* Observe / Check MCQ Options */
    .bb-option-btn {
      width: 100%;
      background: #FFFFFF;
      border: 1.5px solid var(--bb-line);
      border-radius: var(--bb-radius-btn);
      padding: 9px 12px;
      margin-top: 6px;
      text-align: left;
      font-size: 13.5px;
      font-weight: 700;
      color: var(--bb-ink);
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
      box-shadow: 0 1px 2px rgba(0,0,0,0.03);
      transition: all 0.15s ease;
    }
    .bb-option-btn:hover {
      border-color: var(--bb-orange);
      background: #FFFDF9;
      transform: translateX(2px);
    }
    .bb-option-badge {
      width: 22px;
      height: 22px;
      border-radius: 50%;
      background: var(--bb-paper-3);
      color: var(--bb-navy);
      font-size: 11px;
      font-weight: 800;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    /* Confidence Meter */
    .bb-confidence-meter {
      background: #FFFFFF;
      border: 1.5px solid var(--bb-line);
      border-radius: var(--bb-radius-card);
      padding: 8px;
      margin-top: 6px;
      display: flex;
      gap: 6px;
    }
    .bb-conf-btn {
      flex: 1;
      background: var(--bb-paper-2);
      border: 1px solid var(--bb-line);
      border-radius: 10px;
      padding: 6px 4px;
      font-size: 11.5px;
      font-weight: 700;
      color: var(--bb-ink);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      transition: all 0.15s;
    }
    .bb-conf-btn:hover {
      background: #FFFDF9;
      border-color: var(--bb-orange);
    }

    /* Printable STEM Challenge Card */
    .bb-challenge-card {
      background: #FFFDF9;
      border: 2px dashed #D97706;
      border-radius: var(--bb-radius-card);
      padding: 12px;
      margin-top: 6px;
      position: relative;
    }
    .bb-challenge-card::after {
      content: '';
      position: absolute;
      top: 0;
      right: 0;
      width: 0;
      height: 0;
      border-style: solid;
      border-width: 0 12px 12px 0;
      border-color: transparent #F59E0B transparent transparent;
    }
    .bb-challenge-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1.5px solid #FDE68A;
      padding-bottom: 6px;
      margin-bottom: 8px;
    }
    .bb-challenge-head h4 {
      font-family: var(--bb-font-display);
      font-size: 14px;
      font-weight: 800;
      color: #92400E;
    }
    .bb-print-btn {
      width: 100%;
      margin-top: 8px;
      background: linear-gradient(135deg, #D97706, #B45309);
      color: #FFFFFF;
      border: none;
      border-radius: 10px;
      padding: 8px 12px;
      font-size: 12.5px;
      font-weight: 800;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      box-shadow: 0 2px 6px rgba(180, 83, 9, 0.2);
    }
    .bb-print-btn:hover {
      background: #92400E;
    }

    /* Quick Reply Chips */
    .bb-quick-row {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 4px;
    }
    .bb-quick-chip {
      background: #FFFFFF;
      border: 1.5px solid var(--bb-orange);
      color: var(--bb-navy);
      border-radius: var(--bb-radius-chip);
      padding: 6px 12px;
      font-size: 12.5px;
      font-weight: 700;
      cursor: pointer;
      box-shadow: 0 1px 3px rgba(255, 177, 59, 0.15);
      transition: all 0.15s ease;
    }
    .bb-quick-chip:hover {
      background: var(--bb-orange);
      color: #FFFFFF;
      transform: translateY(-1px);
    }

    /* ---------------------------------------------------------
       Action Row & Footer Input
       --------------------------------------------------------- */
    .bb-action-row {
      background: var(--bb-paper);
      border-top: 1px solid var(--bb-line);
      padding: 6px 12px;
      display: flex;
      gap: 6px;
      overflow-x: auto;
      flex-shrink: 0;
    }
    .bb-action-row::-webkit-scrollbar { display: none; }
    .bb-action-btn {
      background: var(--bb-paper-2);
      border: 1px solid var(--bb-line);
      border-radius: var(--bb-radius-chip);
      padding: 4px 10px;
      font-size: 11.5px;
      font-weight: 700;
      color: var(--bb-ink);
      white-space: nowrap;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 4px;
      transition: all 0.15s;
    }
    .bb-action-btn:hover {
      border-color: var(--bb-orange);
      color: var(--bb-navy);
      background: #FFFFFF;
    }

    .bb-footer {
      background: var(--bb-paper);
      border-top: 1px solid var(--bb-line);
      padding: 10px 14px;
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }
    .bb-input {
      flex: 1;
      height: 42px;
      background: var(--bb-paper-2);
      border: 1.5px solid var(--bb-line);
      border-radius: 21px;
      padding: 0 16px;
      font-size: 14px;
      color: var(--bb-ink);
      transition: all 0.2s ease;
    }
    .bb-input:focus {
      outline: none;
      border-color: var(--bb-orange);
      background: #FFFFFF;
      box-shadow: 0 0 0 3px rgba(255, 177, 59, 0.2);
    }
    .bb-tool-btn {
      width: 38px;
      height: 38px;
      border-radius: 50%;
      background: var(--bb-paper-2);
      border: 1.5px solid var(--bb-line);
      color: var(--bb-ink);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      cursor: pointer;
      transition: all 0.15s;
    }
    .bb-tool-btn:hover {
      border-color: var(--bb-orange);
      background: #FFFFFF;
      color: var(--bb-orange-deep);
    }
    .bb-tool-btn.listening {
      background: #FEE2E2;
      border-color: var(--bb-red);
      color: var(--bb-red);
      animation: bb-pulse-soft 1s infinite;
    }
    .bb-send-btn {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: var(--bb-orange);
      border: none;
      color: #FFFFFF;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 15px;
      cursor: pointer;
      box-shadow: 0 2px 8px rgba(255, 177, 59, 0.4);
      transition: transform 0.15s, background 0.15s;
    }
    .bb-send-btn:hover {
      background: var(--bb-orange-deep);
      transform: scale(1.06);
    }
    .bb-send-btn:active {
      transform: scale(0.95);
    }

    /* ---------------------------------------------------------
       Onboarding Multi-Step Wizard
       --------------------------------------------------------- */
    .bb-wizard-card {
      background: #FFFFFF;
      border: 1.5px solid var(--bb-line);
      border-radius: var(--bb-radius-panel);
      padding: 18px;
      box-shadow: var(--bb-shadow-paper);
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .bb-wizard-dots {
      display: flex;
      justify-content: center;
      gap: 6px;
    }
    .bb-wizard-dot {
      width: 24px;
      height: 4px;
      background: var(--bb-line);
      border-radius: 2px;
      transition: background 0.25s ease;
    }
    .bb-wizard-dot.active {
      background: var(--bb-orange);
    }
    .bb-wizard-title {
      font-family: var(--bb-font-display);
      font-size: 18px;
      font-weight: 700;
      color: var(--bb-navy);
      text-align: center;
    }
    .bb-tap-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
    }
    .bb-tap-card {
      background: var(--bb-paper-2);
      border: 2px solid var(--bb-line);
      border-radius: 12px;
      padding: 10px 6px;
      text-align: center;
      cursor: pointer;
      font-size: 12px;
      font-weight: 700;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      transition: all 0.2s;
    }
    .bb-tap-card:hover {
      border-color: var(--bb-orange);
      background: #FFFDF9;
      transform: translateY(-2px);
    }
    .bb-tap-card.selected {
      background: #FFF7EC;
      border-color: var(--bb-orange);
      color: var(--bb-navy);
      box-shadow: 0 0 0 1px var(--bb-orange);
    }
    .bb-tap-card-icon {
      font-size: 24px;
    }
    .bb-primary-btn {
      background: var(--bb-orange);
      color: #FFFFFF;
      border: none;
      border-radius: var(--bb-radius-btn);
      padding: 12px;
      font-family: var(--bb-font-display);
      font-size: 16px;
      font-weight: 700;
      cursor: pointer;
      box-shadow: 0 4px 12px rgba(255, 177, 59, 0.35);
      transition: all 0.15s;
    }
    .bb-primary-btn:hover {
      background: var(--bb-orange-deep);
      transform: translateY(-1px);
    }

    /* ---------------------------------------------------------
       Learning Twin & Dashboard View
       --------------------------------------------------------- */
    .bb-dashboard-grid {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .bb-dash-card {
      background: #FFFFFF;
      border: 1.5px solid var(--bb-line);
      border-radius: var(--bb-radius-card);
      padding: 14px;
      box-shadow: var(--bb-shadow-paper);
      position: relative;
    }
    .bb-dash-card-title {
      font-family: var(--bb-font-display);
      font-size: 15px;
      font-weight: 700;
      color: var(--bb-navy);
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .bb-rank-path {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin: 10px 0 6px 0;
    }
    .bb-rank-step {
      display: flex;
      flex-direction: column;
      align-items: center;
      font-size: 10.5px;
      color: var(--bb-muted);
      gap: 2px;
    }
    .bb-rank-step.active {
      color: var(--bb-navy);
      font-weight: 800;
    }
    .bb-rank-badge {
      width: 26px;
      height: 26px;
      border-radius: 50%;
      background: var(--bb-paper-3);
      border: 1.5px solid var(--bb-line);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
    }
    .bb-rank-step.active .bb-rank-badge {
      background: var(--bb-orange);
      border-color: var(--bb-orange);
      color: #FFFFFF;
      box-shadow: 0 0 0 3px rgba(255, 177, 59, 0.25);
    }
    .bb-progress-bar-bg {
      width: 100%;
      height: 8px;
      background: var(--bb-paper-3);
      border-radius: 4px;
      overflow: hidden;
      margin-top: 4px;
    }
    .bb-progress-bar-fill {
      height: 100%;
      background: linear-gradient(90deg, #FFB13B, #2FA36B);
      border-radius: 4px;
      transition: width 0.4s ease;
    }

    /* Mastery Rows */
    .bb-mastery-item {
      margin-bottom: 8px;
    }
    .bb-mastery-head {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      font-weight: 700;
      margin-bottom: 2px;
    }
    .bb-level-tag {
      font-size: 10px;
      padding: 1px 6px;
      border-radius: 6px;
      font-weight: 800;
    }
    .bb-level-tag.ready { background: #DCFCE7; color: #15803D; }
    .bb-level-tag.developing { background: #FEF3C7; color: #B45309; }
    .bb-level-tag.foundation { background: #FEE2E2; color: #B91C1C; }

    /* 5-Signal Grid */
    .bb-signals-grid {
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 6px;
    }
    .bb-signal-box {
      background: var(--bb-paper-2);
      border: 1px solid var(--bb-line);
      border-radius: 10px;
      padding: 6px 2px;
      text-align: center;
    }
    .bb-signal-val {
      font-family: var(--bb-font-display);
      font-size: 16px;
      font-weight: 800;
      color: var(--bb-navy);
    }
    .bb-signal-name {
      font-size: 9px;
      font-weight: 700;
      color: var(--bb-muted);
      text-transform: uppercase;
    }

    /* Structured Decision Rows */
    .bb-decision-table {
      width: 100%;
      font-size: 11.5px;
      line-height: 1.6;
    }
    .bb-decision-row {
      display: flex;
      border-bottom: 1px solid var(--bb-line);
      padding: 4px 0;
    }
    .bb-decision-row:last-child { border-bottom: none; }
    .bb-decision-key {
      width: 90px;
      font-weight: 700;
      color: var(--bb-muted);
    }
    .bb-decision-val {
      flex: 1;
      color: var(--bb-navy);
    }

    /* ---------------------------------------------------------
       Teacher View Tab
       --------------------------------------------------------- */
    .bb-teacher-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      margin-top: 6px;
    }
    .bb-teacher-table th {
      background: var(--bb-paper-2);
      text-align: left;
      padding: 6px 8px;
      color: var(--bb-muted);
      font-weight: 700;
      border-bottom: 1.5px solid var(--bb-line);
    }
    .bb-teacher-table td {
      padding: 8px;
      border-bottom: 1px solid var(--bb-line);
    }
    .bb-help-dot {
      display: inline-block;
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--bb-red);
      margin-right: 4px;
    }

    /* ---------------------------------------------------------
       Character Switcher Modal Sheet
       --------------------------------------------------------- */
    .bb-modal-sheet {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(30, 42, 74, 0.45);
      backdrop-filter: blur(2px);
      display: flex;
      flex-direction: column;
      justify-content: flex-end;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s ease;
      z-index: 100;
    }
    .bb-modal-sheet.open {
      opacity: 1;
      pointer-events: auto;
    }
    .bb-sheet-card {
      background: #FFFFFF;
      border-radius: 20px 20px 0 0;
      padding: 16px;
      max-height: 80%;
      overflow-y: auto;
      box-shadow: 0 -8px 24px rgba(0,0,0,0.15);
      transform: translateY(20px);
      transition: transform 0.25s cubic-bezier(0.34, 1.4, 0.64, 1);
    }
    .bb-modal-sheet.open .bb-sheet-card {
      transform: translateY(0);
    }
    .bb-chars-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;
      margin-top: 10px;
    }
    .bb-char-tile {
      background: var(--bb-paper-2);
      border: 1.5px solid var(--bb-line);
      border-radius: 12px;
      padding: 10px 4px;
      text-align: center;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      transition: all 0.2s;
    }
    .bb-char-tile:hover {
      border-color: var(--bb-orange);
      background: #FFFFFF;
      transform: translateY(-2px);
    }
    .bb-char-tile.unverified {
      opacity: 0.65;
    }

    /* ---------------------------------------------------------
       Responsive Mobile & Accessibility
       --------------------------------------------------------- */
    @media (max-width: 480px) {
      :host {
        right: 12px;
        bottom: 12px;
        left: 12px;
      }
      .bb-panel {
        right: 0 !important;
        left: 0 !important;
        bottom: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        max-width: 100vw !important;
        max-height: 100vh !important;
        border-radius: 0 !important;
        border: none !important;
      }
      .bb-drag-handle-bar {
        display: flex;
      }
      .bb-msg-content {
        font-size: 14.5px;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      *, .bb-launcher, .bb-header-avatar-wrap {
        animation: none !important;
        transition: none !important;
      }
    }
  `;
  shadow.appendChild(styleEl);

  // Main UI Wrapper
  const wrapper = document.createElement('div');
  wrapper.className = 'bb-wrapper';
  shadow.appendChild(wrapper);

  // Context-aware slug finder
  function getContextSlug() {
    const urlParams = new URLSearchParams(window.location.search);
    const prodParam = urlParams.get('product');
    if (prodParam) return prodParam;
    const path = window.location.pathname;
    if (path.includes('quacky-duck')) return 'quacky-duck';
    if (path.includes('petalo')) return 'petalo';
    if (path.includes('tollgate') || path.includes('tolly')) return 'tollgate';
    if (path.includes('tiko-scorpio') || path.includes('tiko')) return 'tiko-scorpio';
    return null;
  }

  // Voice synthesis helper
  function speak(text) {
    if (!state.soundEnabled || !window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel();
      const clean = text.replace(/[*_#`]/g, '');
      const utter = new SpeechSynthesisUtterance(clean);
      utter.rate = 1.0;
      utter.pitch = 1.1;
      window.speechSynthesis.speak(utter);
    } catch (e) {}
  }

  // Speech Recognition helper
  function toggleSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('Speech recognition is not supported in this browser.');
      return;
    }

    if (state.isListening) {
      state.recognition?.stop();
      state.isListening = false;
      render();
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.lang = state.onboardingData.language === 'ta' ? 'ta-IN' : 'en-US';
      recognition.interimResults = false;
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        state.isListening = true;
        render();
      };

      recognition.onresult = (e) => {
        const transcript = e.results[0][0].transcript;
        state.isListening = false;
        render();
        sendChat({ text: transcript });
      };

      recognition.onerror = () => {
        state.isListening = false;
        render();
      };

      recognition.onend = () => {
        state.isListening = false;
        render();
      };

      state.recognition = recognition;
      recognition.start();
    } catch (err) {
      state.isListening = false;
      render();
    }
  }

  // Fetch Initial Registry Data
  async function loadInitialData() {
    try {
      const [charsRes, conceptsRes, profilesRes] = await Promise.all([
        fetch(`${config.api}/api/characters`).then(r => r.json()).catch(() => []),
        fetch(`${config.api}/api/concepts`).then(r => r.json()).catch(() => []),
        fetch(`${config.api}/api/profiles`).then(r => r.json()).catch(() => [])
      ]);
      state.characters = charsRes || [];
      state.concepts = conceptsRes || [];
      state.profiles = profilesRes || [];

      // Check context slug
      const slug = getContextSlug();
      if (slug) {
        const found = state.characters.find(c => c.productSlug === slug || c.id === slug);
        if (found) {
          state.currentCharacter = found;
        }
      }
      render();
    } catch (err) {
      console.error('[BotzBuddy] Failed to load initial data:', err);
    }
  }

  // Fetch Teacher Sessions (for teacher view polling)
  async function fetchTeacherSessions() {
    if (!config.teacher) return;
    try {
      const res = await fetch(`${config.api}/api/teacher/sessions?context=${state.context}`);
      const data = await res.json();
      state.teacherSessions = data.sessions || [];
      if (state.activeTab === 'teacher') {
        render();
      }
    } catch (err) {}
  }

  // Fetch Curiosity Jar Insights
  async function fetchCuriosityJar() {
    try {
      const res = await fetch(`${config.api}/api/curiosity-jar`);
      const data = await res.json();
      state.curiosityJarData = data || null;
      if (state.activeTab === 'teacher') {
        render();
      }
    } catch (err) {}
  }

  // Session API Call
  async function startSession(params = {}) {
    state.isLoading = true;
    render();
    try {
      const slug = getContextSlug();
      const res = await fetch(`${config.api}/api/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context: state.context,
          generalStem: config.generalStem,
          ...state.onboardingData,
          ...params,
          productSlug: slug || params.productSlug
        })
      });
      const data = await res.json();
      state.sessionId = data.sessionId;
      state.messages = data.messages || [];
      state.quickReplies = data.quickReplies || [];
      state.twinSummary = data.state || null;
      state.latestDecision = data.decision || null;

      if (data.state?.currentCharacter) {
        state.currentCharacter = state.characters.find(c => c.id === data.state.currentCharacter) || state.currentCharacter;
      }

      state.isLoading = false;
      render();

      if (state.messages.length > 0) {
        speak(state.messages[0].text);
      }
    } catch (err) {
      state.isLoading = false;
      console.error('[BotzBuddy] Session start failed:', err);
      render();
    }
  }

  // Chat API Call
  async function sendChat({ text, action }) {
    if (!state.sessionId) return;
    if (text) {
      state.messages.push({
        type: 'text',
        character: 'user',
        text
      });
    }
    state.isLoading = true;
    state.mood = 'thinking';
    render();
    scrollToBottom();

    try {
      const res = await fetch(`${config.api}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: state.sessionId,
          text: text || '',
          action: action || null,
          generalStem: config.generalStem
        })
      });
      const data = await res.json();

      state.messages.push(...(data.messages || []));
      state.quickReplies = data.quickReplies || [];
      state.twinSummary = data.state || null;
      state.latestDecision = data.decision || null;
      state.mood = 'happy';

      if (data.state?.currentCharacter) {
        state.currentCharacter = state.characters.find(c => c.id === data.state.currentCharacter) || state.currentCharacter;
      }

      state.isLoading = false;
      render();
      scrollToBottom();

      // Check for celebration or rank up
      const celMsg = (data.messages || []).find(m => m.type === 'celebration');
      if (celMsg) {
        state.mood = 'celebrating';
      }

      // Check for kit card dispatch
      const kitMsg = (data.messages || []).find(m => m.type === 'kit');
      if (kitMsg && kitMsg.data) {
        triggerEvent('kit', kitMsg.data);
      }

      // Read aloud latest bot message
      const latestBotMsg = [...data.messages].reverse().find(m => m.character !== 'user' && m.type === 'text');
      if (latestBotMsg) {
        speak(latestBotMsg.text);
      }
    } catch (err) {
      state.isLoading = false;
      state.mood = 'happy';
      console.error('[BotzBuddy] Chat request failed:', err);
      render();
    }
  }

  function scrollToBottom() {
    setTimeout(() => {
      const body = shadow.querySelector('.bb-body');
      if (body) body.scrollTop = body.scrollHeight;
    }, 50);
  }

  // Format markdown helper (bold, emojis, linebreaks)
  function formatMessageText(text) {
    if (!text) return '';
    return text
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.*?)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code style="background:#F1F5F9; padding:2px 4px; border-radius:4px; font-size:12px;">$1</code>')
      .replace(/\n\n/g, '<br/><br/>')
      .replace(/\n/g, '<br/>');
  }

  // Print Challenge Card in clean printable popup
  function printChallengeCard(data) {
    if (!data) return;
    const w = window.open('', '_blank', 'width=650,height=750');
    if (!w) return;
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>Funobotz Challenge Card - ${data.conceptName}</title>
        <style>
          @page { size: A6 portrait; margin: 8mm; }
          body { font-family: 'Baloo 2', 'Nunito', sans-serif, system-ui; margin: 0; padding: 16px; color: #1E2A4A; background: #FFFDF8; }
          .card { border: 3px dashed #FFB13B; border-radius: 14px; padding: 16px; background: #FFFFFF; box-shadow: 0 4px 12px rgba(0,0,0,0.06); }
          .header { display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid #F3F4F6; padding-bottom: 8px; }
          .title { font-size: 16px; font-weight: 800; color: #D97706; }
          .badge { font-size: 22px; }
          .challenge { font-weight: 800; color: #1E2A4A; margin: 10px 0 6px 0; font-size: 13px; }
          .steps { margin: 10px 0; font-size: 12px; line-height: 1.5; color: #3A4560; }
          .step { margin-bottom: 6px; }
          .safety { background: #FEF3C7; border-left: 4px solid #F5B800; padding: 6px 10px; font-size: 11px; font-weight: bold; color: #92400E; margin-top: 10px; border-radius: 4px; }
          .footer { text-align: center; font-size: 10px; color: #7A8399; margin-top: 14px; font-weight: bold; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="header">
            <div class="title">${data.characterEmoji || '🤖'} ${data.characterName} — ${data.conceptName}</div>
            <div class="badge">${data.badge || '🏅'}</div>
          </div>
          <div class="challenge">🛠️ Hands-on Challenge: "${data.choice}"</div>
          <div class="steps">
            ${(data.steps || []).map(s => `<div class="step">📌 ${s}</div>`).join('')}
          </div>
          <div class="safety">⚠️ ${data.safetyTip}</div>
          <div class="footer">${data.footer}</div>
        </div>
        <script>
          window.onload = function() { window.print(); };
        </script>
      </body>
      </html>
    `;
    w.document.write(html);
    w.document.close();
  }

  // -----------------------------------------------------------
  // Main Render Function
  // -----------------------------------------------------------
  function render() {
    const curChar = state.currentCharacter || state.characters.find(c => c.id === config.initialCharacter) || {
      id: 'wavy',
      name: 'Wavy',
      emoji: '👋',
      color: '#FFB13B',
      status: 'verified'
    };

    styleEl.sheet?.cssRules; // trigger update
    wrapper.style.setProperty('--bb-accent', curChar.color || '#FFB13B');

    wrapper.innerHTML = `
      <!-- Launcher Bubble & Floating Tooltip -->
      <div class="bb-launcher-wrap">
        <div class="bb-tooltip ${!state.showTooltip || state.isOpen ? 'hidden' : ''}" id="bb-tooltip">
          👋 Hi! Want to learn with me?
        </div>
        <button class="bb-launcher" id="bb-launcher" aria-label="Open BotzBuddy AI STEM Companion" aria-expanded="${state.isOpen}">
          <span class="bb-launcher-avatar">${curChar.emoji || '🤖'}</span>
          ${!state.sessionId && !state.isOpen ? `<span class="bb-launcher-badge">1</span>` : ''}
        </button>
      </div>

      <!-- Main Chatbot Window -->
      <div class="bb-panel ${state.isOpen ? 'open' : ''}" role="dialog" aria-label="BotzBuddy STEM Learning Companion">
        <!-- Mobile Drag Handle -->
        <div class="bb-drag-handle-bar" id="bb-drag-handle">
          <div class="bb-drag-handle-pill"></div>
        </div>

        <!-- Header -->
        <header class="bb-header">
          <div class="bb-header-left">
            <div class="bb-header-avatar-wrap mood-${state.mood}" title="${curChar.name}">
              <span>${curChar.emoji || '🤖'}</span>
            </div>
            <div class="bb-header-info">
              <h2>${curChar.name}</h2>
              <span class="bb-status-pill ${curChar.status === 'verified' ? 'verified' : (curChar.status === 'behaviour_only' ? 'behaviour' : 'coming')}">
                ${curChar.status === 'verified' ? '● Verified STEM' : (curChar.status === 'behaviour_only' ? '● Behaviour only' : '● Lessons coming')}
              </span>
            </div>
          </div>
          <div class="bb-header-actions">
            <button class="bb-icon-btn" id="bb-char-switch-btn" title="Meet other robot friends" aria-label="Switch character">
              👥
            </button>
            <button class="bb-icon-btn" id="bb-sound-btn" title="Toggle audio voice" aria-label="Toggle sound">
              ${state.soundEnabled ? '🔊' : '🔇'}
            </button>
            <button class="bb-icon-btn" id="bb-close-btn" title="Close window" aria-label="Close">
              ✕
            </button>
          </div>
        </header>

        <!-- Navigation Tabs -->
        <div class="bb-tabs-wrap">
          <div class="bb-tab ${state.activeTab === 'chat' ? 'active' : ''}" id="bb-tab-chat">💬 Learn</div>
          <div class="bb-tab ${state.activeTab === 'twin' ? 'active' : ''}" id="bb-tab-twin">🧬 Learning Twin</div>
          ${config.teacher ? `<div class="bb-tab ${state.activeTab === 'teacher' ? 'active' : ''}" id="bb-tab-teacher">👩‍🏫 Teacher</div>` : ''}
          <div class="bb-tabs-indicator" style="transform: translateX(${state.activeTab === 'chat' ? '0%' : (state.activeTab === 'twin' ? '100%' : '200%')}); width: ${config.teacher ? '33.33%' : '50%'};"></div>
        </div>

        <!-- Scrollable Body -->
        <div class="bb-body">
          ${state.activeTab === 'chat' ? renderChatView(curChar) : (state.activeTab === 'twin' ? renderTwinView() : renderTeacherView())}
        </div>

        <!-- Persistent Action Row (When inside an active session) -->
        ${state.activeTab === 'chat' && state.sessionId ? `
          <div class="bb-action-row">
            <button class="bb-action-btn" data-action-val="already_know">🧠 I already know this</button>
            <button class="bb-action-btn" data-action-val="stuck">🆘 I'm stuck</button>
            <button class="bb-action-btn" data-action-val="change_interest">🔄 Change interest</button>
          </div>
        ` : ''}

        <!-- Footer Input Bar -->
        ${state.activeTab === 'chat' && state.sessionId ? `
          <footer class="bb-footer">
            <input type="text" class="bb-input" id="bb-chat-input" placeholder="Ask a question or teach back..." />
            <input type="file" id="bb-photo-input" accept="image/*" style="display: none;" />
            <button class="bb-tool-btn" id="bb-photo-btn" title="Check photo of your paper build">📷</button>
            <button class="bb-tool-btn ${state.isListening ? 'listening' : ''}" id="bb-mic-btn" title="Speak through microphone">🎤</button>
            <button class="bb-send-btn" id="bb-send-btn" title="Send message">➤</button>
          </footer>
        ` : ''}

        <!-- Character Switcher Bottom Sheet -->
        <div class="bb-modal-sheet ${state.showCharSwitcher ? 'open' : ''}" id="bb-char-sheet">
          <div class="bb-sheet-card">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
              <h3 style="font-family: var(--bb-font-display); font-size: 16px; color: var(--bb-navy);">Choose a Robot Friend</h3>
              <button class="bb-icon-btn" id="bb-sheet-close-btn" style="color: var(--bb-navy); background: var(--bb-paper-2);">✕</button>
            </div>
            <div class="bb-chars-grid">
              ${state.characters.map(c => `
                <div class="bb-char-tile ${c.status !== 'verified' ? 'unverified' : ''}" data-char-id="${c.id}">
                  <span style="font-size: 26px;">${c.emoji}</span>
                  <strong style="font-size: 12px; color: var(--bb-navy);">${c.name}</strong>
                  <span class="bb-status-pill ${c.status === 'verified' ? 'verified' : (c.status === 'behaviour_only' ? 'behaviour' : 'coming')}">
                    ${c.status === 'verified' ? 'STEM' : (c.status === 'behaviour_only' ? 'Behaviour' : 'Coming')}
                  </span>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
      </div>
    `;

    attachEventListeners();
  }

  // -----------------------------------------------------------
  // View Renderers (Chat, Onboarding, Twin, Teacher)
  // -----------------------------------------------------------
  function renderChatView(curChar) {
    if (!state.sessionId) {
      return renderOnboardingView();
    }

    const stageMap = { build: 0, experiment: 1, observe: 2, explain: 3, create: 4, complete: 4 };
    const currentStageIdx = stageMap[state.twinSummary?.stage || 'build'] || 0;

    let html = `
      <!-- Stage Tracker -->
      <div class="bb-stage-tracker">
        <div class="bb-stage-node ${currentStageIdx > 0 ? 'completed' : (currentStageIdx === 0 ? 'active' : '')}">
          <div class="bb-stage-icon">🔨</div>
          <span class="bb-stage-label">Build</span>
        </div>
        <div class="bb-stage-node ${currentStageIdx > 1 ? 'completed' : (currentStageIdx === 1 ? 'active' : '')}">
          <div class="bb-stage-icon">🧪</div>
          <span class="bb-stage-label">Experiment</span>
        </div>
        <div class="bb-stage-node ${currentStageIdx > 2 ? 'completed' : (currentStageIdx === 2 ? 'active' : '')}">
          <div class="bb-stage-icon">👀</div>
          <span class="bb-stage-label">Observe</span>
        </div>
        <div class="bb-stage-node ${currentStageIdx > 3 ? 'completed' : (currentStageIdx === 3 ? 'active' : '')}">
          <div class="bb-stage-icon">💬</div>
          <span class="bb-stage-label">Explain</span>
        </div>
        <div class="bb-stage-node ${currentStageIdx === 4 ? 'active completed' : ''}">
          <div class="bb-stage-icon">🎨</div>
          <span class="bb-stage-label">Create</span>
        </div>
      </div>
    `;

    for (let i = 0; i < state.messages.length; i++) {
      const msg = state.messages[i];
      const isUser = msg.character === 'user';
      const senderChar = isUser ? null : (state.characters.find(c => c.id === msg.character) || curChar);

      html += `
        <div class="bb-msg ${isUser ? 'bb-msg-user' : 'bb-msg-bot'}">
          ${!isUser ? `<div class="bb-msg-avatar" style="border-color: ${senderChar?.color || 'var(--bb-accent)'};">${senderChar?.emoji || '🤖'}</div>` : ''}
          <div class="bb-msg-content" style="${!isUser ? `border-left-color: ${senderChar?.color || 'var(--bb-accent)'};` : ''}">
            ${!isUser ? `<div class="bb-msg-author">${senderChar?.name || 'BotzBuddy'}</div>` : ''}
            <div>${formatMessageText(msg.text)}</div>

            <!-- Tier 2 General Science Card -->
            ${msg.type === 'general_stem' ? `
              <div class="bb-general-card">
                <div class="bb-general-badge">🔬 General science, not a Funobotz lesson yet</div>
                <div style="font-size: 13.5px; line-height: 1.5;">${formatMessageText(msg.text)}</div>
                ${msg.data?.safetyTip ? `
                  <div class="bb-safety-tip">⚠️ <strong>Safety Tip:</strong> ${msg.data.safetyTip}</div>
                ` : ''}
                ${msg.data?.keyTerms && msg.data.keyTerms.length > 0 ? `
                  <div class="bb-key-terms">
                    ${msg.data.keyTerms.map(t => `<span class="bb-term-tag">${t}</span>`).join('')}
                  </div>
                ` : ''}
              </div>
            ` : ''}

            <!-- Team-Up Dual Avatar Card -->
            ${msg.type === 'teamup' && msg.data ? `
              <div class="bb-teamup-card">
                <div class="bb-teamup-duo">
                  <span>${msg.data.char1?.emoji || '🦆'}</span>
                  <strong style="color: #10B981; font-size: 18px;">🤝</strong>
                  <span>${msg.data.char2?.emoji || '🦂'}</span>
                </div>
                <div style="font-weight: 800; font-size: 13px; color: #065F46; margin-bottom: 4px;">✨ Robot Team-Up!</div>
                <div style="font-size: 12px; text-align: left; background: #FFFFFF; padding: 6px 8px; border-radius: 8px; margin-top: 4px;">
                  <strong>${msg.data.char1?.name}:</strong> "${msg.data.char1?.fact}"
                </div>
                <div style="font-size: 12px; text-align: left; background: #FFFFFF; padding: 6px 8px; border-radius: 8px; margin-top: 4px;">
                  <strong>${msg.data.char2?.name}:</strong> "${msg.data.char2?.fact}"
                </div>
              </div>
            ` : ''}

            <!-- Virtual Build Workbench -->
            ${msg.type === 'build' && msg.data?.parts ? `
              <div class="bb-build-bench">
                <div class="bb-build-bench-title">🛠️ Tap parts to snap into the paper robot:</div>
                <div class="bb-parts-grid">
                  ${msg.data.parts.map(p => `
                    <div class="bb-part-tile ${state.selectedBuildParts.includes(p) ? 'snapped' : ''}" data-part="${p}">
                      <span style="font-size: 20px;">${p.includes('battery') ? '🔋' : (p.includes('wire') || p.includes('foil') ? '⚡' : (p.includes('motor') ? '⚙️' : (p.includes('led') ? '💡' : '🧩')))}</span>
                      <span>${p}</span>
                    </div>
                  `).join('')}
                </div>
              </div>
            ` : ''}

            <!-- Challenge Card -->
            ${msg.type === 'challenge_card' && msg.data ? `
              <div class="bb-challenge-card">
                <div class="bb-challenge-head">
                  <h4>${msg.data.characterEmoji || '🤖'} ${msg.data.characterName} Challenge</h4>
                  <span>${msg.data.badge || '🏅'}</span>
                </div>
                <div style="font-weight: 700; font-size: 12.5px; margin-bottom: 6px;">
                  Project: "${msg.data.choice}"
                </div>
                <div style="font-size: 11.5px; line-height: 1.5; color: var(--bb-ink);">
                  ${(msg.data.steps || []).map(s => `<div>• ${s}</div>`).join('')}
                </div>
                <div style="font-size: 11px; color: #92400E; background: #FEF3C7; padding: 4px 8px; border-radius: 6px; margin-top: 6px;">
                  ⚠️ ${msg.data.safetyTip}
                </div>
                <button class="bb-print-btn" data-card-idx="${i}">
                  🖨️ Print My Challenge Card
                </button>
              </div>
            ` : ''}
          </div>
        </div>
      `;
    }

    if (state.isLoading) {
      html += `
        <div class="bb-msg bb-msg-bot">
          <div class="bb-msg-avatar">${curChar.emoji}</div>
          <div class="bb-msg-content">
            <div class="bb-typing">
              <div class="bb-typing-dot"></div>
              <div class="bb-typing-dot"></div>
              <div class="bb-typing-dot"></div>
            </div>
          </div>
        </div>
      `;
    }

    if (state.quickReplies && state.quickReplies.length > 0 && !state.isLoading) {
      html += `
        <div class="bb-quick-row">
          ${state.quickReplies.map((qr, idx) => `
            <button class="bb-quick-chip" data-qr-idx="${idx}">${qr.label}</button>
          `).join('')}
        </div>
      `;
    }

    return html;
  }

  // -----------------------------------------------------------
  // Multi-Step Onboarding Wizard
  // -----------------------------------------------------------
  function renderOnboardingView() {
    const step = state.onboardingStep;
    const d = state.onboardingData;

    return `
      <div class="bb-wizard-card">
        <!-- Progress Dots -->
        <div class="bb-wizard-dots">
          <div class="bb-wizard-dot ${step >= 1 ? 'active' : ''}"></div>
          <div class="bb-wizard-dot ${step >= 2 ? 'active' : ''}"></div>
          <div class="bb-wizard-dot ${step >= 3 ? 'active' : ''}"></div>
          <div class="bb-wizard-dot ${step >= 4 ? 'active' : ''}"></div>
        </div>

        ${step === 1 ? `
          <h3 class="bb-wizard-title">How old are you? 🎂</h3>
          <div class="bb-tap-grid">
            ${[6, 7, 8, 9, 10, 11, 12, 13, 14].map(a => `
              <div class="bb-tap-card ${d.age === a ? 'selected' : ''}" data-step-val="age" data-val="${a}">
                <span class="bb-tap-card-icon">${a <= 8 ? '🌱' : (a <= 11 ? '⚡' : '🚀')}</span>
                <span>${a} years</span>
              </div>
            `).join('')}
          </div>
          <button class="bb-primary-btn" id="bb-next-step-btn">Next Step ➤</button>
        ` : ''}

        ${step === 2 ? `
          <h3 class="bb-wizard-title">What excites you most? 🌟</h3>
          <div class="bb-tap-grid">
            <div class="bb-tap-card ${d.interests.includes('light') ? 'selected' : ''}" data-step-val="interest" data-val="light">
              <span class="bb-tap-card-icon">🌈</span>
              <span>Light & Colours</span>
            </div>
            <div class="bb-tap-card ${d.interests.includes('robotics') ? 'selected' : ''}" data-step-val="interest" data-val="robotics">
              <span class="bb-tap-card-icon">🤖</span>
              <span>Paper Robots</span>
            </div>
            <div class="bb-tap-card ${d.interests.includes('mechanics') ? 'selected' : ''}" data-step-val="interest" data-val="mechanics">
              <span class="bb-tap-card-icon">⚙️</span>
              <span>Motors & Gears</span>
            </div>
            <div class="bb-tap-card ${d.interests.includes('signals') ? 'selected' : ''}" data-step-val="interest" data-val="signals">
              <span class="bb-tap-card-icon">🚦</span>
              <span>Traffic LEDs</span>
            </div>
            <div class="bb-tap-card ${d.interests.includes('animals') ? 'selected' : ''}" data-step-val="interest" data-val="animals">
              <span class="bb-tap-card-icon">🦂</span>
              <span>Animal Motion</span>
            </div>
            <div class="bb-tap-card ${d.interests.includes('space') ? 'selected' : ''}" data-step-val="interest" data-val="space">
              <span class="bb-tap-card-icon">🪐</span>
              <span>Space Quest</span>
            </div>
          </div>
          <button class="bb-primary-btn" id="bb-next-step-btn">Next Step ➤</button>
        ` : ''}

        ${step === 3 ? `
          <h3 class="bb-wizard-title">Starting Knowledge Level 🧠</h3>
          <div style="display: flex; flex-direction: column; gap: 8px;">
            <div class="bb-tap-card ${d.knowledge === 'new' ? 'selected' : ''}" data-step-val="knowledge" data-val="new" style="flex-direction: row; justify-content: flex-start; padding: 10px 14px;">
              <span style="font-size: 24px;">🌱</span>
              <div style="text-align: left; margin-left: 8px;">
                <strong>Brand New to Robotics</strong>
                <div style="font-size: 11px; color: var(--bb-muted);">Step-by-step guidance and gentle pacing</div>
              </div>
            </div>
            <div class="bb-tap-card ${d.knowledge === 'basics' ? 'selected' : ''}" data-step-val="knowledge" data-val="basics" style="flex-direction: row; justify-content: flex-start; padding: 10px 14px;">
              <span style="font-size: 24px;">🔧</span>
              <div style="text-align: left; margin-left: 8px;">
                <strong>I know battery basics</strong>
                <div style="font-size: 11px; color: var(--bb-muted);">Fast-track through closed circuits</div>
              </div>
            </div>
            <div class="bb-tap-card ${d.knowledge === 'challenge' ? 'selected' : ''}" data-step-val="knowledge" data-val="challenge" style="flex-direction: row; justify-content: flex-start; padding: 10px 14px;">
              <span style="font-size: 24px;">🚀</span>
              <div style="text-align: left; margin-left: 8px;">
                <strong>Master Engineer</strong>
                <div style="font-size: 11px; color: var(--bb-muted);">Deeper explanations & tough challenges</div>
              </div>
            </div>
          </div>
          <button class="bb-primary-btn" id="bb-next-step-btn">Next Step ➤</button>
        ` : ''}

        ${step === 4 ? `
          <h3 class="bb-wizard-title">Preferences & Language 🌍</h3>
          <div style="display: flex; gap: 8px; margin-bottom: 8px;">
            <div class="bb-tap-card ${d.language === 'en' ? 'selected' : ''}" data-step-val="lang" data-val="en" style="flex: 1;">
              <span style="font-size: 20px;">🇬🇧</span>
              <span>English</span>
            </div>
            <div class="bb-tap-card ${d.language === 'ta' ? 'selected' : ''}" data-step-val="lang" data-val="ta" style="flex: 1;">
              <span style="font-size: 20px;">🇮🇳</span>
              <span>தமிழ் (Tamil)</span>
            </div>
          </div>

          <div style="display: flex; gap: 6px; margin-bottom: 8px;">
            <button class="bb-action-btn ${d.explorer ? 'bb-quick-chip' : ''}" id="bb-toggle-explorer">
              🗺️ Explorer Mode
            </button>
            <button class="bb-action-btn ${d.shortMode ? 'bb-quick-chip' : ''}" id="bb-toggle-short">
              ⚡ Short & Punchy
            </button>
          </div>

          <button class="bb-primary-btn" id="bb-start-mission-btn">🚀 Start Learning Mission!</button>
        ` : ''}

        <!-- Test Learners Section for Demo / Hackathon Judging -->
        ${config.demo ? `
          <div style="border-top: 1px dashed var(--bb-line); padding-top: 10px; margin-top: 6px;">
            <div style="font-size: 11px; font-weight: 800; color: var(--bb-muted); margin-bottom: 6px;">⚡ Quick Test Learner Presets:</div>
            <div style="display: flex; flex-wrap: wrap; gap: 4px;">
              ${(state.profiles || []).map(p => `
                <button class="bb-action-btn" data-profile-preset="${p.id}" title="${p.description}">
                  ${p.id} (${p.interests[0]})
                </button>
              `).join('')}
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }

  // -----------------------------------------------------------
  // Learning Twin View Dashboard
  // -----------------------------------------------------------
  function renderTwinView() {
    const s = state.twinSummary || {
      age: state.onboardingData.age || 9,
      ageBand: 'young',
      rank: 'Explorer',
      rankEmoji: '🌱',
      xp: 0,
      signals: { say: 0, choose: 0, build: 0, explain: 0, confidence: 0 },
      mastery: {},
      misconceptions: [],
      curiosityDomains: {},
      memoryBoostsCount: 0
    };

    const d = state.latestDecision || {
      intent: 'session_init',
      character: 'wavy',
      concept: 'simple_circuit',
      level: 'Foundation',
      reason: 'Standard hands-on discovery',
      provider: 'rule-based'
    };

    const ranks = ['Explorer', 'Builder', 'Experimenter', 'Explainer', 'Creator'];
    const rankEmojis = ['🌱', '🔧', '🧪', '🧠', '🚀'];
    const currentRankIdx = ranks.indexOf(s.rank) >= 0 ? ranks.indexOf(s.rank) : 0;

    return `
      <div class="bb-dashboard-grid">
        <!-- Rank Journey Path -->
        <div class="bb-dash-card">
          <div class="bb-dash-card-title">
            <span>🏆 Learning Journey Rank</span>
            <span style="color: var(--bb-orange-deep); font-size: 12px;">${s.xp} XP</span>
          </div>
          <div class="bb-rank-path">
            ${ranks.map((r, i) => `
              <div class="bb-rank-step ${i <= currentRankIdx ? 'active' : ''}">
                <div class="bb-rank-badge">${rankEmojis[i]}</div>
                <span>${r}</span>
              </div>
            `).join('')}
          </div>
          <div class="bb-progress-bar-bg">
            <div class="bb-progress-bar-fill" style="width: ${Math.min(100, (s.xp / 200) * 100)}%;"></div>
          </div>
        </div>

        <!-- 5-Signal Multi-Modal Stats -->
        <div class="bb-dash-card">
          <div class="bb-dash-card-title">
            <span>📡 5-Signal Multi-Modal Metrics</span>
            <span style="font-size: 11px; color: #7C3AED;">Boosts: ${s.memoryBoostsCount || 0}</span>
          </div>
          <div class="bb-signals-grid">
            <div class="bb-signal-box">
              <div class="bb-signal-val">${s.signals?.say || 0}</div>
              <div class="bb-signal-name">🗣️ Say</div>
            </div>
            <div class="bb-signal-box">
              <div class="bb-signal-val">${s.signals?.choose || 0}</div>
              <div class="bb-signal-name">👆 Choose</div>
            </div>
            <div class="bb-signal-box">
              <div class="bb-signal-val">${s.signals?.build || 0}</div>
              <div class="bb-signal-name">🔨 Build</div>
            </div>
            <div class="bb-signal-box">
              <div class="bb-signal-val">${s.signals?.explain || 0}</div>
              <div class="bb-signal-name">💡 Explain</div>
            </div>
            <div class="bb-signal-box">
              <div class="bb-signal-val">${s.signals?.confidence || 0}</div>
              <div class="bb-signal-name">🎯 Conf</div>
            </div>
          </div>
        </div>

        <!-- Real-Time Concept Mastery -->
        <div class="bb-dash-card">
          <div class="bb-dash-card-title">
            <span>📊 Concept Mastery Progress</span>
          </div>
          ${state.concepts.map(c => {
            const val = s.mastery?.[c.id] || 0;
            let tagClass = 'foundation';
            let tagText = 'Foundation';
            if (val >= 80) { tagClass = 'ready'; tagText = 'Ready 🚀'; }
            else if (val >= 40) { tagClass = 'developing'; tagText = 'Developing'; }

            return `
              <div class="bb-mastery-item">
                <div class="bb-mastery-head">
                  <span>${c.name}</span>
                  <span class="bb-level-tag ${tagClass}">${val}% (${tagText})</span>
                </div>
                <div class="bb-progress-bar-bg">
                  <div class="bb-progress-bar-fill" style="width: ${val}%; background: ${val >= 80 ? 'var(--bb-green)' : (val >= 40 ? 'var(--bb-orange)' : 'var(--bb-red)')};"></div>
                </div>
              </div>
            `;
          }).join('')}
        </div>

        <!-- Curiosity Domains Explored -->
        <div class="bb-dash-card">
          <div class="bb-dash-card-title">
            <span>🔬 Curiosity Domains Explored</span>
          </div>
          ${Object.keys(s.curiosityDomains || {}).length === 0 ? `
            <div style="font-size: 11.5px; color: var(--bb-muted);">No general science questions asked yet. Ask any science question in chat!</div>
          ` : `
            <div style="display: flex; flex-wrap: wrap; gap: 6px;">
              ${Object.entries(s.curiosityDomains || {}).map(([dom, count]) => `
                <span class="bb-term-tag" style="background:#EFF6FF; border-color:#BFDBFE; color:#1D4ED8; padding:3px 8px;">
                  🔬 ${dom} <strong>x${count}</strong>
                </span>
              `).join('')}
            </div>
          `}
        </div>

        <!-- "Why This Response?" Engine Decision Card -->
        <div class="bb-dash-card">
          <div class="bb-dash-card-title">
            <span>🧠 Why This Response? (Engine Decision)</span>
          </div>
          <div class="bb-decision-table">
            <div class="bb-decision-row">
              <span class="bb-decision-key">Tier & Intent</span>
              <span class="bb-decision-val"><strong>${d.tier || 'funobotz_stem'}</strong> (${d.intent})</span>
            </div>
            ${d.domain ? `
              <div class="bb-decision-row">
                <span class="bb-decision-key">Domain</span>
                <span class="bb-decision-val">${d.domain} | Level: ${d.ageLevel || d.level || 'Standard'}</span>
              </div>
            ` : ''}
            <div class="bb-decision-row">
              <span class="bb-decision-key">Character</span>
              <span class="bb-decision-val">${d.character} | Concept: ${d.concept || 'N/A'}</span>
            </div>
            <div class="bb-decision-row">
              <span class="bb-decision-key">AI Provider</span>
              <span class="bb-decision-val"><code style="background:#F1F5F9; color:#0369A1; padding:1px 6px; border-radius:4px; font-weight:800;">${d.provider || 'rule-based'}</code></span>
            </div>
            ${d.bridgeSkill && d.bridgeSkill !== 'none' ? `
              <div class="bb-decision-row">
                <span class="bb-decision-key">Bridge Choice</span>
                <span class="bb-decision-val">${d.bridgeSkill} → ${d.bridgeChoice || 'wavy'}</span>
              </div>
            ` : ''}
            <div class="bb-decision-row">
              <span class="bb-decision-key">Reason</span>
              <span class="bb-decision-val">${d.reason}</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // -----------------------------------------------------------
  // Teacher View Tab
  // -----------------------------------------------------------
  function renderTeacherView() {
    const jar = state.curiosityJarData || { total: 0, byCharacter: {}, topKeywords: [], recentQuestions: [] };

    return `
      <div class="bb-dashboard-grid">
        <!-- Live Class Active Students -->
        <div class="bb-dash-card">
          <div class="bb-dash-card-title">
            <span>👩‍🏫 Live Student Workbench Monitor</span>
            <span style="font-size: 11px; color: var(--bb-muted);">Auto-refreshing</span>
          </div>
          <div style="font-size: 12px; color: var(--bb-muted); margin-bottom: 6px;">
            Real-time multi-learner progress for classroom & institutional workshops.
          </div>

          ${state.teacherSessions.length === 0 ? `
            <div style="font-size: 12px; color: var(--bb-muted); text-align: center; padding: 16px; background: var(--bb-paper-2); border-radius: 8px;">
              No other active learners yet. Share this page with your class to begin live monitoring!
            </div>
          ` : `
            <table class="bb-teacher-table">
              <thead>
                <tr>
                  <th>Learner</th>
                  <th>Concept</th>
                  <th>Mastery</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${state.teacherSessions.map(s => `
                  <tr>
                    <td><strong>${s.learnerLabel}</strong><br/><span style="color:var(--bb-muted); font-size:10px;">${s.rankEmoji} ${s.rank}</span></td>
                    <td>${s.currentConcept || 'Onboarding'}</td>
                    <td><strong>${s.mastery}%</strong></td>
                    <td>
                      ${s.needsHelp ? `
                        <span style="color: var(--bb-red); font-weight: 800;"><span class="bb-help-dot"></span>Needs Help</span>
                      ` : `
                        <span style="color: var(--bb-green); font-weight: 700;">✨ On Track</span>
                      `}
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          `}
        </div>

        <!-- Curiosity Jar R&D Section -->
        <div class="bb-dash-card">
          <div class="bb-dash-card-title">
            <span>🏺 Curiosity Jar R&D Insights</span>
            <span style="font-size: 11px; color: var(--bb-orange-deep); font-weight: 800;">${jar.total} Questions</span>
          </div>
          <div style="font-size: 12px; color: var(--bb-muted); margin-bottom: 8px;">
            Anonymous science & curiosity questions asked by kids. Guides Funobotz future kit roadmap!
          </div>

          ${jar.topKeywords && jar.topKeywords.length > 0 ? `
            <div style="display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 8px;">
              ${jar.topKeywords.map(k => `
                <span class="bb-action-btn" style="background:#FFFDF9; border-color:var(--bb-orange);">${k.word} (${k.count})</span>
              `).join('')}
            </div>
          ` : ''}

          ${jar.recentQuestions && jar.recentQuestions.length > 0 ? `
            <div style="display: flex; flex-direction: column; gap: 4px;">
              ${jar.recentQuestions.slice(0, 5).map(q => `
                <div style="font-size: 11.5px; background: var(--bb-paper-2); padding: 5px 8px; border-radius: 6px;">
                  <strong>${q.characterAsked}:</strong> "${q.question}" <span style="color:var(--bb-muted); font-size:10px;">(${q.ageBand})</span>
                </div>
              `).join('')}
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  // -----------------------------------------------------------
  // Event Listeners Binding
  // -----------------------------------------------------------
  function attachEventListeners() {
    // 1. Launcher click
    const launcher = shadow.querySelector('#bb-launcher');
    if (launcher) {
      launcher.onclick = () => {
        state.isOpen = !state.isOpen;
        state.showTooltip = false;
        render();
        if (state.isOpen && !state.sessionId) {
          // start teacher poll if enabled
          if (config.teacher && !teacherPollInterval) {
            fetchTeacherSessions();
            fetchCuriosityJar();
            teacherPollInterval = setInterval(() => {
              fetchTeacherSessions();
              fetchCuriosityJar();
            }, 5000);
          }
        }
      };
    }

    // 2. Tooltip click
    const tooltip = shadow.querySelector('#bb-tooltip');
    if (tooltip) {
      tooltip.onclick = () => {
        state.isOpen = true;
        state.showTooltip = false;
        render();
      };
    }

    // 3. Close button & Drag Handle
    const closeBtn = shadow.querySelector('#bb-close-btn');
    if (closeBtn) {
      closeBtn.onclick = () => {
        state.isOpen = false;
        render();
      };
    }

    const dragHandle = shadow.querySelector('#bb-drag-handle');
    if (dragHandle) {
      dragHandle.onclick = () => {
        state.isOpen = false;
        render();
      };
    }

    // 4. Character Switcher button
    const charBtn = shadow.querySelector('#bb-char-switch-btn');
    if (charBtn) {
      charBtn.onclick = () => {
        state.showCharSwitcher = true;
        render();
      };
    }

    const sheetCloseBtn = shadow.querySelector('#bb-sheet-close-btn');
    if (sheetCloseBtn) {
      sheetCloseBtn.onclick = () => {
        state.showCharSwitcher = false;
        render();
      };
    }

    const charTiles = shadow.querySelectorAll('.bb-char-tile');
    charTiles.forEach(tile => {
      tile.onclick = () => {
        const charId = tile.getAttribute('data-char-id');
        state.showCharSwitcher = false;
        if (charId) {
          sendChat({ action: { type: 'select_character', characterId: charId } });
        }
      };
    });

    // 5. Sound toggle button
    const soundBtn = shadow.querySelector('#bb-sound-btn');
    if (soundBtn) {
      soundBtn.onclick = () => {
        state.soundEnabled = !state.soundEnabled;
        render();
      };
    }

    // 6. Navigation Tabs
    const tabChat = shadow.querySelector('#bb-tab-chat');
    if (tabChat) tabChat.onclick = () => { state.activeTab = 'chat'; render(); };
    const tabTwin = shadow.querySelector('#bb-tab-twin');
    if (tabTwin) tabTwin.onclick = () => { state.activeTab = 'twin'; render(); };
    const tabTeacher = shadow.querySelector('#bb-tab-teacher');
    if (tabTeacher) {
      tabTeacher.onclick = () => {
        state.activeTab = 'teacher';
        fetchTeacherSessions();
        fetchCuriosityJar();
        render();
      };
    }

    // 7. Onboarding Tap Cards
    const tapCards = shadow.querySelectorAll('.bb-tap-card[data-step-val]');
    tapCards.forEach(card => {
      card.onclick = () => {
        const stepKey = card.getAttribute('data-step-val');
        const val = card.getAttribute('data-val');

        if (stepKey === 'age') state.onboardingData.age = parseInt(val, 10);
        if (stepKey === 'interest') state.onboardingData.interests = [val];
        if (stepKey === 'knowledge') state.onboardingData.knowledge = val;
        if (stepKey === 'lang') state.onboardingData.language = val;

        render();
      };
    });

    const nextStepBtn = shadow.querySelector('#bb-next-step-btn');
    if (nextStepBtn) {
      nextStepBtn.onclick = () => {
        state.onboardingStep = Math.min(4, state.onboardingStep + 1);
        render();
      };
    }

    const startMissionBtn = shadow.querySelector('#bb-start-mission-btn');
    if (startMissionBtn) {
      startMissionBtn.onclick = () => {
        startSession();
      };
    }

    // Preset Profiles
    const profileBtns = shadow.querySelectorAll('[data-profile-preset]');
    profileBtns.forEach(btn => {
      btn.onclick = () => {
        const pid = btn.getAttribute('data-profile-preset');
        startSession({ profileId: pid });
      };
    });

    const toggleExplorer = shadow.querySelector('#bb-toggle-explorer');
    if (toggleExplorer) {
      toggleExplorer.onclick = () => {
        state.onboardingData.explorer = !state.onboardingData.explorer;
        render();
      };
    }

    const toggleShort = shadow.querySelector('#bb-toggle-short');
    if (toggleShort) {
      toggleShort.onclick = () => {
        state.onboardingData.shortMode = !state.onboardingData.shortMode;
        render();
      };
    }

    // 8. Chat Input & Send
    const chatInput = shadow.querySelector('#bb-chat-input');
    const sendBtn = shadow.querySelector('#bb-send-btn');

    if (sendBtn && chatInput) {
      const handleSend = () => {
        const txt = chatInput.value.trim();
        if (txt) {
          chatInput.value = '';
          sendChat({ text: txt });
        }
      };

      sendBtn.onclick = handleSend;
      chatInput.onkeydown = (e) => {
        if (e.key === 'Enter') handleSend();
      };
    }

    // 9. Photo Check Button
    const photoBtn = shadow.querySelector('#bb-photo-btn');
    const photoInput = shadow.querySelector('#bb-photo-input');
    if (photoBtn && photoInput) {
      photoBtn.onclick = () => photoInput.click();
      photoInput.onchange = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = async () => {
          const base64 = reader.result;
          state.isLoading = true;
          render();
          try {
            const res = await fetch(`${config.api}/api/photo-check`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                sessionId: state.sessionId,
                image: base64,
                concept: state.twinSummary?.currentConcept
              })
            });
            const data = await res.json();
            state.messages.push({
              type: 'text',
              character: state.currentCharacter?.id || 'wavy',
              text: `📷 **Photo Check:** ${data.feedback}`
            });
            state.isLoading = false;
            render();
            scrollToBottom();
          } catch (err) {
            state.isLoading = false;
            render();
          }
        };
        reader.readAsDataURL(file);
      };
    }

    // 10. Microphone Button
    const micBtn = shadow.querySelector('#bb-mic-btn');
    if (micBtn) {
      micBtn.onclick = toggleSpeechRecognition;
    }

    // 11. Quick Replies
    const quickChips = shadow.querySelectorAll('.bb-quick-chip');
    quickChips.forEach(chip => {
      chip.onclick = () => {
        const idx = parseInt(chip.getAttribute('data-qr-idx'), 10);
        const qr = state.quickReplies[idx];
        if (qr) {
          sendChat({ text: qr.label, action: qr });
        }
      };
    });

    // 12. Persistent Action Chips
    const actionBtns = shadow.querySelectorAll('.bb-action-btn[data-action-val]');
    actionBtns.forEach(btn => {
      btn.onclick = () => {
        const val = btn.getAttribute('data-action-val');
        sendChat({ text: btn.textContent.trim(), action: { type: 'quick', value: val } });
      };
    });

    // 13. Virtual Build Part Clicks
    const partTiles = shadow.querySelectorAll('.bb-part-tile');
    partTiles.forEach(tile => {
      tile.onclick = () => {
        const p = tile.getAttribute('data-part');
        if (!state.selectedBuildParts.includes(p)) {
          state.selectedBuildParts.push(p);
          render();
          if (state.selectedBuildParts.length >= 3) {
            sendChat({ text: "I've connected all the parts!", action: { type: 'build', value: 'build_done' } });
          }
        }
      };
    });

    // 14. Printable Challenge Card
    const printBtns = shadow.querySelectorAll('.bb-print-btn');
    printBtns.forEach(btn => {
      btn.onclick = () => {
        const msgIdx = parseInt(btn.getAttribute('data-card-idx'), 10);
        const msg = state.messages[msgIdx];
        if (msg && msg.data) {
          printChallengeCard(msg.data);
        }
      };
    });
  }

  // Keyboard accessibility (Escape key closes panel and sheets)
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (state.showCharSwitcher) {
        state.showCharSwitcher = false;
        render();
      } else if (state.isOpen) {
        state.isOpen = false;
        render();
      }
    }
  });

  // Fade out tooltip after 5 seconds
  setTimeout(() => {
    state.showTooltip = false;
    const tt = shadow.querySelector('#bb-tooltip');
    if (tt) tt.classList.add('hidden');
  }, 5000);

  // Initialize Plugin
  loadInitialData();
})();
