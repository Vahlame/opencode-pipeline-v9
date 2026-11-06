import { uiStyles } from './ui-styles.js'

export function renderUi(): string {
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>OpenCode Orchestrator</title>
  <style>${uiStyles}</style>
</head>
<body>
  <div class="shell">
    <aside>
      <div class="brand">
        <div class="mark">O9</div>
        <div><h1>OpenCode Pipeline</h1><p>Control room V9</p></div>
      </div>
      <div class="sidebar-section">
        <div class="sidebar-label">Proyecto activo</div>
        <select id="project" aria-label="Proyecto" onchange="load()"></select>
        <div style="margin-top:8px"><span id="sidebar-status" class="status-pill st-idle">Sin cargar</span></div>
      </div>
      <nav class="nav">
        <a href="#overview"><span class="idx">1</span> Resumen</a>
        <a href="#agents"><span class="idx">2</span> Agentes</a>
        <a href="#approval"><span class="idx">3</span> Plan</a>
        <a href="#task-builder"><span class="idx">4</span> Ejecucion</a>
        <a href="#feedback"><span class="idx">5</span> Revision</a>
        <a href="#delivery"><span class="idx">6</span> Entrega</a>
      </nav>
      <div class="sidebar-note">
        <strong>Sesion local automatica</strong>
        La GUI obtiene un token humano al abrirse. No hay que pegar secretos.
        <div style="margin-top:9px"><span class="online"><span class="dot"></span> API local conectada</span></div>
      </div>
      <div class="sidebar-foot">v9 &middot; local &middot; sin TLS</div>
    </aside>
    <main>
      <div class="topbar">
        <div>
          <div class="eyebrow">Mission control</div>
          <h1>Pipeline en vivo</h1>
          <p>Un solo lugar para ver el proyecto, entrar en la conversacion de cada agente y decidir el siguiente paso.</p>
        </div>
        <div class="top-actions">
          <button class="btn ghost" type="button" onclick="load()">Actualizar</button>
          <span class="muted" id="load-state" aria-live="polite">Iniciando...</span>
        </div>
      </div>

      <div class="command-bar">
        <div class="controls">
          <input id="new-project-name" placeholder="Nombre del proyecto nuevo" aria-label="Nombre del proyecto nuevo" autocomplete="off" />
          <button class="btn" type="button" onclick="createProject()">Crear proyecto</button>
        </div>
        <div class="hint">Se crea sobre esta carpeta y registra los agentes. Despues: plan, aprobacion, inicio y tareas.</div>
      </div>

      <section id="overview" class="grid mission">
        <div class="card span-8">
          <div class="mission-head">
            <div>
              <div class="eyebrow">Proyecto activo</div>
              <h2 id="project-name">Sin proyecto cargado</h2>
              <p class="mission-meta" id="project-meta">Selecciona o crea un proyecto para empezar.</p>
            </div>
            <span id="project-status" class="status-pill st-idle">--</span>
          </div>

          <div class="stepper" id="workflow-steps">
            <div class="step" data-step="1">Proyecto<small>carpeta y agentes</small></div>
            <div class="step" data-step="2">Plan<small>objetivo y aprobacion</small></div>
            <div class="step" data-step="3">Ejecucion<small>tareas y scheduler</small></div>
            <div class="step" data-step="4">Revision<small>jurado y feedback</small></div>
            <div class="step" data-step="5">Entrega<small>firma y salida</small></div>
          </div>

          <div class="next-action" id="next-action">
            <div>
              <strong id="next-action-title">Siguiente paso</strong>
              <span id="next-action-text">Carga un proyecto para ver que toca hacer.</span>
            </div>
            <div class="row-actions" id="next-action-buttons"></div>
          </div>

          <div class="mission-actions" id="project-actions"></div>

          <div id="plan-builder" style="display:none">
            <div class="sep"></div>
            <div class="eyebrow">Paso 2 &middot; Nuevo plan</div>
            <div class="form-grid">
              <input id="plan-title" placeholder="Titulo del plan" aria-label="Titulo del plan" />
              <textarea id="plan-objective" rows="3" placeholder="Objetivo: que quieres construir y como sabremos que funciona" aria-label="Objetivo del plan"></textarea>
              <div class="controls"><button class="btn" type="button" onclick="createPlan()">Crear plan</button></div>
            </div>
          </div>
        </div>

        <div class="card span-4 teal">
          <div class="eyebrow">Pulso del proyecto</div>
          <h3>Recursos y salud</h3>
          <div class="metrics" style="margin-top:14px">
            <div class="metric tone-teal"><span>Tokens</span><strong id="token-count">0</strong><small>entrada + salida</small></div>
            <div class="metric tone-gold"><span>Coste</span><strong id="cost-value">0 USD</strong><small>estimado</small></div>
            <div class="metric tone-blue"><span>Tiempo</span><strong id="time-value">0 min</strong><small>desde creacion</small></div>
            <div class="metric tone-violet"><span>Tareas</span><strong id="task-summary">0</strong><small id="task-badge">sin bloqueos</small></div>
          </div>
          <div class="sep"></div>
          <div class="row"><div><strong>Modulos</strong><small id="module-summary">--</small></div><span class="badge" id="module-badge">--</span></div>
          <div class="row" style="margin-top:8px"><div><strong>Bloqueos</strong><small id="blocker-summary">--</small></div><span class="badge" id="blocker-badge">--</span></div>
        </div>

        <div class="card span-12 blue">
          <div class="eyebrow">Paso 3 &middot; Ejecucion</div>
          <h3>Tareas y dependencias</h3>
          <div class="muted">Cada fila es una tarea del plan. El estado indica si espera, corre, revisa o ya se integro.</div>
          <table><thead><tr><th>Estado</th><th>Tarea</th><th>Modulo</th><th>Dependencias</th></tr></thead><tbody id="tasks"></tbody></table>
        </div>
      </section>
      <section id="agents" class="section">
        <div class="section-head">
          <div class="section-num">02</div>
          <div>
            <h2>Agentes y conversaciones</h2>
            <p>Aqui ves todas las sesiones que creo el pipeline: especialistas, jurados, feedback y coordinacion. Elige una para leer su conversacion completa.</p>
          </div>
          <div class="section-tag"><button class="btn ghost small" type="button" onclick="loadAgents()">Actualizar</button></div>
        </div>
        <div class="grid" style="margin-bottom:16px">
          <div class="card span-8">
            <div class="eyebrow">Canal humano</div>
            <h3>Habla con el Padre</h3>
            <div class="muted" style="margin-top:5px">El Padre no decide por ti: te cuenta lo que necesitan los agentes y te pide decisiones de diseno, alcance o criterios.</div>
            <div id="parent-chat" class="agent-chat" style="max-height:360px">
              <div class="empty"><strong>Sin conversacion todavia</strong>Escribe abajo para abrir el canal con el Padre.</div>
            </div>
            <div class="chat-compose">
              <textarea id="chat-input" rows="2" placeholder="Escribe una duda, decision o instruccion para el Padre" aria-label="Mensaje para el Padre"></textarea>
              <button class="btn" type="button" id="chat-send" onclick="sendChat()">Enviar</button>
            </div>
            <div class="hint" id="chat-status">El Padre responde con el estado real del proyecto y las preguntas pendientes.</div>
          </div>
          <div class="card span-4 blue">
            <div class="eyebrow">Contexto</div>
            <h3>Lo que ve el Padre</h3>
            <div class="list" id="chat-context">
              <div class="empty">Carga un proyecto para ver el contexto.</div>
            </div>
          </div>
        </div>
        <div class="grid">
          <div class="card span-4">
            <div class="eyebrow">Sesiones registradas</div>
            <div class="muted" style="margin-top:5px">Cada tarjeta es un agente en una tarea o revision. El color indica su rol.</div>
            <div class="list" id="agent-list" style="max-height:620px; overflow:auto">
              <div class="empty"><strong>Sin sesiones todavia</strong>Cuando el scheduler ejecute una tarea, su conversacion aparecera aqui.</div>
            </div>
          </div>
          <div class="card span-8 violet">
            <div class="eyebrow">Conversacion</div>
            <h3 id="agent-title">Selecciona una sesion</h3>
            <div class="muted" id="agent-meta">Veras los mensajes del agente, sus tokens y el resultado de la tarea.</div>
            <div class="row-actions" style="margin-top:8px"><button class="btn ghost small" type="button" onclick="copyAgentId()">Copiar ID de sesion</button></div>
            <div id="agent-transcript" class="agent-chat">
              <div class="empty"><strong>Sin conversacion abierta</strong>Elige una sesion de la izquierda para leerla.</div>
            </div>
            <div class="agent-reply-note" id="agent-reply-note">Esta vista es de lectura. Para responder o continuar la conversacion, abre la sesion en OpenCode Desktop.</div>
          </div>
        </div>
      </section>
      <section id="task-builder" class="section" style="display:none">
        <div class="section-head">
          <div class="section-num">04</div>
          <div>
            <h2>Nueva tarea</h2>
            <p>Una tarea es una unidad de trabajo con un especialista, una ruta permitida y una prueba de aceptacion. El scheduler la ejecuta en un worktree aislado.</p>
          </div>
        </div>
        <div class="card blue">
          <div class="eyebrow">Paso 3 &middot; Asignacion</div>
          <h3>Crear tarea para un especialista</h3>
          <div class="controls" style="margin-top:12px">
            <input id="task-title" placeholder="Titulo de la tarea" aria-label="Titulo de la tarea" />
            <select id="task-owner" aria-label="Especialista"></select>
          </div>
          <textarea id="task-description" rows="2" placeholder="Objetivo o descripcion" aria-label="Objetivo de la tarea" style="width:100%; margin-top:8px"></textarea>
          <div class="controls" style="margin-top:8px">
            <input id="task-paths" placeholder="Rutas permitidas, ej: modules/app/**" aria-label="Rutas permitidas" />
            <input id="task-tests" placeholder="Prueba, ej: node modules/app/demo.test.mjs" aria-label="Prueba de aceptacion" />
            <button class="btn" type="button" onclick="createTask()">Crear tarea</button>
          </div>
        </div>
      </section>

      <section id="usage" class="grid section">
        <div class="section-head span-12">
          <div class="section-num">OBS</div>
          <div>
            <h2>Contabilidad de tokens</h2>
            <p>OpenCode reporta tokens y coste por mensaje. Aqui ves el gasto exacto por subagente, tarea o proposito; si falta usage se muestra la estimacion.</p>
          </div>
        </div>
        <div class="card span-12">
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

      <section id="approval" class="grid section">
        <div class="section-head span-12">
          <div class="section-num">03</div>
          <div>
            <h2>Plan y aprobacion</h2>
            <p>Aprobar un plan es una decision humana. Hasta que pulses Aprobar, el proyecto no puede ejecutar tareas.</p>
          </div>
        </div>
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

      <section id="feedback" class="grid section">
        <div class="section-head span-12">
          <div class="section-num">05</div>
          <div>
            <h2>Revision y entrega</h2>
            <p>El jurado independiente y el feedback global deciden si el trabajo se puede integrar. La entrega final exige PASS y aprobacion humana.</p>
          </div>
        </div>
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

      <section id="recovery" class="grid section">
        <div class="section-head span-12">
          <div class="section-num">SYS</div>
          <div>
            <h2>Recuperacion y mensajes</h2>
            <p>Diagnostica leases, sesiones, tareas y worktrees interrumpidos. Aplicar recuperacion solo ejecuta acciones seguras y queda auditado.</p>
          </div>
        </div>
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

      <section id="delivery" class="grid section">
        <div class="section-head span-12">
          <div class="section-num">06</div>
          <div>
            <h2>Entrega final</h2>
            <p>La salida solo se prepara con feedback PASS. Finalizar una entrega requiere aprobacion humana y deja firma y evidencia.</p>
          </div>
        </div>
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
    const state = { projectId: '', token: '', data: null, sessions: [], selectedSession: '' };
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
    function statusPillClass(value) {
      if (['RUNNING'].includes(value)) return 'st-run';
      if (['COMPLETED','INTEGRATED','DELIVERED','APPROVED','PASS','SUCCEEDED'].includes(value)) return 'st-done';
      if (['PAUSED','BLOCKED','AWAITING_APPROVAL','PLAN_PROPOSED','REWORK_REQUIRED','FAILED','CANCELLED'].includes(value)) return value === 'FAILED' || value === 'CANCELLED' ? 'st-bad' : 'st-warn';
      return 'st-idle';
    }
    function projectRank(status) {
      if (status === 'DRAFT') return 0;
      if (status === 'PLAN_PROPOSED' || status === 'AWAITING_APPROVAL') return 1;
      if (status === 'APPROVED') return 2;
      if (status === 'RUNNING' || status === 'PAUSED') return 3;
      if (status === 'INTEGRATING' || status === 'FEEDBACK') return 4;
      if (status === 'COMPLETED') return 5;
      return -1;
    }
    function stepClass(step, rank) {
      if (rank < 0) return '';
      if (rank >= step + 1) return 'done';
      if (rank === step) return 'current';
      return '';
    }
    function renderNextAction(p, plans, data) {
      const ready = data.tasks.filter((task) => task.state === 'READY').length;
      let title = 'Siguiente paso';
      let text = 'Revisa el estado del proyecto.';
      let buttons = '';
      if (p.status === 'DRAFT') {
        title = 'Paso 1: define el plan';
        text = 'Escribe el objetivo abajo. El plan convierte la idea en trabajo verificable.';
        buttons = '<button class="btn secondary" onclick="document.getElementById(\\'plan-objective\\').focus()">Escribir objetivo</button>';
      } else if (p.status === 'AWAITING_APPROVAL') {
        title = 'Paso 2: aprueba el plan';
        text = 'El plan ya existe. La aprobacion humana es obligatoria antes de ejecutar.';
        buttons = '<button class="btn" onclick="document.getElementById(\\'approval\\').scrollIntoView({behavior:\\'smooth\\'})">Ir a aprobacion</button>';
      } else if (p.status === 'APPROVED') {
        title = 'Paso 3: inicia el proyecto';
        text = 'El plan esta aprobado. Inicia para habilitar tareas y scheduler.';
        buttons = '<button class="btn" onclick="startProject()">Iniciar proyecto</button>';
      } else if (p.status === 'RUNNING') {
        if (data.tasks.length === 0) {
          title = 'Paso 3: crea la primera tarea';
          text = 'Define titulo, especialista, ruta permitida y una prueba de aceptacion.';
          buttons = '<button class="btn" onclick="document.getElementById(\\'task-title\\').focus()">Crear tarea</button>';
        } else if (ready > 0) {
          title = 'Hay trabajo listo';
          text = ready + ' tarea(s) READY. Ejecuta el scheduler para que los agentes trabajen en paralelo.';
          buttons = '<button class="btn" onclick="runScheduler()">Ejecutar scheduler</button>';
        } else {
          title = 'Trabajo en curso o en revision';
          text = 'Revisa la tabla de tareas y la conversacion de cada agente.';
          buttons = '<button class="btn secondary" onclick="document.getElementById(\\'agents\\').scrollIntoView({behavior:\\'smooth\\'})">Ver agentes</button>';
        }
      } else if (p.status === 'PAUSED') {
        title = 'Proyecto pausado';
        text = 'Los agentes no avanzaran hasta reanudar. Revisa bloqueos antes de continuar.';
        buttons = '<button class="btn" onclick="resumeProject()">Reanudar</button>';
      } else if (p.status === 'INTEGRATING' || p.status === 'FEEDBACK') {
        title = 'Paso 4: revision';
        text = 'El jurado y el feedback estan evaluando el trabajo. Revisa sus dictamenes.';
        buttons = '<button class="btn secondary" onclick="document.getElementById(\\'feedback\\').scrollIntoView({behavior:\\'smooth\\'})">Ver revision</button>';
      } else if (p.status === 'COMPLETED') {
        title = 'Proyecto completado';
        text = 'La entrega esta cerrada. Revisa el manifiesto, la firma y la salida final.';
        buttons = '<button class="btn secondary" onclick="document.getElementById(\\'delivery\\').scrollIntoView({behavior:\\'smooth\\'})">Ver entrega</button>';
      } else if (p.status === 'FAILED' || p.status === 'CANCELLED') {
        title = 'Proyecto detenido';
        text = 'Revisa los bloqueos y la recuperacion antes de crear otro proyecto.';
        buttons = '<button class="btn secondary" onclick="document.getElementById(\\'recovery\\').scrollIntoView({behavior:\\'smooth\\'})">Ver recuperacion</button>';
      }
      $('next-action-title').textContent = title;
      $('next-action-text').textContent = text;
      $('next-action-buttons').innerHTML = buttons;
      return ready;
    }
    async function ensureSession() {
      if (state.token) return;
      const res = await fetch('/api/session');
      const text = await res.text();
      let body;
      try { body = JSON.parse(text); } catch { body = text; }
      if (!res.ok) throw new Error((body && body.error && body.error.message) || body || res.statusText);
      state.token = body.token;
    }
    async function api(path, options = {}) {
      await ensureSession();
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
    async function loadProjects() {
      const projects = await api('/api/projects');
      const select = $('project');
      const previous = select.value || sessionStorage.getItem('orch-project') || '';
      select.innerHTML = projects.length
        ? projects.map((project) => '<option value="' + esc(project.id) + '">' + esc(project.name) + ' · ' + esc(project.status) + '</option>').join('')
        : '<option value="">Sin proyectos</option>';
      const selected = projects.find((project) => project.id === previous) || projects[0];
      if (selected) select.value = selected.id;
      state.projectId = select.value;
      return projects;
    }
    async function load() {
      state.projectId = $('project').value.trim();
      if (!state.projectId) return toast('Selecciona o crea un proyecto', true);
      sessionStorage.setItem('orch-project', state.projectId);
      $('load-state').textContent = 'Cargando...';
      try {
        const [stateData, plans, feedback, deliveries, integrations, recovery, usage, sessions, chat] = await Promise.all([
          api('/api/state?projectId=' + encodeURIComponent(state.projectId)),
          api('/api/plans?projectId=' + encodeURIComponent(state.projectId)),
          api('/api/feedback?projectId=' + encodeURIComponent(state.projectId)),
          api('/api/deliveries?projectId=' + encodeURIComponent(state.projectId)),
          api('/api/integrations?projectId=' + encodeURIComponent(state.projectId)),
          api('/api/recovery/history?projectId=' + encodeURIComponent(state.projectId)),
          api('/api/usage?projectId=' + encodeURIComponent(state.projectId)),
          api('/api/sessions?projectId=' + encodeURIComponent(state.projectId)),
          api('/api/chat?projectId=' + encodeURIComponent(state.projectId)),
        ]);
        state.data = { stateData, plans, feedback, deliveries, integrations, recovery, usage, sessions, chat };
        render();
        renderAgents(sessions);
        renderParentChat(chat.messages || []);
        renderChatContext(state.data);
        $('load-state').textContent = 'Actualizado ' + new Date().toLocaleTimeString();
        toast('Estado actualizado');
      } catch (error) { $('load-state').textContent = 'Error de carga'; toast(error.message, true); }
    }
    function render() {
      const { stateData: data, plans, feedback, deliveries, integrations, recovery } = state.data;
      const p = data.project;
      $('project-name').textContent = p.name;
      $('project-status').textContent = p.status;
      $('project-status').className = 'status-pill ' + statusPillClass(p.status);
      if ($('sidebar-status')) {
        $('sidebar-status').textContent = p.status;
        $('sidebar-status').className = 'status-pill ' + statusPillClass(p.status);
      }
      $('project-meta').textContent = 'Plan aprobado: ' + ((plans.find(x => x.status === 'APPROVED') || {}).title || 'pendiente') + ' | ID ' + p.id + ' | ' + p.repoPath;
      $('task-summary').textContent = String(data.tasks.length);
      const blockedCount = data.tasks.filter(t => ['BLOCKED','FAILED','PAUSED'].includes(t.state)).length;
      $('task-badge').textContent = blockedCount + ' bloqueadas';
      $('task-badge').className = 'badge ' + (data.blockers.length ? 'warn' : 'ok');
      $('module-summary').textContent = data.modules.length + ' modulos';
      $('module-badge').textContent = data.modules.filter(m => m.status === 'INTEGRATED').length + ' integrados';
      $('module-badge').className = 'badge ok';
      $('blocker-summary').textContent = data.blockers.length ? data.blockers.join(', ') : 'Sin bloqueos activos';
      $('blocker-badge').textContent = data.blockers.length ? 'atencion' : 'limpio';
      $('blocker-badge').className = 'badge ' + (data.blockers.length ? 'warn' : 'ok');
      const rank = projectRank(p.status);
      document.querySelectorAll('#workflow-steps .step').forEach((element, index) => {
        element.className = 'step ' + stepClass(index, rank);
      });
      renderNextAction(p, plans, data);
      const actions = [];
      if (p.status === 'RUNNING') actions.push('<button class="btn ghost" onclick="pauseProject()">Pausar</button>');
      if (p.status === 'PAUSED') actions.push('<button class="btn ghost" onclick="resumeProject()">Reanudar</button>');
      $('project-actions').innerHTML = actions.join('');
      $('plan-builder').style.display = p.status === 'DRAFT' ? 'block' : 'none';
      $('task-builder').style.display = p.status === 'RUNNING' ? 'block' : 'none';
      if (p.status === 'DRAFT' && !$('plan-title').value) $('plan-title').value = 'Plan de ' + p.name;
      if (p.status === 'RUNNING') renderTaskOwners(data.agents);
      $('tasks').innerHTML = data.tasks.length ? data.tasks.map(t =>
        '<tr><td>' + badge(t.state, statusKind(t.state)) + '</td><td><strong>' + esc(t.title) + '</strong><div class="mono">' + esc(t.id) + '</div></td><td>' + esc(t.moduleId || '—') + '</td><td class="mono">' + esc((t.dependencies || []).join(', ') || '—') + '</td></tr>'
      ).join('') : '<tr><td colspan="4" class="muted">Sin tareas.</td></tr>';
      const res = data.resources || {};
      const totalTokens = (res.inputTokens || 0) + (res.outputTokens || 0);
      const elapsedMinutes = res.startedAt ? Math.max(0, Math.round(((Date.now() - Date.parse(res.startedAt)) / 60000) * 100) / 100) : 0;
      $('token-count').textContent = totalTokens;
      $('cost-value').textContent = (res.estimatedCostUsd || 0) + ' USD';
      $('time-value').textContent = elapsedMinutes + ' min';
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
      $('usage-rows').innerHTML = rows.length ? (() => {
        const maxInput = Math.max(...rows.map((row) => row.inputTokens || 0), 1);
        return rows.map((row) =>
          '<tr><td><strong>' + esc(row.label) + '</strong><div class="mono">' + esc(row.key) + '</div>' +
          '<div class="usage-bar ' + esc(row.source) + '"><i style="width:' + Math.max(3, Math.round(((row.inputTokens || 0) / maxInput) * 100)) + '%"></i></div></td>' +
          '<td>' + badge(row.source, row.source === 'provider' ? 'ok' : 'warn') + '</td>' +
          '<td class="mono">' + row.inputTokens + '</td><td class="mono">' + row.outputTokens + '</td>' +
          '<td class="mono">' + row.costUsd + ' USD</td><td>' + row.entries + '</td></tr>'
        ).join('');
      })() : '<tr><td colspan="6" class="muted">Sin datos de uso.</td></tr>';
    }
    function roleClass(role) {
      if (String(role).startsWith('JUDGE')) return 'role-judge';
      if (role === 'SPECIALIST') return 'role-specialist';
      if (role === 'FEEDBACK') return 'role-feedback';
      if (role === 'COORDINATOR') return 'role-coordinator';
      if (role === 'PARENT') return 'role-parent';
      return '';
    }
    function renderParentChat(messages) {
      const container = $('parent-chat');
      const visible = (messages || []).filter((message) => message.role === 'user' || message.role === 'assistant');
      if (!visible.length) {
        container.innerHTML = '<div class="empty"><strong>Sin conversacion todavia</strong>Escribe abajo para abrir el canal con el Padre.</div>';
        return;
      }
      container.innerHTML = visible.slice(-40).map((message) => {
        const role = message.role === 'user' ? 'user' : 'assistant';
        const who = message.role === 'user' ? 'Tu' : 'Padre';
        return '<div class="chat-msg ' + role + '"><div class="role">' + who + '</div><p>' + esc(message.text || '(sin texto)') + '</p></div>';
      }).join('');
      container.scrollTop = container.scrollHeight;
    }
    function renderChatContext(data) {
      const p = data.stateData.project;
      const tasks = data.stateData.tasks || [];
      const ready = tasks.filter((task) => task.state === 'READY').length;
      const blocked = tasks.filter((task) => ['BLOCKED','FAILED','PAUSED'].includes(task.state)).length;
      const agents = data.stateData.agents || [];
      const pending = data.stateData.messages ? data.stateData.messages.queued : 0;
      const rows = [
        ['Estado', p.status],
        ['Tareas', tasks.length + ' (' + ready + ' listas)'],
        ['Agentes', String(agents.length)],
        ['Bloqueos', String(blocked)],
        ['Mensajes en cola', String(pending)],
      ];
      $('chat-context').innerHTML = rows.map(([label, value]) =>
        '<div class="row"><div><strong>' + esc(label) + '</strong><small>' + esc(value) + '</small></div></div>'
      ).join('');
    }
    async function loadChat() {
      if (!state.projectId) return;
      try {
        const chat = await api('/api/chat?projectId=' + encodeURIComponent(state.projectId));
        renderParentChat(chat.messages || []);
      } catch (error) { $('chat-status').textContent = 'No se pudo cargar el chat: ' + error.message; }
    }
    async function sendChat() {
      const input = $('chat-input');
      const text = input.value.trim();
      if (!state.projectId) return toast('Selecciona un proyecto primero', true);
      if (!text) return toast('Escribe un mensaje para el Padre', true);
      input.value = '';
      const button = $('chat-send');
      button.disabled = true;
      $('chat-status').textContent = 'El Padre esta leyendo el estado y pensando...';
      try {
        const chat = await api('/api/chat?projectId=' + encodeURIComponent(state.projectId), {
          method: 'POST',
          body: JSON.stringify({ text }),
        });
        renderParentChat(chat.messages || []);
        $('chat-status').textContent = 'Respuesta recibida ' + new Date().toLocaleTimeString();
        await load();
      } catch (error) {
        $('chat-status').textContent = 'Error: ' + error.message;
        toast(error.message, true);
      } finally {
        button.disabled = false;
      }
    }
    function renderAgents(sessions) {
      state.sessions = sessions || [];
      const list = $('agent-list');
      if (!state.sessions.length) {
        list.innerHTML = '<div class="empty"><strong>Sin sesiones todavia</strong>Cuando el scheduler ejecute una tarea, su conversacion aparecera aqui.</div>';
        return;
      }
      list.innerHTML = state.sessions.map((session) => {
        const agent = session.agent;
        const tokens = (session.usage && session.usage.inputTokens || 0) + (session.usage && session.usage.outputTokens || 0);
        const selected = state.selectedSession === session.id ? ' selected' : '';
        return '<div class="session-card' + selected + '" onclick="selectAgent(\\'' + session.id + '\\')" tabindex="0" role="button">' +
          '<div class="session-top"><div><div class="session-name ' + roleClass(agent && agent.role) + '">' + esc(agent ? agent.name : 'Sistema') + '</div>' +
          '<div class="session-purpose">' + esc(session.purpose || 'sesion') + '</div></div>' + badge(session.status, statusKind(session.status)) + '</div>' +
          (session.task ? '<div class="muted" style="margin-top:7px">' + esc(session.task.title) + '</div>' : '') +
          '<div class="session-stats"><span>' + tokens + ' tokens</span><span>' + (session.usage ? session.usage.entries : 0) + ' registros</span><span class="mono">' + esc(session.id.slice(0, 12)) + '</span></div>' +
          '</div>';
      }).join('');
      if ((!state.selectedSession || !state.sessions.some((session) => session.id === state.selectedSession)) && state.sessions[0]) selectAgent(state.sessions[0].id);
    }
    function renderTranscript(messages) {
      const container = $('agent-transcript');
      if (!messages.length) {
        container.innerHTML = '<div class="empty"><strong>Sin mensajes</strong>Esta sesion aun no tiene conversacion registrada.</div>';
        return;
      }
      container.innerHTML = messages.map((message) => {
        const role = message.role === 'user' ? 'user' : message.role === 'assistant' ? 'assistant' : 'system';
        const who = message.role === 'user' ? 'Tu' : message.role === 'assistant' ? (message.agent || 'Agente') : 'Sistema';
        const tokens = message.tokens ? (message.tokens.input + message.tokens.output + message.tokens.reasoning + message.tokens.cacheRead + message.tokens.cacheWrite) : 0;
        const meta = [message.createdAt ? new Date(message.createdAt).toLocaleString() : '', tokens ? tokens + ' tokens' : ''].filter(Boolean).join(' · ');
        return '<div class="chat-msg ' + role + '"><div class="role">' + esc(who) + '</div><p>' + esc(message.text || '(sin texto)') + '</p>' +
          (meta ? '<div class="meta">' + esc(meta) + '</div>' : '') + '</div>';
      }).join('');
    }
    async function selectAgent(sessionId) {
      state.selectedSession = sessionId;
      renderAgents(state.sessions);
      const session = state.sessions.find((candidate) => candidate.id === sessionId);
      if (!session) return;
      const agent = session.agent;
      $('agent-title').textContent = agent ? agent.name : 'Sesion';
      $('agent-meta').textContent = [session.purpose || 'sesion', session.task ? session.task.title : '', session.status, session.usage ? ((session.usage.inputTokens || 0) + (session.usage.outputTokens || 0)) + ' tokens' : ''].filter(Boolean).join(' · ');
      $('agent-reply-note').textContent = 'Vista de lectura. Para responder, abre en OpenCode Desktop la sesion ' + session.id + '.';
      $('agent-transcript').innerHTML = '<div class="empty">Cargando conversacion...</div>';
      try {
        const result = await api('/api/sessions/' + encodeURIComponent(sessionId) + '/transcript');
        renderTranscript(result.messages || []);
      } catch (error) {
        $('agent-transcript').innerHTML = '<div class="empty"><strong>No se pudo cargar</strong>' + esc(error.message) + '</div>';
      }
    }
    async function loadAgents() {
      if (!state.projectId) return;
      try {
        const sessions = await api('/api/sessions?projectId=' + encodeURIComponent(state.projectId));
        renderAgents(sessions);
        toast('Agentes actualizados');
      } catch (error) { toast(error.message, true); }
    }
    async function copyAgentId() {
      if (!state.selectedSession) return toast('Selecciona una sesion primero', true);
      try {
        await navigator.clipboard.writeText(state.selectedSession);
        toast('ID copiado: ' + state.selectedSession);
      } catch { toast('No se pudo copiar el ID', true); }
    }
    async function createProject() {
      const name = $('new-project-name').value.trim();
      if (!name) return toast('Ponle un nombre al proyecto nuevo', true);
      $('load-state').textContent = 'Creando proyecto...';
      try {
        const created = await api('/api/projects', { method: 'POST', body: JSON.stringify({ name }) });
        $('new-project-name').value = '';
        sessionStorage.setItem('orch-project', created.project.id);
        await loadProjects();
        $('project').value = created.project.id;
        toast('Proyecto creado con ' + created.agents.length + ' agentes');
        await load();
      } catch (error) { $('load-state').textContent = 'Error al crear'; toast(error.message, true); }
    }
    function renderTaskOwners(agents) {
      const select = $('task-owner');
      const previous = select.value;
      const specialists = (agents || []).filter((agent) => agent.role === 'SPECIALIST');
      select.innerHTML = specialists.length
        ? specialists.map((agent) => '<option value="' + esc(agent.id) + '">' + esc(agent.name) + '</option>').join('')
        : '<option value="">Sin especialistas</option>';
      if (previous) select.value = previous;
    }
    async function createPlan() {
      const title = $('plan-title').value.trim();
      const objective = $('plan-objective').value.trim();
      if (!title || !objective) return toast('Titulo y objetivo del plan son obligatorios', true);
      try {
        await api('/api/projects/' + state.projectId + '/plan', {
          method: 'POST',
          body: JSON.stringify({ title, objective }),
        });
        $('plan-objective').value = '';
        toast('Plan creado; apruébalo en la seccion Aprobacion');
        await load();
      } catch (error) { toast(error.message, true); }
    }
    async function createTask() {
      const title = $('task-title').value.trim();
      const description = $('task-description').value.trim();
      const ownerAgentId = $('task-owner').value;
      const paths = $('task-paths').value.trim();
      const tests = $('task-tests').value.trim();
      if (!title || !ownerAgentId || !paths || !tests) {
        return toast('Completa titulo, especialista, rutas y prueba', true);
      }
      try {
        await api('/api/projects/' + state.projectId + '/tasks', {
          method: 'POST',
          body: JSON.stringify({
            title,
            description: description || title,
            ownerAgentId,
            paths,
            tests,
          }),
        });
        $('task-title').value = '';
        $('task-description').value = '';
        $('task-paths').value = '';
        $('task-tests').value = '';
        toast('Tarea creada y asignada');
        await load();
      } catch (error) { toast(error.message, true); }
    }
    async function projectAction(action) {
      try {
        await api('/api/projects/' + state.projectId + '/' + action, { method: 'POST', body: '{}' });
        toast('Proyecto: ' + action);
        await load();
      } catch (error) { toast(error.message, true); }
    }
    async function startProject() { return projectAction('start'); }
    async function pauseProject() { return projectAction('pause'); }
    async function resumeProject() { return projectAction('resume'); }
    async function runScheduler() {
      $('load-state').textContent = 'Ejecutando scheduler...';
      toast('Scheduler en marcha; puede tardar varios minutos');
      try {
        const result = await api('/api/projects/' + state.projectId + '/scheduler/run', { method: 'POST', body: '{}' });
        toast('Scheduler: ' + (result.results ? result.results.length : 0) + ' tareas procesadas');
        await load();
      } catch (error) { $('load-state').textContent = 'Error del scheduler'; toast(error.message, true); }
    }
    async function init() {
      try {
        await ensureSession();
        const projects = await loadProjects();
        if (projects.length) await load();
        else {
          $('load-state').textContent = 'Crea tu primer proyecto';
          toast('No hay proyectos. Escribe un nombre y pulsa Crear proyecto.');
        }
      } catch (error) { $('load-state').textContent = 'Error de inicio'; toast(error.message, true); }
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
      if (apply && !confirm('Aplicar recuperacion sobre ' + state.projectId + '?\\nSe modificaran leases/tareas/estados solo en acciones seguras. Esta accion queda auditada.')) return;
      try {
        const result = await api('/api/recovery/run?projectId=' + encodeURIComponent(state.projectId), { method: 'POST', body: JSON.stringify({ apply }) });
        toast('Recuperacion: ' + result.actions.length + ' hallazgos, ' + result.applied + ' aplicados');
        load();
      } catch (e) { toast(e.message, true); }
    }
    $('chat-input').addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendChat();
      }
    });
    init();
  </script>
</body>
</html>`
}
