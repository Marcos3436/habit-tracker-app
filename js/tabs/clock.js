/**
 * @fileoverview Módulo da Aba 4: Relógio de Foco (Sessões de Concentração & Andamento Diário).
 * Arquitetura baseada em funções puras (determinísticas e testáveis) e motor de tempo
 * baseado em timestamps reais (Date.now) para evitar atrasos (drift) em segundo plano.
 */

import { keyOf, todayN } from '../core/dates.js';
import { $ } from '../core/dom.js';
import { saveFocus, state } from '../core/state.js';
import { pushFocus, quiet } from '../core/supabase.js';

export const MIN_SESSION_MIN = 15;
export const MAX_SESSION_MIN = 240;
export const SESSION_STEP_MIN = 15;

/* ==========================================================================
   1. FUNÇÕES PURAS DE REGRA DE NEGÓCIO (Fáceis de Testar e Depurar)
   ========================================================================== */

/**
 * Calcula a quantidade de intervalos (pausas) para uma sessão de foco.
 * @param {number} totalMinutes Duração total de foco escolhida (em minutos)
 * @param {boolean} [skipBreaks=false] Se o usuário marcou "Pular pausas"
 * @param {number} [blockMinutes=60] Tamanho máximo de cada bloco de foco antes de pausa
 * @returns {number} Quantidade de intervalos
 */
export function calcFocusIntervals(totalMinutes, skipBreaks = false, blockMinutes = 60) {
  const total = Math.max(5, Math.min(480, Math.round(+totalMinutes || 30)));
  const block = Math.max(10, Math.round(+blockMinutes || 60));
  if (skipBreaks || total <= block) return 0;
  return Math.max(0, Math.ceil(total / block) - 1);
}

/**
 * Constrói o plano detalhado de etapas (blocos de foco intercalados com pausas).
 * @param {number} totalMinutes
 * @param {boolean} [skipBreaks=false]
 * @param {number} [blockMinutes=60]
 * @param {number} [breakMinutes=5]
 * @returns {{totalMinutes: number, breakCount: number, steps: Array<{type: 'focus'|'break', minutes: number, focusIndex?: number, totalFocusBlocks: number, breakIndex?: number, label: string}>}}
 */
export function buildSessionPlan(
  totalMinutes,
  skipBreaks = false,
  blockMinutes = 60,
  breakMinutes = 5
) {
  const total = Math.max(5, Math.min(480, Math.round(+totalMinutes || 30)));
  const brkMin = Math.max(1, Math.min(60, Math.round(+breakMinutes || 5)));
  const breakCount = calcFocusIntervals(total, skipBreaks, blockMinutes);
  const totalFocusBlocks = breakCount + 1;

  const baseFocus = Math.floor(total / totalFocusBlocks);
  const remainder = total % totalFocusBlocks;

  const steps = [];
  for (let i = 0; i < totalFocusBlocks; i++) {
    const focusMin = baseFocus + (i < remainder ? 1 : 0);
    steps.push({
      type: 'focus',
      minutes: focusMin,
      focusIndex: i + 1,
      totalFocusBlocks,
      label:
        totalFocusBlocks > 1
          ? `Foco (${i + 1} de ${totalFocusBlocks})`
          : 'Sessão de concentração',
    });

    if (i < breakCount) {
      steps.push({
        type: 'break',
        minutes: brkMin,
        breakIndex: i + 1,
        totalFocusBlocks,
        label: `Intervalo (${i + 1} de ${breakCount})`,
      });
    }
  }

  return { totalMinutes: total, breakCount, steps };
}

/**
 * Calcula os indicadores do painel "Andamento diário" (Ontem, Hoje, Meta, % e Sequência).
 * @param {Record<string, number>} history Mapa 'YYYY-MM-DD' -> minutos concluídos
 * @param {number} dailyGoalMin Meta diária em minutos
 * @param {number} [todayInt=todayN()] Índice inteiro do dia de hoje
 * @returns {{todayMin: number, yesterdayMin: number, goalMin: number, progressPct: number, streak: number}}
 */
