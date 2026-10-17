/**
 * @fileoverview Módulo da Aba 4: Relógio de Foco (Sessões de Concentração & Andamento Diário).
 * Arquitetura baseada em funções puras (determinísticas e testáveis), múltiplos timbres de alarme,
 * notificações nativas do Windows e motor de tempo baseado em timestamps reais (Date.now).
 */

import { keyOf, todayN } from '../core/dates.js';
import { $ } from '../core/dom.js';
import { saveFocus, state } from '../core/state.js';
import { pushFocus, quiet } from '../core/supabase.js';

export const MIN_SESSION_MIN = 15;
export const MAX_SESSION_MIN = 240;
export const SESSION_STEP_MIN = 15;

/**
 * Catálogo de opções de som de alarme sintetizados via Web Audio API.
 */
export const ALARM_SOUNDS = [
  { id: 'chime', label: 'Sino Suave (Chime)' },
  { id: 'bell', label: 'Campainha Cristalina' },
  { id: 'digital', label: 'Alarme Digital (Beep)' },
  { id: 'marimba', label: 'Marimba Zen' },
  { id: 'harp', label: 'Harpa Celestial' },
  { id: 'off', label: 'Silencioso (Sem som)' },
];

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
 * Calcula os indicadores do painel "Andamento diário" (Ontem, Hoje, Meta, %, Sequência e Conclusão).
 * @param {Record<string, number>} history Mapa 'YYYY-MM-DD' -> minutos concluídos
 * @param {number} dailyGoalMin Meta diária em minutos
 * @param {number} [todayInt=todayN()] Índice inteiro do dia de hoje
 * @returns {{todayMin: number, yesterdayMin: number, goalMin: number, progressPct: number, streak: number, goalReached: boolean}}
 */
export function calcDailyFocusStats(history = {}, dailyGoalMin = 240, todayInt = todayN()) {
  const safeHist = history && typeof history === 'object' ? history : {};
  const goalMin = Math.max(15, Math.round(+dailyGoalMin || 240));
  const todayKey = keyOf(todayInt);
  const yesterdayKey = keyOf(todayInt - 1);

  const todayMin = Math.max(0, Math.round(+(safeHist[todayKey] || 0)));
  const yesterdayMin = Math.max(0, Math.round(+(safeHist[yesterdayKey] || 0)));
  const progressPct = Math.min(100, Math.round((todayMin / goalMin) * 100));
  const goalReached = todayMin >= goalMin;

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

  return { todayMin, yesterdayMin, goalMin, progressPct, streak, goalReached };
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
   2. SINTETIZADOR DE SONS DE ALARME E NOTIFICAÇÕES DO WINDOWS
   ========================================================================== */

/**
 * Resolve qual alarme deve tocar a partir das configurações salvas (função pura).
 * @param {{sound?: boolean, soundType?: string}} focus
 * @returns {string} ID do som válido ('off' quando silenciado)
 */
export function resolveAlarmId(focus = {}) {
  if (focus.sound === false || focus.soundType === 'off') return 'off';
  return ALARM_SOUNDS.some((s) => s.id === focus.soundType) ? focus.soundType : 'chime';
}

/**
 * Monta a notificação de transição entre etapas da sessão (função pura).
 * @param {{type: string, minutes?: number, label?: string}|undefined} finishedStep Etapa que acabou de terminar
 * @param {{type: string, minutes: number, label: string}|undefined} nextStep Próxima etapa (undefined = sessão acabou)
 * @returns {{title: string, body: string}|null}
 */
export function buildPhaseNotification(finishedStep, nextStep) {
  if (!nextStep) {
    return {
      title: '🏆 Sessão de concentração concluída!',
      body: 'Excelente trabalho! Você finalizou todas as etapas da sua sessão de foco.',
    };
  }
  if (finishedStep && finishedStep.type === 'focus' && nextStep.type === 'break') {
    return {
      title: '☕ Hora do intervalo!',
      body: `Bloco de foco concluído. Aproveite ${nextStep.minutes} min de pausa para descansar.`,
    };
  }
  if (finishedStep && finishedStep.type === 'break' && nextStep.type === 'focus') {
    return {
      title: '🎯 Fim do intervalo!',
      body: `Hora de retomar a concentração: ${nextStep.label} (${nextStep.minutes} min).`,
    };
  }
  return null;
}

/**
 * Indica se o último incremento de minutos fez a meta diária ser batida agora (função pura).
 * @param {number} before Minutos antes do incremento
 * @param {number} after Minutos depois do incremento
 * @param {number} goal Meta diária
 * @returns {boolean}
 */
export function justReachedGoal(before, after, goal) {
  return before < goal && after >= goal;
}

let sharedAudioCtx = null;

function getAudioContext() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') sharedAudioCtx = new Ctx();
  if (sharedAudioCtx.state === 'suspended') sharedAudioCtx.resume().catch(() => {});
  return sharedAudioCtx;
}

