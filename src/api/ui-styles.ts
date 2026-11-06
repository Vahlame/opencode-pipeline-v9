export const uiStyles = `
    :root {
      color-scheme: dark;
      --ink: #070a10;
      --ink-2: #0b1018;
      --surface: #101620;
      --surface-2: #151d29;
      --surface-3: #1b2533;
      --line: #263244;
      --line-soft: #1c2634;
      --text: #f4f1e8;
      --muted: #9aa8b7;
      --muted-2: #748394;
      --gold: #f4b860;
      --gold-soft: rgba(244, 184, 96, 0.14);
      --teal: #43d6b4;
      --teal-soft: rgba(67, 214, 180, 0.13);
      --blue: #6da8ff;
      --blue-soft: rgba(109, 168, 255, 0.13);
      --violet: #b99cff;
      --violet-soft: rgba(185, 156, 255, 0.13);
      --coral: #ff6f7d;
      --coral-soft: rgba(255, 111, 125, 0.13);
      --radius: 16px;
      --radius-sm: 11px;
      --shadow: 0 24px 70px rgba(0, 0, 0, 0.38);
      --font: "Segoe UI Variable", "Segoe UI", Inter, ui-sans-serif, system-ui, sans-serif;
      --mono: "Cascadia Code", "SFMono-Regular", Consolas, ui-monospace, monospace;
    }
    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: var(--font);
      color: var(--text);
      background:
        radial-gradient(1100px 620px at 12% -18%, rgba(244, 184, 96, 0.12), transparent 62%),
        radial-gradient(900px 560px at 100% 0%, rgba(109, 168, 255, 0.10), transparent 58%),
        radial-gradient(800px 500px at 55% 110%, rgba(67, 214, 180, 0.06), transparent 60%),
        linear-gradient(180deg, #070a10 0%, #0a0f17 58%, #080b12 100%);
      background-attachment: fixed;
    }
    body::before {
      content: "";
      position: fixed;
      inset: 0;
      pointer-events: none;
      background-image:
        linear-gradient(rgba(255, 255, 255, 0.022) 1px, transparent 1px),
        linear-gradient(90deg, rgba(255, 255, 255, 0.022) 1px, transparent 1px);
      background-size: 48px 48px;
      mask-image: radial-gradient(900px 600px at 50% 0%, #000 0%, transparent 78%);
    }
    button, input, select, textarea { font: inherit; }
    button { cursor: pointer; border: 0; }
    button:focus-visible, a:focus-visible, input:focus-visible, select:focus-visible, textarea:focus-visible {
      outline: 2px solid var(--gold);
      outline-offset: 2px;
    }
    .shell { display: grid; grid-template-columns: 282px 1fr; min-height: 100vh; position: relative; z-index: 1; }
    aside {
      border-right: 1px solid var(--line-soft);
      background: linear-gradient(180deg, rgba(8, 12, 19, 0.94), rgba(8, 12, 19, 0.78));
      padding: 26px 18px 22px;
      display: flex;
      flex-direction: column;
      gap: 22px;
      position: sticky;
      top: 0;
      height: 100vh;
      backdrop-filter: blur(14px);
    }
    .brand { display: flex; align-items: center; gap: 12px; padding: 0 6px; }
    .mark {
      width: 44px;
      height: 44px;
      border-radius: 14px;
      display: grid;
      place-items: center;
      font-weight: 800;
      letter-spacing: -1.5px;
      font-size: 15px;
      background: linear-gradient(135deg, var(--gold), #ffd79a);
      color: #1a1204;
      box-shadow: 0 10px 26px rgba(244, 184, 96, 0.22);
    }
    .brand h1 { margin: 0; font-size: 15px; line-height: 1.2; letter-spacing: -0.02em; }
    .brand p { margin: 4px 0 0; color: var(--muted-2); font-size: 11px; text-transform: uppercase; letter-spacing: 0.12em; }
    .nav { display: grid; gap: 4px; }
    .nav a {
      color: var(--muted);
      text-decoration: none;
      padding: 10px 12px;
      border-radius: 10px;
      font-size: 13px;
      display: flex;
      align-items: center;
      gap: 10px;
      border: 1px solid transparent;
      transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
    }
    .nav a:hover { color: var(--text); background: rgba(255, 255, 255, 0.045); border-color: var(--line-soft); }
    .nav a .idx {
      width: 22px;
      height: 22px;
      border-radius: 7px;
      display: grid;
      place-items: center;
      font-size: 10px;
      font-weight: 800;
      background: var(--surface-2);
      border: 1px solid var(--line);
      color: var(--muted);
      flex: none;
    }
    .nav a:hover .idx { color: var(--gold); border-color: rgba(244, 184, 96, 0.4); }
    .sidebar-section { display: grid; gap: 8px; }
    .sidebar-label {
      color: var(--muted-2);
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.14em;
      font-weight: 800;
      padding: 0 6px;
    }
    .sidebar-note {
      margin-top: auto;
      border: 1px solid var(--line-soft);
      border-radius: var(--radius-sm);
      background: rgba(255, 255, 255, 0.028);
      padding: 13px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.55;
    }
    .sidebar-note strong { color: var(--text); display: block; margin-bottom: 4px; }
    .sidebar-foot { color: var(--muted-2); font-size: 10px; letter-spacing: 0.08em; padding: 0 6px; }
    .online { display: inline-flex; align-items: center; gap: 7px; color: var(--teal); font-size: 11px; font-weight: 700; }
    .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--teal); box-shadow: 0 0 0 4px rgba(67, 214, 180, 0.12); }
    main { padding: 28px clamp(18px, 3.4vw, 48px) 80px; max-width: 1500px; width: 100%; }
    .topbar { display: flex; align-items: flex-start; justify-content: space-between; gap: 22px; margin-bottom: 20px; }
    .topbar h1 { margin: 6px 0 0; font-size: clamp(27px, 3.4vw, 42px); letter-spacing: -0.05em; line-height: 1.02; }
    .topbar p { margin: 9px 0 0; color: var(--muted); max-width: 680px; line-height: 1.55; }
    .top-actions { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
    .controls { display: flex; gap: 9px; flex-wrap: wrap; align-items: center; }
    input, select, textarea {
      background: var(--surface-2);
      color: var(--text);
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      padding: 10px 12px;
      min-width: 180px;
      outline: none;
      transition: border-color 0.15s ease, box-shadow 0.15s ease;
    }
    textarea { resize: vertical; min-height: 72px; line-height: 1.5; }
    input::placeholder, textarea::placeholder { color: var(--muted-2); }
    input:focus, select:focus, textarea:focus {
      border-color: var(--gold);
      box-shadow: 0 0 0 3px rgba(244, 184, 96, 0.13);
    }
    .btn {
      padding: 10px 15px;
      border-radius: var(--radius-sm);
      background: var(--gold);
      color: #1a1204;
      font-weight: 800;
      font-size: 12px;
      letter-spacing: 0.01em;
      transition: transform 0.15s ease, filter 0.15s ease, background 0.15s ease;
      white-space: nowrap;
    }
    .btn:hover { filter: brightness(1.06); transform: translateY(-1px); }
    .btn.secondary { background: var(--surface-3); color: var(--text); border: 1px solid var(--line); }
    .btn.secondary:hover { border-color: var(--blue); }
    .btn.danger { background: var(--coral); color: #25060b; }
    .btn.ghost { background: transparent; color: var(--muted); border: 1px solid var(--line); }
    .btn.ghost:hover { color: var(--text); border-color: var(--gold); }
    .btn.small { padding: 7px 10px; font-size: 11px; }
    .command-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      flex-wrap: wrap;
      border: 1px solid var(--line-soft);
      background: linear-gradient(120deg, rgba(244, 184, 96, 0.06), rgba(109, 168, 255, 0.045));
      border-radius: var(--radius);
      padding: 14px 16px;
      margin-bottom: 18px;
    }
    .command-bar .controls { justify-content: flex-start; }
    .command-bar input { min-width: 250px; }
    .hint { color: var(--muted-2); font-size: 11px; line-height: 1.5; }
    .grid { display: grid; grid-template-columns: repeat(12, 1fr); gap: 16px; }
    .card {
      background: linear-gradient(180deg, rgba(20, 28, 40, 0.94), rgba(13, 19, 28, 0.94));
      border: 1px solid var(--line-soft);
      border-radius: var(--radius);
      padding: 20px;
      box-shadow: var(--shadow);
      position: relative;
      overflow: hidden;
    }
    .card::before {
      content: "";
      position: absolute;
      inset: 0 auto auto 0;
      width: 100%;
      height: 1px;
      background: linear-gradient(90deg, transparent, rgba(244, 184, 96, 0.34), transparent);
      opacity: 0.55;
    }
    .card.teal::before { background: linear-gradient(90deg, transparent, rgba(67, 214, 180, 0.45), transparent); }
    .card.blue::before { background: linear-gradient(90deg, transparent, rgba(109, 168, 255, 0.45), transparent); }
    .card.violet::before { background: linear-gradient(90deg, transparent, rgba(185, 156, 255, 0.45), transparent); }
    .card.coral::before { background: linear-gradient(90deg, transparent, rgba(255, 111, 125, 0.45), transparent); }
    .span-8 { grid-column: span 8; }
    .span-4 { grid-column: span 4; }
    .span-6 { grid-column: span 6; }
    .span-12 { grid-column: span 12; }
    .eyebrow {
      color: var(--muted-2);
      text-transform: uppercase;
      letter-spacing: 0.16em;
      font-size: 10px;
      font-weight: 800;
    }
    .card h3 { margin: 7px 0 0; font-size: 19px; letter-spacing: -0.025em; }
    .stat { font-size: 34px; font-weight: 800; letter-spacing: -0.06em; margin: 12px 0 4px; font-variant-numeric: tabular-nums; }
    .muted { color: var(--muted); font-size: 12px; line-height: 1.55; }
    .muted-2 { color: var(--muted-2); font-size: 11px; line-height: 1.5; }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 5px 9px;
      border-radius: 999px;
      font-size: 10px;
      font-weight: 800;
      letter-spacing: 0.03em;
      background: var(--blue-soft);
      color: var(--blue);
      border: 1px solid rgba(109, 168, 255, 0.24);
      white-space: nowrap;
    }
    .badge.ok { background: var(--teal-soft); color: var(--teal); border-color: rgba(67, 214, 180, 0.25); }
    .badge.warn { background: var(--gold-soft); color: var(--gold); border-color: rgba(244, 184, 96, 0.28); }
    .badge.bad { background: var(--coral-soft); color: var(--coral); border-color: rgba(255, 111, 125, 0.26); }
    .badge.violet { background: var(--violet-soft); color: var(--violet); border-color: rgba(185, 156, 255, 0.26); }
    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 7px;
      padding: 6px 10px;
      border-radius: 999px;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.04em;
      background: var(--surface-3);
      color: var(--muted);
      border: 1px solid var(--line);
    }
    .status-pill::before { content: ""; width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
    .status-pill.st-run { background: var(--teal-soft); color: var(--teal); border-color: rgba(67, 214, 180, 0.25); }
    .status-pill.st-warn { background: var(--gold-soft); color: var(--gold); border-color: rgba(244, 184, 96, 0.28); }
    .status-pill.st-bad { background: var(--coral-soft); color: var(--coral); border-color: rgba(255, 111, 125, 0.26); }
    .status-pill.st-done { background: var(--blue-soft); color: var(--blue); border-color: rgba(109, 168, 255, 0.25); }
    .status-pill.st-idle { background: var(--surface-3); color: var(--muted); }
    .list { display: grid; gap: 9px; margin-top: 15px; }
    .row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      background: rgba(255, 255, 255, 0.025);
      border: 1px solid rgba(255, 255, 255, 0.055);
      border-radius: 12px;
      padding: 12px 13px;
    }
    .row strong { display: block; font-size: 13px; }
    .row small { color: var(--muted); display: block; margin-top: 3px; word-break: break-all; line-height: 1.45; }
    .row-actions { display: flex; gap: 7px; flex-shrink: 0; flex-wrap: wrap; }
    .empty {
      border: 1px dashed var(--line);
      border-radius: 12px;
      padding: 24px;
      text-align: center;
      color: var(--muted);
      margin-top: 15px;
      font-size: 12px;
      line-height: 1.6;
    }
    .empty strong { color: var(--text); display: block; margin-bottom: 4px; font-size: 13px; }
    table { width: 100%; border-collapse: collapse; margin-top: 14px; font-size: 12px; }
    th {
      text-align: left;
      color: var(--muted-2);
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      padding: 9px 8px;
      border-bottom: 1px solid var(--line);
      white-space: nowrap;
    }
    td { padding: 11px 8px; border-bottom: 1px solid rgba(255, 255, 255, 0.045); vertical-align: top; }
    tr:last-child td { border-bottom: 0; }
    tbody tr:hover { background: rgba(255, 255, 255, 0.022); }
    .mono { font-family: var(--mono); font-size: 10px; color: var(--muted-2); letter-spacing: -0.01em; }
    .toast {
      position: fixed;
      right: 24px;
      bottom: 24px;
      max-width: 430px;
      padding: 14px 16px;
      border-radius: 12px;
      background: #121a25;
      border: 1px solid var(--line);
      border-left: 3px solid var(--gold);
      box-shadow: var(--shadow);
      opacity: 0;
      transform: translateY(12px);
      pointer-events: none;
      transition: all 0.2s ease;
      font-size: 12px;
      line-height: 1.5;
      z-index: 10;
    }
    .toast.show { opacity: 1; transform: translateY(0); }
    .toast.error { border-left-color: var(--coral); color: #ffd7dc; }
    .tag { display: inline-block; padding: 3px 7px; border-radius: 7px; background: rgba(255, 255, 255, 0.06); font-size: 10px; }
    .sep { height: 1px; background: var(--line-soft); margin: 14px 0; }
    .mission { margin-bottom: 18px; }
    .mission-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
    .mission h2 { margin: 7px 0 0; font-size: clamp(24px, 3vw, 34px); letter-spacing: -0.05em; line-height: 1.05; }
    .mission-meta { margin: 8px 0 0; color: var(--muted); font-size: 12px; line-height: 1.55; }
    .mission-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 15px; }
    .stepper { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin-top: 18px; }
    .step { position: relative; padding-top: 22px; color: var(--muted-2); font-size: 10px; font-weight: 700; letter-spacing: 0.03em; }
    .step::before {
      content: "";
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 3px;
      border-radius: 99px;
      background: var(--line);
    }
    .step.done::before { background: var(--teal); }
    .step.current::before { background: var(--gold); box-shadow: 0 0 14px rgba(244, 184, 96, 0.35); }
    .step.done { color: var(--teal); }
    .step.current { color: var(--gold); }
    .step small { display: block; color: var(--muted-2); font-size: 9px; font-weight: 500; margin-top: 3px; letter-spacing: 0; }
    .next-action {
      margin-top: 16px;
      border: 1px solid rgba(244, 184, 96, 0.32);
      background: linear-gradient(120deg, rgba(244, 184, 96, 0.12), rgba(244, 184, 96, 0.035));
      border-radius: 12px;
      padding: 13px 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      flex-wrap: wrap;
    }
    .next-action strong { display: block; font-size: 12px; color: var(--gold); }
    .next-action span { display: block; color: var(--muted); font-size: 11px; margin-top: 2px; line-height: 1.45; }
    .metrics { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .metric {
      border: 1px solid var(--line-soft);
      border-radius: 12px;
      padding: 12px;
      background: rgba(255, 255, 255, 0.024);
      min-width: 0;
    }
    .metric span { display: block; color: var(--muted-2); font-size: 9px; text-transform: uppercase; letter-spacing: 0.12em; font-weight: 800; }
    .metric strong { display: block; margin-top: 6px; font-size: 22px; letter-spacing: -0.04em; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
    .metric small { display: block; color: var(--muted-2); font-size: 10px; margin-top: 2px; }
    .metric.tone-teal strong { color: var(--teal); }
    .metric.tone-gold strong { color: var(--gold); }
    .metric.tone-blue strong { color: var(--blue); }
    .metric.tone-violet strong { color: var(--violet); }
    .section { margin-top: 30px; }
    .section-head { display: flex; align-items: flex-start; gap: 13px; margin-bottom: 12px; }
    .section-num {
      width: 30px;
      height: 30px;
      border-radius: 9px;
      display: grid;
      place-items: center;
      flex: none;
      background: var(--surface-2);
      border: 1px solid var(--line);
      color: var(--gold);
      font-size: 11px;
      font-weight: 900;
    }
    .section-head h2 { margin: 0; font-size: 17px; letter-spacing: -0.025em; }
    .section-head p { margin: 4px 0 0; color: var(--muted); font-size: 12px; line-height: 1.5; max-width: 760px; }
    .section-tag { margin-left: auto; align-self: center; }
    .usage-bar { height: 6px; border-radius: 99px; background: var(--line-soft); overflow: hidden; margin-top: 5px; min-width: 90px; }
    .usage-bar > i { display: block; height: 100%; border-radius: 99px; background: linear-gradient(90deg, var(--teal), var(--blue)); }
    .usage-bar.provider > i { background: linear-gradient(90deg, var(--gold), var(--teal)); }
    .usage-bar.estimate > i { background: linear-gradient(90deg, var(--violet), var(--blue)); }
    .agent-chip { display: inline-flex; align-items: center; gap: 7px; }
    .agent-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--violet); flex: none; }
    .help {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      border: 1px solid var(--line);
      color: var(--muted-2);
      font-size: 10px;
      font-weight: 800;
      cursor: help;
      margin-left: 4px;
    }
    .form-grid { display: grid; gap: 9px; margin-top: 12px; }
    .form-grid .controls { justify-content: flex-start; }
    .form-grid input, .form-grid textarea { width: 100%; min-width: 0; }
    .split-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 9px; }
    @media (max-width: 1100px) {
      .shell { grid-template-columns: 1fr; }
      aside { position: static; height: auto; flex-direction: row; align-items: center; flex-wrap: wrap; padding: 16px 18px; gap: 14px; }
      .brand { margin-right: auto; }
      .nav { display: flex; flex-wrap: nowrap; overflow-x: auto; order: 4; width: 100%; }
      .nav a { white-space: nowrap; padding: 8px 10px; }
      .sidebar-section, .sidebar-note, .sidebar-foot { display: none; }
      .span-8, .span-4, .span-6 { grid-column: span 12; }
      main { padding-top: 22px; }
    }
    @media (max-width: 720px) {
      .topbar { flex-direction: column; }
      .top-actions { justify-content: flex-start; }
      .stepper { grid-template-columns: 1fr; gap: 6px; }
      .step { padding: 8px 0 8px 16px; }
      .step::before { top: 0; bottom: 0; left: 0; right: auto; width: 3px; height: auto; }
      .metrics { grid-template-columns: 1fr; }
      .split-2 { grid-template-columns: 1fr; }
      table { display: block; overflow-x: auto; white-space: nowrap; }
      .command-bar input { min-width: 0; width: 100%; }
      .command-bar .controls { width: 100%; }
    }
    .agent-reply-note { margin-top:14px; padding:10px 12px; border-radius:10px; background: rgba(109,168,255,.06); border:1px solid rgba(109,168,255,.18); color: var(--muted); font-size:11px; line-height:1.5; }
    .agent-chat { display:grid; gap:10px; margin-top:16px; max-height:520px; overflow:auto; padding-right:4px; }
    .chat-msg { border:1px solid var(--line-soft); border-radius:12px; padding:11px 13px; max-width:94%; background: rgba(255,255,255,.025); }
    .chat-msg.user { margin-left:auto; border-color: rgba(244,184,96,.3); background: rgba(244,184,96,.075); }
    .chat-msg.assistant { border-color: rgba(67,214,180,.2); background: rgba(67,214,180,.05); }
    .chat-msg.system { border-style:dashed; opacity:.82; }
    .chat-msg .role { font-size:9px; text-transform:uppercase; letter-spacing:.13em; font-weight:800; color:var(--muted-2); }
    .chat-msg p { margin:5px 0 0; white-space:pre-wrap; overflow-wrap:anywhere; line-height:1.55; font-size:12px; color:var(--text); }
    .chat-msg .meta { margin-top:7px; color:var(--muted-2); font-size:10px; font-family:var(--mono); }
    .session-card { cursor:pointer; border:1px solid var(--line-soft); border-radius:12px; padding:12px; background:rgba(255,255,255,.025); transition:border-color .15s ease, background .15s ease; }
    .session-card:hover { border-color:var(--gold); background:rgba(244,184,96,.045); }
    .session-card.selected { border-color:var(--gold); background:rgba(244,184,96,.08); box-shadow:0 0 0 1px rgba(244,184,96,.18); }
    .session-top { display:flex; justify-content:space-between; gap:8px; align-items:flex-start; }
    .session-name { font-size:13px; font-weight:800; letter-spacing:-0.01em; }
    .session-purpose { color:var(--muted-2); font-size:10px; margin-top:2px; text-transform:uppercase; letter-spacing:.06em; }
    .session-stats { display:flex; gap:9px; margin-top:8px; color:var(--muted-2); font-size:10px; flex-wrap:wrap; }
    .role-specialist { color:var(--teal); }
    .role-judge { color:var(--violet); }
    .role-feedback { color:var(--gold); }
    .role-coordinator { color:var(--blue); }
    .role-parent { color:var(--gold); }
    @media (prefers-reduced-motion: reduce) {
      * { scroll-behavior: auto !important; transition: none !important; }
    }
`