export function calcDailyFocusStats(history = {}, dailyGoalMin = 240, todayInt = todayN()) {
  const safeHist = history && typeof history === 'object' ? history : {};
  const goalMin = Math.max(15, Math.round(+dailyGoalMin || 240));
  const todayKey = keyOf(todayInt);
  const yesterdayKey = keyOf(todayInt - 1);

  const todayMin = Math.max(0, Math.round(+(safeHist[todayKey] || 0)));
  const yesterdayMin = Math.max(0, Math.round(+(safeHist[yesterdayKey] || 0)));
  const progressPct = Math.min(100, Math.round((todayMin / goalMin) * 100));

  // Sequência de metas diárias batidas (hoje ainda pode estar em andamento)
  let n = todayInt;
  let streak = 0;
  if ((safeHist[keyOf(n)] || 0) < goalMin) {
    n--;
  }
  while ((safeHist[keyOf(n)] || 0) >= goalMin) {
    streak++;
    n--;
  }

  return { todayMin, yesterdayMin, goalMin, progressPct, streak };
}

/**
 * Formata a exibição da meta diária para o centro do anel circular.
 * @param {number} goalMin
 * @returns {{value: string, unit: string}}
 */
export function formatGoalDisplay(goalMin) {
  if (goalMin >= 60 && goalMin % 30 === 0) {
    const h = goalMin / 60;
    return {
      value: h.toLocaleString('pt-BR', { maximumFractionDigits: 1 }),
      unit: h === 1 ? 'hora' : 'horas',
    };
  }
  return {
    value: String(goalMin),
    unit: goalMin === 1 ? 'minuto' : 'minutos',
  };
}

/**
 * Formata segundos em 'MM:SS' ou 'HH:MM:SS'.
 * @param {number} totalSeconds
 * @returns {string}
 */
export function formatCountdown(totalSeconds) {
  const s = Math.max(0, Math.ceil(totalSeconds));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return hrs > 0 ? `${pad(hrs)}:${pad(mins)}:${pad(secs)}` : `${pad(mins)}:${pad(secs)}`;
}

/* ==========================================================================
   2. MOTOR DE EXECUÇÃO DA SESSÃO (State Machine sem Drift)
   ========================================================================== */

let activeSession = null;
let tickInterval = null;

/**
 * Emite um alerta sonoro suave usando Web Audio API (sem arquivos externos).
 */
function playChime() {
  if (!state.focus.sound) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    [523.25, 659.25, 783.99].forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.12, ctx.currentTime + idx * 0.14);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.14 + 0.45);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime + idx * 0.14);
      osc.stop(ctx.currentTime + idx * 0.14 + 0.46);
    });
  } catch (_) {}
}

function persistAndSyncFocus() {
  state.focus.at = Date.now();
  saveFocus();
  quiet(pushFocus);
}

/**
 * Credita minutos de foco concluídos no dia de hoje.
 * @param {number} mins
 */
export function recordFocusMinutes(mins) {
  if (!(mins > 0)) return;
  const k = keyOf(todayN());
  state.focus.history = state.focus.history || {};
  state.focus.history[k] = Math.max(0, Math.round((state.focus.history[k] || 0) + mins));
  persistAndSyncFocus();
}

function getPhaseElapsedSec() {
  if (!activeSession) return 0;
  const runningDelta = activeSession.paused
    ? 0
    : (Date.now() - activeSession.lastResumeAt) / 1000;
  return activeSession.accumulatedSec + runningDelta;
}

function creditElapsedFocusMinutes(flushRemainder = false) {
  if (!activeSession) return;
  const step = activeSession.plan.steps[activeSession.stepIdx];
  if (!step || step.type !== 'focus') return;

  const totalSec = step.minutes * 60;
  const elapsedSec = Math.min(totalSec, getPhaseElapsedSec());
  const wholeMinutesDone = flushRemainder
    ? Math.round(elapsedSec / 60)
    : Math.floor(elapsedSec / 60);

  const deltaMin = wholeMinutesDone - activeSession.creditedMinInStep;
  if (deltaMin > 0) {
    activeSession.creditedMinInStep += deltaMin;
    recordFocusMinutes(deltaMin);
    updateDailyProgressDOM();
  }
}