/**
 * Toca um som de alarme usando Web Audio API.
 * Sem argumento toca o alarme configurado (respeitando "Silencioso").
 * Com `soundType` explícito é uma PRÉVIA: toca mesmo que o alarme salvo esteja silenciado,
 * para que o usuário possa ouvir antes de aplicar.
 * @param {string} [soundType] 'chime'|'bell'|'digital'|'marimba'|'harp'
 * @returns {boolean} true se algum som foi disparado
 */
export function playAlarmSound(soundType) {
  const isPreview = soundType !== undefined;
  const type = isPreview ? soundType : resolveAlarmId(state.focus);
  if (type === 'off') return false;

  try {
    const ctx = getAudioContext();
    if (!ctx) return false;
    const now = ctx.currentTime + 0.02;

    const tone = (freq, start, dur, wave = 'sine', vol = 0.16) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = wave;
      osc.frequency.setValueAtTime(freq, now + start);
      gain.gain.setValueAtTime(vol, now + start);
      gain.gain.exponentialRampToValueAtTime(0.0008, now + start + dur);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + start);
      osc.stop(now + start + dur + 0.02);
    };

    if (type === 'bell') {
      // Campainha Cristalina (harmônicos agudos)
      [880, 1318.5, 1760].forEach((f, i) => {
        tone(f, i * 0.18, 0.75, 'sine', 0.15);
        tone(f * 2, i * 0.18, 0.35, 'triangle', 0.06);
      });
    } else if (type === 'digital') {
      // Alarme Digital Clássico (bipes duplos)
      [0, 0.12, 0.24, 0.55, 0.67, 0.79].forEach((t) => {
        tone(1046.5, t, 0.08, 'square', 0.09);
      });
    } else if (type === 'marimba') {
      // Marimba Zen
      [392.0, 493.88, 587.33, 783.99].forEach((f, i) => {
        tone(f, i * 0.11, 0.32, 'triangle', 0.2);
      });
    } else if (type === 'harp') {
      // Harpa Celestial (arpejo ascendente suave)
      [523.25, 587.33, 659.25, 783.99, 1046.5].forEach((f, i) => {
        tone(f, i * 0.09, 0.65, 'sine', 0.13);
      });
    } else {
      // 'chime' (Padrão: Sino Suave)
      [523.25, 659.25, 783.99].forEach((f, i) => {
        tone(f, i * 0.15, 0.5, 'sine', 0.15);
      });
    }
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Envia uma notificação do sistema.
 * No app Desktop (Electron) usa a ponte nativa `window.rabituNative` (processo principal,
 * toast do Windows com AppUserModelID registrado). No navegador cai na Notification API da Web.
 * Nunca lança exceção: o resultado descreve o que aconteceu (útil para diagnóstico).
 * @param {string} title Título da notificação
 * @param {string} body Corpo da mensagem
 * @returns {Promise<{channel: 'native'|'web'|'unsupported'|'denied', ok: boolean, error?: string}>}
 */
export async function sendWindowsNotification(title, body) {
  try {
    if (window.rabituNative && typeof window.rabituNative.notify === 'function') {
      const r = await window.rabituNative.notify(title, body);
      return { channel: 'native', ok: !!(r && r.ok), error: r && r.error };
    }
    if (typeof Notification === 'undefined') {
      return { channel: 'unsupported', ok: false, error: 'Notification API indisponível' };
    }
    let perm = Notification.permission;
    if (perm === 'default') perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      return { channel: 'denied', ok: false, error: 'Permissão de notificação negada' };
    }
    new Notification(title, { body });
    return { channel: 'web', ok: true };
  } catch (err) {
    return { channel: 'unsupported', ok: false, error: err && err.message ? err.message : String(err) };
  }
}

/* ==========================================================================
   3. MOTOR DE EXECUÇÃO DA SESSÃO (State Machine sem Drift)
   ========================================================================== */

let activeSession = null;
let tickInterval = null;

function persistAndSyncFocus() {
  state.focus.at = Date.now();
  saveFocus();
  quiet(pushFocus);
}

/**
 * Credita minutos de foco concluídos no dia de hoje e verifica se bateu a meta diária.
 * @param {number} mins
 */
