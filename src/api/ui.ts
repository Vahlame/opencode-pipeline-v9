export function renderUi(): string {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>OpenCode Orchestrator</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #07111f;
      --bg-2: #0b1728;
      --panel: rgba(15, 29, 48, 0.86);
      --panel-2: #10233a;
      --line: #1f3b57;
      --text: #e8f1fa;
      --muted: #8aa4bd;
      --accent: #35d0a5;
      --accent-2: #64a8ff;
      --warn: #ffbf5a;
      --bad: #ff6b7a;
      --ok: #35d0a5;
      --radius: 18px;
      --shadow: 0 18px 60px rgba(0, 0, 0, 0.34);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      color: var(--text);
      background:
        radial-gradient(900px 500px at 10% -10%, rgba(53, 208, 165, 0.14), transparent 60%),
        radial-gradient(900px 500px at 95% 0%, rgba(100, 168, 255, 0.13), transparent 55%),
        var(--bg);
    }
    button, input, select { font: inherit; }
    button { cursor: pointer; border: 0; }
    button:focus-visible, a:focus-visible, input:focus-visible, select:focus-visible {
      outline: 2px solid var(--accent-2); outline-offset: 2px;
    }
    .shell { display: grid; grid-template-columns: 260px 1fr; min-height: 100vh; }
    aside {
      border-right: 1px solid var(--line);
      background: rgba(5, 14, 25, 0.72);
      padding: 28px 20px;
      display: flex; flex-direction: column; gap: 26px;
      position: sticky; top: 0; height: 100vh;
    }
    .brand { display: flex; align-items: center; gap: 12px; }
    .mark {
      width: 42px; height: 42px; border-radius: 13px;
      display: grid; place-items: center; font-weight: 800; letter-spacing: -1px;
      background: linear-gradient(135deg, var(--accent), var(--accent-2));
      color: #041018;
    }
    .brand h1 { margin: 0; font-size: 15px; line-height: 1.2; }
    .brand p { margin: 3px 0 0; color: var(--muted); font-size: 12px; }
    .nav { display: grid; gap: 7px; }
    .nav a {
      color: var(--muted); text-decoration: none; padding: 10px 12px; border-radius: 11px;
      font-size: 13px;
    }
    .nav a:hover { color: var(--text); background: rgba(255,255,255,0.05); }
    .sidebar-note { margin-top: auto; color: var(--muted); font-size: 12px; line-height: 1.6; }
    main { padding: 30px clamp(20px, 4vw, 54px) 70px; max-width: 1450px; width: 100%; }
    .topbar { display: flex; align-items: end; justify-content: space-between; gap: 20px; margin-bottom: 24px; }
    .topbar h2 { margin: 0; font-size: clamp(26px, 3vw, 38px); letter-spacing: -0.04em; }
    .topbar p { margin: 8px 0 0; color: var(--muted); }
    .controls { display: flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end; }
    input, select {
      background: var(--panel-2); color: var(--text); border: 1px solid var(--line);
      border-radius: 11px; padding: 11px 13px; min-width: 210px; outline: none;
    }
    input:focus, select:focus { border-color: var(--accent-2); box-shadow: 0 0 0 3px rgba(100,168,255,0.14); }
    .btn {
      padding: 11px 15px; border-radius: 11px; background: var(--accent); color: #041018;
      font-weight: 700; transition: transform .15s ease, filter .15s ease;
    }
    .btn:hover { filter: brightness(1.08); transform: translateY(-1px); }
    .btn.secondary { background: #1a3550; color: var(--text); }
    .btn.danger { background: var(--bad); color: #210409; }
    .btn.ghost { background: transparent; color: var(--muted); border: 1px solid var(--line); }
    .grid { display: grid; grid-template-columns: repeat(12, 1fr); gap: 16px; }
    .card {
      background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius);
      padding: 20px; box-shadow: var(--shadow); backdrop-filter: blur(10px);
    }
    .span-8 { grid-column: span 8; }
    .span-4 { grid-column: span 4; }
    .span-6 { grid-column: span 6; }
    .span-12 { grid-column: span 12; }
    @media (max-width: 1000px) {
      .shell { grid-template-columns: 1fr; }
      aside { position: static; height: auto; flex-direction: row; align-items: center; flex-wrap: wrap; }
      .nav { display: flex; flex-wrap: wrap; }
      .sidebar-note { display: none; }
      .span-8, .span-4, .span-6 { grid-column: span 12; }
    }
    .eyebrow { color: var(--muted); text-transform: uppercase; letter-spacing: .14em; font-size: 11px; font-weight: 700; }
    .card h3 { margin: 7px 0 0; font-size: 19px; letter-spacing: -0.02em; }
    .stat { font-size: 31px; font-weight: 800; letter-spacing: -0.05em; margin: 13px 0 4px; }
    .muted { color: var(--muted); font-size: 13px; line-height: 1.55; }
    .badge {
      display: inline-flex; padding: 5px 9px; border-radius: 999px; font-size: 11px; font-weight: 800;
      background: rgba(100,168,255,.12); color: #9bc7ff; border: 1px solid rgba(100,168,255,.22);
    }
    .badge.ok { background: rgba(53,208,165,.12); color: var(--ok); border-color: rgba(53,208,165,.22); }
    .badge.warn { background: rgba(255,191,90,.12); color: var(--warn); border-color: rgba(255,191,90,.22); }
    .badge.bad { background: rgba(255,107,122,.12); color: var(--bad); border-color: rgba(255,107,122,.22); }
    .list { display: grid; gap: 10px; margin-top: 16px; }
    .row {
      display: flex; align-items: center; justify-content: space-between; gap: 14px;
      background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.06);
      border-radius: 13px; padding: 12px 14px;
    }
    .row strong { display: block; font-size: 13px; }
    .row small { color: var(--muted); display: block; margin-top: 3px; word-break: break-all; }
    .row-actions { display: flex; gap: 8px; flex-shrink: 0; }
    .empty { border: 1px dashed var(--line); border-radius: 13px; padding: 22px; text-align: center; color: var(--muted); margin-top: 16px; }
    table { width: 100%; border-collapse: collapse; margin-top: 15px; font-size: 13px; }
    th { text-align: left; color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .1em; padding: 9px 8px; border-bottom: 1px solid var(--line); }
    td { padding: 11px 8px; border-bottom: 1px solid rgba(255,255,255,.05); }
    tr:last-child td { border-bottom: 0; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; color: var(--muted); }
    .toast {
      position: fixed; right: 25px; bottom: 25px; max-width: 420px; padding: 14px 18px;
      border-radius: 13px; background: #10233a; border: 1px solid var(--line); box-shadow: var(--shadow);
      opacity: 0; transform: translateY(12px); pointer-events: none; transition: all .2s ease;
      font-size: 13px; line-height: 1.5;
    }
    .toast.show { opacity: 1; transform: translateY(0); }
    .toast.error { border-color: rgba(255,107,122,.45); color: #ffd3d8; }
    .tag { display: inline-block; padding: 3px 7px; border-radius: 7px; background: rgba(255,255,255,.06); font-size: 10px; }
    .sep { height: 1px; background: var(--line); margin: 14px 0; }
  </style>
</head>
<body>
  <div class="shell">
    <aside>
      <div class="brand">
        <div class="mark">O9</div>
        <div><h1>Orchestrator V9</h1><p>Control room local</p></div>
      </div>
      <nav class="nav">
        <a href="#overview">Resumen</a>
        <a href="#approval">Aprobacion</a>
        <a href="#feedback">Feedback</a>
        <a href="#recovery">Recuperacion</a>
        <a href="#delivery">Entrega</a>
      </nav>
      <div class="sidebar-note">
        API local. El token no se guarda en el servidor.<br><br>
        La GUI no sustituye la revision de seguridad ni la aprobacion humana.
      </div>
    </aside>
    <main>
      <div class="topbar">
        <div>
          <div class="eyebrow">Operacion y supervision</div>
          <h2>Control room</h2>
          <p>Estado, jurado, integracion, recuperacion y entrega en un solo lugar.</p>
        </div>
        <div class="controls">
          <input id="project" placeholder="Project ID" aria-label="Project ID" autocomplete="off" />
          <input id="token" placeholder="Bearer token" aria-label="Bearer token" type="password" autocomplete="off" />
          <button class="btn" type="button" onclick="load()">Cargar</button>
          <span class="muted" id="load-state" aria-live="polite">Sin datos</span>
        </div>
      </div>

      <section id="overview" class="grid">
        <div class="card span-8">
          <div class="eyebrow">Proyecto</div>
          <h3 id="project-name">Sin proyecto cargado</h3>
          <div class="stat" id="project-status">--</div>
          <div class="muted" id="project-meta">Introduce un Project ID y un token para empezar.</div>
          <div class="sep"></div>
          <div class="row"><div><strong>Tareas</strong><small id="task-summary">--</small></div><span class="badge" id="task-badge">--</span></div>
          <div class="row"><div><strong>Modulos</strong><small id="module-summary">--</small></div><span class="badge" id="module-badge">--</span></div>
          <div class="row"><div><strong>Bloqueos</strong><small id="blocker-summary">--</small></div><span class="badge" id="blocker-badge">--</span></div>
        </div>
        <div class="card span-4">
          <div class="eyebrow">Recursos</div>
          <h3>Presupuesto estimado</h3>
          <div class="stat" id="token-count">0</div>
          <div class="muted">tokens registrados</div>
          <div class="list">
            <div class="row"><div><strong>Coste</strong><small id="cost-value">0 USD</small></div></div>
            <div class="row"><div><strong>Tiempo</strong><small id="time-value">0 min</small></div></div>
          </div>
        </div>
        <div class="card span-12">
          <div class="eyebrow">Tareas y dependencias</div>
          <h3>Ejecucion</h3>
          <table><thead><tr><th>Estado</th><th>Tarea</th><th>Modulo</th><th>Dependencias</th></tr></thead><tbody id="tasks"></tbody></table>
        </div>
      </section>

      <section id="usage" class="grid" style="margin-top:16px">
        <div class="card span-12">
          <div class="eyebrow">Contabilidad</div>
          <h3>Tokens por subagente, tarea y proposito</h3>
          <div class="muted">Datos exactos reportados por OpenCode; si falta usage se muestra la estimacion.</div>
          <div class="controls" style="margin-top:12px">
            <select id="usage-by" aria-label="Agrupar uso" onchange="renderUsage()">
              <option value="agent">Por subagente</option>
              <option value="task">Por tarea</option>
              <option value="purpose">Por proposito</option>
            </select>
            <span class="muted" id="usage-total"></span>
          </div>
          <table>
            <thead><tr><th>Clave</th><th>Fuente</th><th>Entrada</th><th>Salida</th><th>Coste</th><th>Registros</th></tr></thead>
            <tbody id="usage-rows"><tr><td colspan="6" class="muted">Sin datos de uso.</td></tr></tbody>
          </table>
        </div>
      </section>

      <section id="approval" class="grid" style="margin-top:16px">
        <div class="card span-6">
          <div class="eyebrow">Aprobacion</div>
          <h3>Plan humano</h3>
          <div class="list" id="plans"></div>
        </div>
        <div class="card span-6">
          <div class="eyebrow">Integracion</div>
          <h3>Manifiesto y adaptadores</h3>
          <div class="list" id="integrations"></div>
        </div>
      </section>

      <section id="feedback" class="grid" style="margin-top:16px">
        <div class="card span-6">
          <div class="eyebrow">Evaluacion global</div>
          <h3>Feedback</h3>
          <div class="list" id="feedback-list"></div>
        </div>
        <div class="card span-6">
          <div class="eyebrow">Jurado</div>
          <h3>Dictamenes</h3>
          <div class="list" id="jury-list"></div>
        </div>
      </section>

      <section id="recovery" class="grid" style="margin-top:16px">
        <div class="card span-8">
          <div class="eyebrow">Robustez</div>
          <h3>Recuperacion</h3>
          <div class="muted">Diagnostico de sesiones, leases, tareas, worktrees, integraciones y feedback interrumpidos.</div>
          <div class="list">
            <div class="row"><div><strong>Diagnostico</strong><small>No modifica estado operativo.</small></div><div class="row-actions"><button class="btn secondary" type="button" onclick="recovery(false)">Diagnosticar</button></div></div>
            <div class="row"><div><strong>Aplicar recuperacion</strong><small>Aplica solo acciones seguras. Requiere confirmacion.</small></div><div class="row-actions"><button class="btn" type="button" onclick="recovery(true)">Aplicar recuperacion</button></div></div>
          </div>
          <div class="list" id="recovery-list"></div>
        </div>
        <div class="card span-4">
          <div class="eyebrow">Bandeja</div>
          <h3>Mensajes y outbox</h3>
          <div class="stat" id="queued-count">0</div>
          <div class="muted">mensajes encolados</div>
          <div class="row" style="margin-top:16px"><div><strong>Outbox pendiente</strong><small id="outbox-count">0</small></div></div>
        </div>
      </section>

      <section id="delivery" class="grid" style="margin-top:16px">
        <div class="card span-12">
          <div class="eyebrow">Salida</div>
          <h3>Entrega final</h3>
          <div class="muted">Solo se prepara con feedback PASS. La finalizacion requiere aprobacion humana.</div>
          <div class="list" id="delivery-list"></div>
        </div>
      </section>
    </main>
  </div>
  <div class="toast" id="toast" role="status" aria-live="polite"></div>
  <script>
    const $ = (id) => document.getElementById(id);
    const state = { projectId: '', token: '', data: null };
    const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    function toast(message, error = false) {
      const el = $('toast');
      el.textContent = message;
      el.setAttribute('aria-live', error ? 'assertive' : 'polite');
      el.className = 'toast show' + (error ? ' error' : '');
      setTimeout(() => { el.className = 'toast'; }, 5200);
    }
    function badge(value, kind = '') { return '<span class="badge ' + kind + '">' + esc(value) + '</span>'; }
    function statusKind(value) {
      if (['COMPLETED','PASS','DELIVERED','INTEGRATED','APPROVED','SUCCEEDED'].includes(value)) return 'ok';
      if (['FAILED','FAIL','REJECTED','CANCELLED','STRUCTURAL_FAILED'].includes(value)) return 'bad';
      if (['PAUSED','BLOCKED','REWORK_REQUIRED','INCOMPLETE'].includes(value)) return 'warn';
      return '';
    }
    async function api(path, options = {}) {
      const headers = new Headers(options.headers || {});
      headers.set('authorization', 'Bearer ' + state.token);
      if (options.body) headers.set('content-type', 'application/json');
      const res = await fetch(path, { ...options, headers });
      const text = await res.text();
      let body;
      try { body = JSON.parse(text); } catch { body = text; }
      if (!res.ok) throw new Error((body && body.error && body.error.message) || body || res.statusText);
      return body;
    }
    async function load() {
      state.projectId = $('project').value.trim();
      state.token = $('token').value.trim();
      sessionStorage.setItem('orch-token', state.token);
      if (!state.projectId || !state.token) return toast('Project ID y token son obligatorios', true);
      $('load-state').textContent = 'Cargando...';
      try {
        const [stateData, plans, feedback, deliveries, integrations, recovery, usage] = await Promise.all([
          api('/api/state?projectId=' + encodeURIComponent(state.projectId)),
          api('/api/plans?projectId=' + encodeURIComponent(state.projectId)),
          api('/api/feedback?projectId=' + encodeURIComponent(state.projectId)),
          api('/api/deliveries?projectId=' + encodeURIComponent(state.projectId)),
          api('/api/integrations?projectId=' + encodeURIComponent(state.projectId)),
          api('/api/recovery/history?projectId=' + encodeURIComponent(state.projectId)),
          api('/api/usage?projectId=' + encodeURIComponent(state.projectId)),
        ]);
        state.data = { stateData, plans, feedback, deliveries, integrations, recovery, usage };
        render();
        $('load-state').textContent = 'Actualizado ' + new Date().toLocaleTimeString();
        toast('Estado actualizado');
      } catch (error) { $('load-state').textContent = 'Error de carga'; toast(error.message, true); }
    }
    function render() {
      const { stateData: data, plans, feedback, deliveries, integrations, recovery } = state.data;
      const p = data.project;
      $('project-name').textContent = p.name;
      $('project-status').textContent = p.status;
      $('project-meta').textContent = 'Plan aprobado: ' + ((plans.find(x => x.status === 'APPROVED') || {}).title || 'pendiente') + ' | ID ' + p.id;
      $('task-summary').textContent = data.tasks.length + ' tareas';
      $('task-badge').textContent = data.tasks.filter(t => ['BLOCKED','FAILED','PAUSED'].includes(t.state)).length + ' bloqueadas';
      $('task-badge').className = 'badge ' + (data.blockers.length ? 'warn' : 'ok');
      $('module-summary').textContent = data.modules.length + ' modulos';
      $('module-badge').textContent = data.modules.filter(m => m.status === 'INTEGRATED').length + ' integrados';
      $('module-badge').className = 'badge ok';
      $('blocker-summary').textContent = data.blockers.length ? data.blockers.join(', ') : 'Sin bloqueos activos';
      $('blocker-badge').textContent = data.blockers.length ? 'atencion' : 'limpio';
      $('blocker-badge').className = 'badge ' + (data.blockers.length ? 'warn' : 'ok');
      $('tasks').innerHTML = data.tasks.length ? data.tasks.map(t =>
        '<tr><td>' + badge(t.state, statusKind(t.state)) + '</td><td><strong>' + esc(t.title) + '</strong><div class="mono">' + esc(t.id) + '</div></td><td>' + esc(t.moduleId || '—') + '</td><td class="mono">' + esc((t.dependencies || []).join(', ') || '—') + '</td></tr>'
      ).join('') : '<tr><td colspan="4" class="muted">Sin tareas.</td></tr>';
      const res = data.resources || {};
      $('token-count').textContent = res.totalTokens || 0;
      $('cost-value').textContent = (res.estimatedCostUsd || 0) + ' USD';
      $('time-value').textContent = (res.elapsedMinutes || 0) + ' min';
      $('queued-count').textContent = data.messages ? data.messages.queued : 0;
      $('outbox-count').textContent = data.messages ? data.messages.outboxPending : 0;
      $('plans').innerHTML = plans.length ? plans.map(plan =>
        '<div class="row"><div><strong>' + esc(plan.title) + ' ' + badge(plan.status, statusKind(plan.status)) + '</strong><small class="mono">' + esc(plan.hash) + '</small></div><div class="row-actions">' +
        (plan.status === 'PROPOSED' ? '<button class="btn" onclick="approvePlan(\\'' + plan.id + '\\',\\'' + plan.hash + '\\')">Aprobar</button>' : '') +
        '</div></div>'
      ).join('') : '<div class="empty">Sin planes.</div>';
      $('integrations').innerHTML = integrations.length ? integrations.map(run =>
        '<div class="row"><div><strong>' + esc(run.status) + '</strong><small>' + esc(run.id) + ' · intento ' + run.attempt + '</small></div>' + badge(run.manifestHash ? 'manifiesto' : 'sin manifiesto', run.manifestHash ? 'ok' : 'warn') + '</div>'
      ).join('') : '<div class="empty">Sin integraciones.</div>';
      $('feedback-list').innerHTML = feedback.length ? feedback.map(f =>
        '<div class="row"><div><strong>' + esc(f.verdict || f.status) + '</strong><small>' + esc(f.id) + ' · ' + esc(f.manifestId) + '</small></div>' + badge(f.verdict || f.status, statusKind(f.verdict)) + '</div>'
      ).join('') : '<div class="empty">Sin feedback.</div>';
      $('jury-list').innerHTML = data.reviews && data.reviews.length ? data.reviews.slice(0, 12).map(r =>
        '<div class="row"><div><strong>' + esc(r.judgeRole) + '</strong><small>' + esc(r.moduleVersionId) + '</small></div>' + badge(r.verdict, statusKind(r.verdict)) + '</div>'
      ).join('') : '<div class="empty">Sin dictamenes.</div>';
      $('recovery-list').innerHTML = recovery.length ? recovery.slice(0, 5).map(r =>
        '<div class="row"><div><strong>' + esc(r.mode) + ' · ' + esc(r.status) + '</strong><small>' + esc(r.id) + ' · ' + r.findingsCount + ' hallazgos · ' + r.appliedCount + ' aplicados</small></div>' + badge(r.status, statusKind(r.status)) + '</div>'
      ).join('') : '';
      $('delivery-list').innerHTML = deliveries.length ? deliveries.map(d =>
        '<div class="row"><div><strong>' + esc(d.id) + ' ' + badge(d.status, statusKind(d.status)) + '</strong><small>manifest ' + esc(d.manifestId) + '</small></div><div class="row-actions">' +
        (d.status === 'READY' ? '<button class="btn" onclick="finalizeDelivery(\\'' + d.id + '\\')">Finalizar</button>' : '') +
        '</div></div>'
      ).join('') : '<div class="empty">Aun no hay entrega final.</div>';
      renderUsage();
    }
    function renderUsage() {
      const by = $('usage-by').value;
      const groups = (state.data && state.data.usage && state.data.usage.groups) || [];
      const group = groups.find((candidate) => candidate.by === by);
      const rows = group ? group.rows : [];
      const totals = rows.reduce((acc, row) => {
        acc.input += row.inputTokens;
        acc.output += row.outputTokens;
        acc.cost += row.costUsd;
        return acc;
      }, { input: 0, output: 0, cost: 0 });
      $('usage-total').textContent = rows.length
        ? 'in ' + totals.input + ' · out ' + totals.output + ' · ' + totals.cost + ' USD'
        : '';
      $('usage-rows').innerHTML = rows.length ? rows.map(row =>
        '<tr><td><strong>' + esc(row.label) + '</strong><div class="mono">' + esc(row.key) + '</div></td>' +
        '<td>' + badge(row.source, row.source === 'provider' ? 'ok' : 'warn') + '</td>' +
        '<td class="mono">' + row.inputTokens + '</td><td class="mono">' + row.outputTokens + '</td>' +
        '<td class="mono">' + row.costUsd + ' USD</td><td>' + row.entries + '</td></tr>'
      ).join('') : '<tr><td colspan="6" class="muted">Sin datos de uso.</td></tr>';
    }
    async function approvePlan(planId, hash) {
      try {
        await api('/api/plans/' + planId + '/approve', { method: 'POST', body: JSON.stringify({ hash }) });
        toast('Plan aprobado');
        load();
      } catch (e) { toast(e.message, true); }
    }
    async function finalizeDelivery(deliveryId) {
      if (!confirm('Confirmas la aprobacion humana de esta entrega?')) return;
      try {
        await api('/api/deliveries/' + deliveryId + '/finalize', { method: 'POST', body: '{}' });
        toast('Entrega finalizada');
        load();
      } catch (e) { toast(e.message, true); }
    }
    async function recovery(apply) {
      if (apply && !confirm('Aplicar recuperacion sobre ' + state.projectId + '?\nSe modificaran leases/tareas/estados solo en acciones seguras. Esta accion queda auditada.')) return;
      try {
        const result = await api('/api/recovery/run?projectId=' + encodeURIComponent(state.projectId), { method: 'POST', body: JSON.stringify({ apply }) });
        toast('Recuperacion: ' + result.actions.length + ' hallazgos, ' + result.applied + ' aplicados');
        load();
      } catch (e) { toast(e.message, true); }
    }
    $('token').value = sessionStorage.getItem('orch-token') || '';
  </script>
</body>
</html>`
}