function advanceSessionStep() {
  if (!activeSession) return;
  creditElapsedFocusMinutes(true);
  playChime();

  activeSession.stepIdx++;
  if (activeSession.stepIdx >= activeSession.plan.steps.length) {
    stopFocusSession(false);
    return;
  }

  activeSession.accumulatedSec = 0;
  activeSession.creditedMinInStep = 0;
  activeSession.lastResumeAt = Date.now();
  activeSession.paused = false;
  drawClock();
}

function onTimerTick() {
  if (!activeSession || activeSession.paused) return;
  const step = activeSession.plan.steps[activeSession.stepIdx];
  if (!step) return;

  const totalSec = step.minutes * 60;
  const elapsedSec = getPhaseElapsedSec();
  creditElapsedFocusMinutes(false);

  if (elapsedSec >= totalSec) {
    advanceSessionStep();
    return;
  }

  updateActiveTimerDOM(totalSec - elapsedSec, totalSec);
}

export function startFocusSession() {
  const f = state.focus;
  const plan = buildSessionPlan(f.sessionMin, f.skipBreaks, f.blockMin, f.breakMin);
  activeSession = {
    plan,
    stepIdx: 0,
    paused: false,
    accumulatedSec: 0,
    creditedMinInStep: 0,
    lastResumeAt: Date.now(),
  };
  clearInterval(tickInterval);
  tickInterval = setInterval(onTimerTick, 250);
  drawClock();
}

export function togglePauseSession() {
  if (!activeSession) return;
  if (activeSession.paused) {
    activeSession.paused = false;
    activeSession.lastResumeAt = Date.now();
  } else {
    activeSession.accumulatedSec = getPhaseElapsedSec();
    activeSession.paused = true;
    creditElapsedFocusMinutes(false);
  }
  drawClock();
}

export function stopFocusSession(flushPartial = true) {
  if (activeSession && flushPartial) {
    creditElapsedFocusMinutes(false);
  }
  clearInterval(tickInterval);
  tickInterval = null;
  activeSession = null;
  drawClock();
}

/* ==========================================================================
   3. RENDERIZAÇÃO VISUAL E ATUALIZAÇÃO DE DOM
   ========================================================================== */

const TIMER_RADIUS = 96;
const TIMER_CIRC = 2 * Math.PI * TIMER_RADIUS;
const GOAL_RADIUS = 86;
const GOAL_CIRC = 2 * Math.PI * GOAL_RADIUS;

function updateActiveTimerDOM(remainingSec, totalSec) {
  const digitsEl = $('clk-digits');
  const arcEl = $('clk-timer-arc');
  if (digitsEl) digitsEl.textContent = formatCountdown(remainingSec);
  if (arcEl) {
    const ratio = totalSec > 0 ? Math.max(0, Math.min(1, remainingSec / totalSec)) : 0;
    arcEl.style.strokeDashoffset = String(TIMER_CIRC * (1 - ratio));
  }
}

function updateDailyProgressDOM() {
  const st = calcDailyFocusStats(state.focus.history, state.focus.dailyGoalMin);
  const gDisp = formatGoalDisplay(st.goalMin);

  const yVal = $('clk-yest-val');
  const yUnit = $('clk-yest-unit');
  const gVal = $('clk-goal-val');
  const gUnit = $('clk-goal-unit');
  const gArc = $('clk-goal-arc');
  const sVal = $('clk-streak-val');
  const sUnit = $('clk-streak-unit');
  const comp = $('clk-completed-txt');

  if (yVal) yVal.textContent = String(st.yesterdayMin);
  if (yUnit) yUnit.textContent = st.yesterdayMin === 1 ? 'minuto' : 'minutos';
  if (gVal) gVal.textContent = gDisp.value;
  if (gUnit) gUnit.textContent = gDisp.unit;
  if (gArc) {
    const offset = GOAL_CIRC * (1 - st.progressPct / 100);
    gArc.style.strokeDashoffset = String(offset);
  }
  if (sVal) sVal.textContent = String(st.streak);
  if (sUnit) sUnit.textContent = st.streak === 1 ? 'dia' : 'dias';
  if (comp) {
    comp.textContent = `Concluído: ${st.todayMin} ${st.todayMin === 1 ? 'minuto' : 'minutos'}`;
  }
}