export function recordFocusMinutes(mins) {
  if (!(mins > 0)) return;
  const k = keyOf(todayN());
  state.focus.history = state.focus.history || {};
  const before = state.focus.history[k] || 0;
  const after = Math.max(0, Math.round(before + mins));
  state.focus.history[k] = after;
  persistAndSyncFocus();

  const goal = state.focus.dailyGoalMin || 240;
  if (justReachedGoal(before, after, goal)) {
    sendWindowsNotification(
      '🎉 Parabéns! Meta diária atingida!',
      `Você concluiu ${after} minutos de foco hoje e bateu sua meta diária no Rabitu!`
    );
  }
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

export function advanceSessionStep() {
  if (!activeSession) return;
  const finishedStep = activeSession.plan.steps[activeSession.stepIdx];
  creditElapsedFocusMinutes(true);
  playAlarmSound();

  activeSession.stepIdx++;
  const nextStep = activeSession.plan.steps[activeSession.stepIdx];

  const note = buildPhaseNotification(finishedStep, nextStep);
  if (note) sendWindowsNotification(note.title, note.body);

  if (!nextStep) {
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
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  } catch (_) {}

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
   4. RENDERIZAÇÃO VISUAL E ATUALIZAÇÃO DE DOM
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
  const congrats = $('clk-congrats-box');

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
  if (congrats) {
    congrats.style.display = st.goalReached ? '' : 'none';
  }
}

function alarmLabelOf(focus) {
  const id = resolveAlarmId(focus);
  const found = ALARM_SOUNDS.find((s) => s.id === id);
  return found ? found.label : 'Sino Suave (Chime)';
}

function renderLeftCardContent() {
  const f = state.focus;
  const alarmLabel = alarmLabelOf(f);

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
          <button type="button" class="clock-icon-btn" id="clk-cfg-btn" title="Configurar blocos, pausas e som">⋯</button>
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

        <label class="focus-skip-label" style="margin-bottom:14px">
          <input type="checkbox" id="clk-skip-chk" ${f.skipBreaks ? 'checked' : ''}>
          <span>Pular pausas</span>
        </label>

        <div class="focus-sound-quick">
          <button type="button" class="alarm-open-btn" id="clk-alarm-btn" title="Escolher e testar o som do alarme">
            🔔 Alarme: <b>${alarmLabel}</b> <span aria-hidden="true">›</span>
          </button>
        </div>

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
        <button type="button" class="clock-icon-btn" id="clk-cfg-btn" title="Configurar blocos, pausas e som">⋯</button>
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

          <div class="goal-congrats" id="clk-congrats-box" style="${st.goalReached ? '' : 'display:none'}">
            🎉 Parabéns! Você bateu sua meta diária de foco hoje!
          </div>
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
  $('csound').value = resolveAlarmId(state.focus); // rascunho: só vale ao clicar em Salvar
  setNotifyStatus('', '');
  dlg.showModal();
}

function saveClockConfigModal() {
  state.focus.blockMin = Math.max(15, Math.min(120, +$('cblock').value || 60));
  state.focus.breakMin = Math.max(1, Math.min(60, +$('cbreak').value || 5));
  const chosenSound = $('csound').value || 'chime';
  state.focus.soundType = chosenSound;
  state.focus.sound = chosenSound !== 'off';
  persistAndSyncFocus();
  $('cdlg').close();
  drawClock();
}

function setNotifyStatus(text, kind) {
  const el = $('cnotify-status');
  if (!el) return;
  el.textContent = text;
  el.className = 'notify-status' + (kind ? ' ' + kind : '');
}

/** Ouve a prévia do som escolhido no seletor (sem aplicar). */
function previewSelectedAlarm() {
  const id = $('csound').value;
  if (id === 'off') {
    setNotifyStatus('“Silencioso” selecionado: nenhum som será tocado ao fim de cada etapa.', '');
    return;
  }
  const played = playAlarmSound(id);
  if (!played) setNotifyStatus('Não foi possível reproduzir áudio neste dispositivo.', 'bad');
}

/** Envia uma notificação de teste e mostra se o sistema a aceitou. */
async function testNotification() {
  setNotifyStatus('Enviando…', '');
  const r = await sendWindowsNotification(
    '🔔 Rabitu — teste de notificação',
    'Se você está vendo isto, as notificações das sessões de foco estão funcionando!'
  );
  if (r.ok) {
    setNotifyStatus(
      r.channel === 'native'
        ? 'Enviada ao Windows. Se não apareceu, verifique o modo “Não incomodar” / Assistência de foco.'
        : 'Enviada pelo navegador.',
      'ok'
    );
  } else {
    setNotifyStatus(`Não foi possível notificar (${r.error || r.channel}).`, 'bad');
  }
}

function bindClockViewEvents() {
  const incBtn = $('clk-inc');
  const decBtn = $('clk-dec');
  const skipChk = $('clk-skip-chk');
  const alarmBtn = $('clk-alarm-btn');
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
  if (alarmBtn) alarmBtn.onclick = openClockConfigModal;
  if (startBtn) startBtn.onclick = startFocusSession;
  if (pauseBtn) pauseBtn.onclick = togglePauseSession;
  if (skipStepBtn) skipStepBtn.onclick = () => advanceSessionStep();
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
    $('csound-test').onclick = previewSelectedAlarm;
    // Ao trocar a opção, já toca a prévia (ainda sem aplicar).
    $('csound').onchange = previewSelectedAlarm;
    const nbtn = $('cnotify-test');
    if (nbtn) nbtn.onclick = testNotification;
    cdlg.addEventListener('click', (e) => {
      if (e.target === cdlg) cdlg.close();
    });
  }
}