function renderLeftCardContent() {
  const f = state.focus;

  if (!activeSession) {
    const breaks = calcFocusIntervals(f.sessionMin, f.skipBreaks, f.blockMin);
    const breaksText =
      breaks === 0
        ? 'Você não terá intervalos'
        : `Você terá <b>${breaks}</b> ${breaks === 1 ? 'intervalo' : 'intervalos'}`;

    return `
      <div class="clock-card-top">
        <span></span>
        <div class="clock-card-actions">
          <button type="button" class="clock-icon-btn" id="clk-cfg-btn" title="Configurar blocos e intervalos">⋯</button>
        </div>
      </div>
      <div class="session-setup">
        <h3>Prepare-se para se concentrar</h3>
        <p class="session-desc">
          Desativaremos notificações e alertas de aplicativos durante cada sessão.
          Para sessões mais longas, adicionaremos um intervalo curto para que você possa descansar.
        </p>

        <div class="focus-stepper">
          <div class="focus-stepper-val">
            <strong id="clk-session-val">${f.sessionMin}</strong>
            <span>min</span>
          </div>
          <div class="focus-stepper-btns">
            <button type="button" class="focus-step-btn" id="clk-inc" aria-label="Aumentar tempo" ${f.sessionMin >= MAX_SESSION_MIN ? 'disabled' : ''}>⌃</button>
            <button type="button" class="focus-step-btn" id="clk-dec" aria-label="Diminuir tempo" ${f.sessionMin <= MIN_SESSION_MIN ? 'disabled' : ''}>⌄</button>
          </div>
        </div>

        <p class="focus-breaks-info" id="clk-breaks-txt">${breaksText}</p>

        <label class="focus-skip-label">
          <input type="checkbox" id="clk-skip-chk" ${f.skipBreaks ? 'checked' : ''}>
          <span>Pular pausas</span>
        </label>

        <div>
          <button type="button" class="focus-start-btn" id="clk-start-btn">
            <span>▶</span>
            <span>Iniciar a sessão de concentração</span>
          </button>
        </div>
      </div>
    `;
  }

  // Visão da sessão em andamento
  const step = activeSession.plan.steps[activeSession.stepIdx];
  const isBreak = step.type === 'break';
  const totalSec = step.minutes * 60;
  const remainingSec = Math.max(0, totalSec - getPhaseElapsedSec());
  const ratio = totalSec > 0 ? Math.max(0, Math.min(1, remainingSec / totalSec)) : 0;
  const dashOffset = TIMER_CIRC * (1 - ratio);

  const stepDots = activeSession.plan.steps
    .map((s, idx) => {
      const stClass =
        idx < activeSession.stepIdx
          ? 'done'
          : idx === activeSession.stepIdx
            ? 'active'
            : '';
      const brkClass = s.type === 'break' ? 'is-break' : '';
      return `<span class="step-pill ${brkClass} ${stClass}" title="${s.label}: ${s.minutes} min"></span>`;
    })
    .join('');

  return `
    <div class="clock-card-top">
      <span class="clock-card-title">Sessão de concentração</span>
      <div class="clock-card-actions">
        <button type="button" class="clock-icon-btn" id="clk-cfg-btn" title="Configurar blocos e intervalos">⋯</button>
      </div>
    </div>
    <div class="session-active">
      <div class="phase-badge ${isBreak ? 'is-break' : ''}">
        ${isBreak ? '☕ ' : '🎯 '}${step.label}
      </div>

      <div class="timer-ring-wrap">
        <svg class="timer-ring-svg" viewBox="0 0 224 224">
          <circle class="timer-ring-bg" cx="112" cy="112" r="${TIMER_RADIUS}"></circle>
          <circle
            class="timer-ring-fg ${isBreak ? 'is-break' : ''}"
            id="clk-timer-arc"
            cx="112"
            cy="112"
            r="${TIMER_RADIUS}"
            stroke-dasharray="${TIMER_CIRC}"
            stroke-dashoffset="${dashOffset}"
          ></circle>
        </svg>
        <div class="timer-center">
          <strong class="timer-digits" id="clk-digits">${formatCountdown(remainingSec)}</strong>
          <span class="timer-sub">${activeSession.paused ? 'Pausado' : isBreak ? 'Hora de descansar' : 'Mantenha o foco'}</span>
        </div>
      </div>

      <div class="session-steps-dots">${stepDots}</div>

      <div class="timer-controls">
        <button type="button" class="timer-btn primary" id="clk-pause-btn">
          ${activeSession.paused ? '▶ Continuar' : '⏸ Pausar'}
        </button>
        <button type="button" class="timer-btn" id="clk-skip-step-btn" title="Avançar para a próxima etapa">
          ⏭ Pular etapa
        </button>
        <button type="button" class="timer-btn danger" id="clk-stop-btn">
          ⏹ Encerrar
        </button>
      </div>
    </div>
  `;
}

/**
 * Renderiza a aba completa do Relógio de Foco (#clock).
 */
export function drawClock() {
  const clockEl = $('clock');
  if (!clockEl) return;

  const st = calcDailyFocusStats(state.focus.history, state.focus.dailyGoalMin);
  const gDisp = formatGoalDisplay(st.goalMin);
  const goalDashOffset = GOAL_CIRC * (1 - st.progressPct / 100);

  clockEl.innerHTML = `
    <div class="clock-wrap">
      <div class="clock-grid">
        <!-- Card Esquerdo: Sessão de Concentração -->
        <div class="clock-card session-card">
          ${renderLeftCardContent()}
        </div>

        <!-- Card Direito: Andamento Diário -->
        <div class="clock-card progress-card">
          <div class="clock-card-top">
            <span class="clock-card-title">Andamento diário</span>
            <div class="clock-card-actions">
              <button type="button" class="clock-icon-btn" id="clk-edit-goal" title="Editar meta diária">✎</button>
            </div>
          </div>

          <div class="daily-progress-body">
            <div class="daily-stat">
              <span class="daily-stat-label">Ontem</span>
              <strong class="daily-stat-val" id="clk-yest-val">${st.yesterdayMin}</strong>
              <span class="daily-stat-unit" id="clk-yest-unit">${st.yesterdayMin === 1 ? 'minuto' : 'minutos'}</span>
            </div>

            <div class="goal-ring-wrap">
              <svg class="goal-ring-svg" viewBox="0 0 210 210">
                <circle class="goal-ring-bg" cx="105" cy="105" r="${GOAL_RADIUS}"></circle>
                <circle
                  class="goal-ring-fg"
                  id="clk-goal-arc"
                  cx="105"
                  cy="105"
                  r="${GOAL_RADIUS}"
                  stroke-dasharray="${GOAL_CIRC}"
                  stroke-dashoffset="${goalDashOffset}"
                ></circle>
              </svg>
              <div class="goal-ring-center">
                <span>Meta diária</span>
                <strong id="clk-goal-val">${gDisp.value}</strong>
                <span id="clk-goal-unit">${gDisp.unit}</span>
              </div>
            </div>

            <div class="daily-stat">
              <span class="daily-stat-label">Sequência</span>
              <strong class="daily-stat-val" id="clk-streak-val">${st.streak}</strong>
              <span class="daily-stat-unit" id="clk-streak-unit">${st.streak === 1 ? 'dia' : 'dias'}</span>
            </div>
          </div>

          <p class="daily-completed-text" id="clk-completed-txt">
            Concluído: ${st.todayMin} ${st.todayMin === 1 ? 'minuto' : 'minutos'}
          </p>
        </div>
      </div>
    </div>
  `;

  bindClockViewEvents();
}

function adjustSessionMinutes(delta) {
  const next = Math.max(
    MIN_SESSION_MIN,
    Math.min(MAX_SESSION_MIN, state.focus.sessionMin + delta)
  );
  if (next === state.focus.sessionMin) return;
  state.focus.sessionMin = next;
  persistAndSyncFocus();
  drawClock();
}

function openGoalModal() {
  const dlg = $('gdlg');
  if (!dlg) return;
  const k = keyOf(todayN());
  $('ggoal').value = state.focus.dailyGoalMin;
  $('gtoday').value = state.focus.history[k] || 0;
  $('gerr').textContent = '';
  dlg.showModal();
  $('ggoal').focus();
}

function saveGoalModal() {
  const goal = Math.round(+$('ggoal').value);
  const todayVal = Math.round(+$('gtoday').value || 0);
  if (!(goal >= 15 && goal <= 960)) {
    $('gerr').textContent = 'Defina uma meta diária entre 15 e 960 minutos (16h).';
    return;
  }
  if (todayVal < 0 || todayVal > 1440) {
    $('gerr').textContent = 'O tempo concluído hoje deve estar entre 0 e 1440 minutos.';
    return;
  }
  state.focus.dailyGoalMin = goal;
  const k = keyOf(todayN());
  state.focus.history = state.focus.history || {};
  state.focus.history[k] = todayVal;
  persistAndSyncFocus();
  $('gdlg').close();
  drawClock();
}

function openClockConfigModal() {
  const dlg = $('cdlg');
  if (!dlg) return;
  $('cblock').value = String(state.focus.blockMin || 60);
  $('cbreak').value = String(state.focus.breakMin || 5);
  $('csound').checked = state.focus.sound !== false;
  dlg.showModal();
}

function saveClockConfigModal() {
  state.focus.blockMin = Math.max(15, Math.min(120, +$('cblock').value || 60));
  state.focus.breakMin = Math.max(1, Math.min(60, +$('cbreak').value || 5));
  state.focus.sound = !!$('csound').checked;
  persistAndSyncFocus();
  $('cdlg').close();
  drawClock();
}

function bindClockViewEvents() {
  const incBtn = $('clk-inc');
  const decBtn = $('clk-dec');
  const skipChk = $('clk-skip-chk');
  const startBtn = $('clk-start-btn');
  const pauseBtn = $('clk-pause-btn');
  const skipStepBtn = $('clk-skip-step-btn');
  const stopBtn = $('clk-stop-btn');
  const editGoalBtn = $('clk-edit-goal');
  const cfgBtn = $('clk-cfg-btn');

  if (incBtn) incBtn.onclick = () => adjustSessionMinutes(SESSION_STEP_MIN);
  if (decBtn) decBtn.onclick = () => adjustSessionMinutes(-SESSION_STEP_MIN);
  if (skipChk) {
    skipChk.onchange = () => {
      state.focus.skipBreaks = skipChk.checked;
      persistAndSyncFocus();
      drawClock();
    };
  }
  if (startBtn) startBtn.onclick = startFocusSession;
  if (pauseBtn) pauseBtn.onclick = togglePauseSession;
  if (skipStepBtn) skipStepBtn.onclick = advanceSessionStep;
  if (stopBtn) stopBtn.onclick = () => stopFocusSession(true);
  if (editGoalBtn) editGoalBtn.onclick = openGoalModal;
  if (cfgBtn) cfgBtn.onclick = openClockConfigModal;
}

/**
 * Inicializa os modais e listeners da Aba Relógio.
 */
export function initClockTab() {
  const gdlg = $('gdlg');
  if (gdlg) {
    $('gok').onclick = saveGoalModal;
    $('gcancel').onclick = () => gdlg.close();
    $('ggoal').onkeydown = (e) => {
      if (e.key === 'Enter') saveGoalModal();
    };
    gdlg.addEventListener('click', (e) => {
      if (e.target === gdlg) gdlg.close();
    });
  }

  const cdlg = $('cdlg');
  if (cdlg) {
    $('cok').onclick = saveClockConfigModal;
    $('ccancel').onclick = () => cdlg.close();
    cdlg.addEventListener('click', (e) => {
      if (e.target === cdlg) cdlg.close();
    });
  }
}
