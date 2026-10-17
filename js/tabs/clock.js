/**
 * @fileoverview Módulo da Aba 4: Relógio de Foco (Sessões de Concentração & Andamento Diário).
 * Arquitetura baseada em funções puras (determinísticas e testáveis), múltiplos timbres de alarme,
 * notificações nativas do Windows e motor de tempo baseado em timestamps reais (Date.now).
 */

import { keyOf, todayN } from '../core/dates.js';
import { $, esc, uid } from '../core/dom.js';
import { DEFAULT_TIMERS, saveFocus, state } from '../core/state.js';
import { pushFocus, quiet } from '../core/supabase.js';

export const MIN_SESSION_MIN = 15;
export const MAX_SESSION_MIN = 240;
export const SESSION_STEP_MIN = 15;

export const TCARD_RADIUS = 86;
export const TCARD_CIRC = 2 * Math.PI * TCARD_RADIUS;

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

/**
 * Formata segundos sempre em 'HH:MM:SS' (padrão visual dos cartões de Temporizador).
 * @param {number} totalSeconds
 * @returns {string}
 */
export function formatTimerHMS(totalSeconds) {
  const s = Math.max(0, Math.ceil(+totalSeconds || 0));
  const hrs = Math.floor(s / 3600);
  const mins = Math.floor((s % 3600) / 60);
  const secs = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
}

/**
 * Converte (horas, minutos, segundos) em total de segundos válidos (0 se vazio/inválido, máx 99:59:59).
 * @param {number} [hours=0]
 * @param {number} [minutes=0]
 * @param {number} [seconds=0]
 * @returns {number}
 */
export function calcTimerDurationSec(hours = 0, minutes = 0, seconds = 0) {
  const h = Math.max(0, Math.min(99, Math.floor(+hours || 0)));
  const m = Math.max(0, Math.min(59, Math.floor(+minutes || 0)));
  const s = Math.max(0, Math.min(59, Math.floor(+seconds || 0)));
  const total = h * 3600 + m * 60 + s;
  return total > 0 ? Math.min(359999, total) : 0;
}

/**
 * Decompõe um total de segundos em { hours, minutes, seconds }.
 * @param {number} totalSeconds
 * @returns {{hours: number, minutes: number, seconds: number}}
 */
export function splitTimerDurationHMS(totalSeconds) {
  const s = Math.max(0, Math.round(+totalSeconds || 0));
  return {
    hours: Math.floor(s / 3600),
    minutes: Math.floor((s % 3600) / 60),
    seconds: s % 60,
  };
}

/**
 * Calcula a proporção e o stroke-dashoffset do anel circular de um temporizador.
 * @param {number} remainingSec
 * @param {number} durationSec
 * @param {number} [circumference=TCARD_CIRC]
 * @returns {{remainingSec: number, ratio: number, dashOffset: number}}
 */
export function calcTimerProgress(remainingSec, durationSec, circumference = TCARD_CIRC) {
  const dur = Math.max(1, +durationSec || 1);
  const rem = Math.max(0, Math.min(dur, +remainingSec || 0));
  const ratio = rem / dur;
  const dashOffset = circumference * (1 - ratio);
  return { remainingSec: rem, ratio, dashOffset };
}

/**
 * Monta a notificação do Windows quando um temporizador chega a 00:00:00.
 * @param {string} timerName
 * @param {number} durationSec
 * @returns {{title: string, body: string}}
 */
export function buildTimerNotification(timerName, durationSec) {
  const safeName = String(timerName || 'Temporizador').trim() || 'Temporizador';
  return {
    title: '⏰ Temporizador concluído!',
    body: `O temporizador "${safeName}" (${formatTimerHMS(durationSec)}) chegou ao fim.`,
  };
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
   3. MOTOR DE EXECUÇÃO DA SESSÃO E TEMPORIZADORES (State Machine sem Drift)
   ========================================================================== */

let activeSession = null;
let tickInterval = null;
let editingTimerId = null;
let expandedTimerId = null;

/**
 * Estado em memória de cada temporizador:
 * Map<timerId, { running: boolean, accumulatedSec: number, lastResumeAt: number, finished: boolean }>
 */
const timerRuntime = new Map();

function ensureTimersArray() {
  if (!Array.isArray(state.focus.timers)) {
    state.focus.timers = DEFAULT_TIMERS.map((t) => ({ ...t }));
  }
  return state.focus.timers;
}

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

/* --- Temporizadores individuais --- */

function getTimerElapsedSec(id) {
  const rt = timerRuntime.get(id);
  if (!rt) return 0;
  const delta = rt.running ? (Date.now() - rt.lastResumeAt) / 1000 : 0;
  return rt.accumulatedSec + delta;
}

export function getTimerRemainingSec(timer) {
  if (!timer) return 0;
  const rt = timerRuntime.get(timer.id);
  if (!rt) return timer.durationSec;
  if (rt.finished) return 0;
  return Math.max(0, timer.durationSec - getTimerElapsedSec(timer.id));
}

function hasAnyRunningTimer() {
  for (const rt of timerRuntime.values()) {
    if (rt && rt.running) return true;
  }
  return false;
}

function countRunningTimers() {
  let c = 0;
  for (const rt of timerRuntime.values()) {
    if (rt && rt.running) c++;
  }
  return c;
}

function ensureTickLoop() {
  const sessionRunning = !!(activeSession && !activeSession.paused);
  const timersRunning = hasAnyRunningTimer();
  if (sessionRunning || timersRunning) {
    if (!tickInterval) {
      tickInterval = setInterval(onTimerTick, 200);
    }
  } else if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
}

export function completeTimer(timerId) {
  const timers = ensureTimersArray();
  const timer = timers.find((t) => t.id === timerId);
  if (!timer) return;

  timerRuntime.set(timerId, {
    running: false,
    accumulatedSec: timer.durationSec,
    lastResumeAt: 0,
    finished: true,
  });

  playAlarmSound();
  const note = buildTimerNotification(timer.name, timer.durationSec);
  sendWindowsNotification(note.title, note.body);

  ensureTickLoop();
  drawClock();
}

export function toggleTimer(timerId) {
  const timers = ensureTimersArray();
  const timer = timers.find((t) => t.id === timerId);
  if (!timer) return;

  const rt = timerRuntime.get(timerId) || {
    running: false,
    accumulatedSec: 0,
    lastResumeAt: 0,
    finished: false,
  };

  if (rt.running) {
    rt.accumulatedSec = getTimerElapsedSec(timerId);
    rt.running = false;
    timerRuntime.set(timerId, rt);
  } else {
    if (rt.finished || getTimerRemainingSec(timer) <= 0) {
      rt.accumulatedSec = 0;
      rt.finished = false;
    }
    rt.running = true;
    rt.lastResumeAt = Date.now();
    timerRuntime.set(timerId, rt);
  }

  ensureTickLoop();
  drawClock();
}

export function resetTimer(timerId) {
  timerRuntime.delete(timerId);
  ensureTickLoop();
  drawClock();
}

function updateTimerCardDOM(timer) {
  const rem = getTimerRemainingSec(timer);
  const prog = calcTimerProgress(rem, timer.durationSec);
  const digitsEl = $(`tcard-digits-${timer.id}`);
  const arcEl = $(`tcard-arc-${timer.id}`);
  if (digitsEl) digitsEl.textContent = formatTimerHMS(rem);
  if (arcEl) {
    arcEl.style.strokeDashoffset = String(prog.dashOffset);
    arcEl.classList.add('is-active');
  }
}

function onTimerTick() {
  // 1. Atualiza sessão de concentração (se ativa)
  if (activeSession && !activeSession.paused) {
    const step = activeSession.plan.steps[activeSession.stepIdx];
    if (step) {
      const totalSec = step.minutes * 60;
      const elapsedSec = getPhaseElapsedSec();
      creditElapsedFocusMinutes(false);

      if (elapsedSec >= totalSec) {
        advanceSessionStep();
      } else {
        updateActiveTimerDOM(totalSec - elapsedSec, totalSec);
      }
    }
  }

  // 2. Atualiza temporizadores em execução
  const timers = ensureTimersArray();
  for (const timer of timers) {
    const rt = timerRuntime.get(timer.id);
    if (!rt || !rt.running) continue;
    const rem = timer.durationSec - getTimerElapsedSec(timer.id);
    if (rem <= 0) {
      completeTimer(timer.id);
    } else {
      updateTimerCardDOM(timer);
    }
  }

  ensureTickLoop();
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
  ensureTickLoop();
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
  ensureTickLoop();
  drawClock();
}

export function stopFocusSession(flushPartial = true) {
  if (activeSession && flushPartial) {
    creditElapsedFocusMinutes(false);
  }
  activeSession = null;
  ensureTickLoop();
  drawClock();
}

export function switchClockSubtab(subtab) {
  const next = subtab === 'timer' ? 'timer' : 'focus';
  state.focus.subtab = next;
  saveFocus();
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

function renderClockSidebar() {
  const sub = state.focus.subtab === 'timer' ? 'timer' : 'focus';
  const runningTimers = countRunningTimers();
  const focusRunning = !!(activeSession && !activeSession.paused);

  return `
    <aside class="clock-sidebar" aria-label="Menu do Relógio">
      <div class="clock-sidebar-brand">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9"></circle>
          <polyline points="12 7 12 12 15.5 14"></polyline>
        </svg>
        <span>Relógio</span>
      </div>

      <button type="button" class="clock-nav-item ${sub === 'focus' ? 'active' : ''}" id="clk-nav-focus">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9"></circle>
          <circle cx="12" cy="12" r="5" stroke-dasharray="3 3"></circle>
          <circle cx="12" cy="12" r="1.5" fill="currentColor"></circle>
        </svg>
        <span>Sessões de concentração</span>
        ${focusRunning ? '<span class="clock-nav-badge" title="Sessão ativa">●</span>' : ''}
      </button>

      <button type="button" class="clock-nav-item ${sub === 'timer' ? 'active' : ''}" id="clk-nav-timer">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M5 3h14"></path>
          <path d="M5 21h14"></path>
          <path d="M7 3v4a5 5 0 0 0 5 5 5 5 0 0 0 5-5V3"></path>
          <path d="M7 21v-4a5 5 0 0 1 5-5 5 5 0 0 1 5 5v4"></path>
        </svg>
        <span>Temporizador</span>
        ${runningTimers > 0 ? `<span class="clock-nav-badge" title="Temporizadores ativos">${runningTimers}</span>` : ''}
      </button>
    </aside>
  `;
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

function renderFocusView() {
  const st = calcDailyFocusStats(state.focus.history, state.focus.dailyGoalMin);
  const gDisp = formatGoalDisplay(st.goalMin);
  const goalDashOffset = GOAL_CIRC * (1 - st.progressPct / 100);

  return `
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
}

function renderTimerCard(timer, isExpanded) {
  const rt = timerRuntime.get(timer.id) || {
    running: false,
    accumulatedSec: 0,
    lastResumeAt: 0,
    finished: false,
  };
  const remainingSec = getTimerRemainingSec(timer);
  const isRunning = !!rt.running;
  const isFinished = !!rt.finished;
  const hasStarted = isRunning || rt.accumulatedSec > 0 || isFinished;
  const prog = calcTimerProgress(isFinished ? timer.durationSec : remainingSec, timer.durationSec);
  const idEsc = esc(timer.id);

  return `
    <div class="timer-card ${isExpanded ? 'is-expanded' : ''}" data-timer-card="${idEsc}">
      <div class="timer-card-top">
        <span class="timer-card-name" title="${esc(timer.name)}">${esc(timer.name)}</span>
        <div class="timer-card-actions">
          <button
            type="button"
            class="clock-icon-btn"
            data-expand-timer="${idEsc}"
            data-tip="${isExpanded ? 'Restaurar visualização em grade' : 'Expandir temporizador'}"
            aria-label="${isExpanded ? 'Restaurar' : 'Expandir'}"
          >
            ${
              isExpanded
                ? `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline><line x1="14" y1="10" x2="21" y2="3"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>`
                : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>`
            }
          </button>
          <button
            type="button"
            class="clock-icon-btn"
            data-edit-timer="${idEsc}"
            data-tip="Editar temporizador"
            aria-label="Editar temporizador"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"></path></svg>
          </button>
        </div>
      </div>

      <div class="tcard-ring-wrap" data-edit-timer="${idEsc}" data-tip="Editar temporizador">
        <svg class="tcard-ring-svg" viewBox="0 0 208 208">
          <circle class="tcard-ring-bg" cx="104" cy="104" r="${TCARD_RADIUS}"></circle>
          <circle
            class="tcard-ring-fg ${hasStarted ? 'is-active' : ''} ${isFinished ? 'is-finished' : ''}"
            id="tcard-arc-${idEsc}"
            cx="104"
            cy="104"
            r="${TCARD_RADIUS}"
            stroke-dasharray="${TCARD_CIRC}"
            stroke-dashoffset="${prog.dashOffset}"
          ></circle>
        </svg>
        <div class="tcard-center">
          <strong class="tcard-digits" id="tcard-digits-${idEsc}">${formatTimerHMS(remainingSec)}</strong>
          <span class="tcard-sub ${isFinished ? 'done' : ''}" id="tcard-sub-${idEsc}">
            ${isFinished ? '🔔 Tempo esgotado!' : !isRunning && hasStarted ? 'Pausado' : ''}
          </span>
        </div>
      </div>

      <div class="timer-card-controls">
        <button
          type="button"
          class="tcard-play-btn"
          id="tcard-play-${idEsc}"
          data-play-timer="${idEsc}"
          data-tip="${isRunning ? 'Pausar temporizador' : 'Iniciar temporizador'}"
          aria-label="${isRunning ? 'Pausar' : 'Iniciar'}"
        >
          ${isRunning ? '⏸' : '▶'}
        </button>
        <button
          type="button"
          class="tcard-reset-btn"
          id="tcard-reset-${idEsc}"
          data-reset-timer="${idEsc}"
          data-tip="Reiniciar temporizador"
          aria-label="Reiniciar"
          ${!hasStarted ? 'disabled' : ''}
        >
          ↺
        </button>
      </div>
    </div>
  `;
}

function renderTimersView() {
  const timers = ensureTimersArray();
  const alarmLabel = alarmLabelOf(state.focus);
  const visibleTimers =
    expandedTimerId && timers.some((t) => t.id === expandedTimerId)
      ? timers.filter((t) => t.id === expandedTimerId)
      : timers;
  const isExpandedMode = visibleTimers.length === 1 && expandedTimerId === visibleTimers[0].id;

  const cardsHtml = timers.length
    ? visibleTimers.map((t) => renderTimerCard(t, isExpandedMode)).join('')
    : `<div class="timers-empty">Nenhum temporizador cadastrado. Clique em <b>+ Adicionar temporizador</b> para criar o primeiro!</div>`;

  return `
    <div class="timers-wrap">
      <div class="timers-toolbar">
        <span class="timers-toolbar-title">Temporizador</span>
        <div class="timers-toolbar-actions">
          <button type="button" class="alarm-open-btn" id="clk-timer-alarm-btn" title="Escolher e testar o som do alarme">
            🔔 Alarme: <b>${alarmLabel}</b> <span aria-hidden="true">›</span>
          </button>
          <button type="button" class="timers-add-btn" id="clk-add-timer-btn">
            <span>＋</span>
            <span>Adicionar temporizador</span>
          </button>
        </div>
      </div>

      <div class="timers-grid ${isExpandedMode ? 'has-expanded' : ''}" id="clk-timers-grid">
        ${cardsHtml}
      </div>

      <button
        type="button"
        class="timers-fab"
        id="clk-fab-add-timer"
        data-tip="Adicionar novo temporizador"
        aria-label="Adicionar novo temporizador"
      >＋</button>
    </div>
  `;
}

/**
 * Renderiza a aba completa do Relógio de Foco (#clock) com painel lateral e visão ativa.
 */
export function drawClock() {
  const clockEl = $('clock');
  if (!clockEl) return;

  const sub = state.focus.subtab === 'timer' ? 'timer' : 'focus';

  clockEl.innerHTML = `
    <div class="clock-shell">
      ${renderClockSidebar()}
      <div class="clock-content">
        ${sub === 'timer' ? renderTimersView() : renderFocusView()}
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

/* --- Modal de Criar / Editar Temporizador (#tdlg) --- */

export function openTimerModal(timerId = null) {
  const dlg = $('tdlg');
  if (!dlg) return;
  const timers = ensureTimersArray();
  const existing = timerId ? timers.find((t) => t.id === timerId) : null;
  editingTimerId = existing ? existing.id : null;

  $('ttitle').textContent = existing ? 'Editar temporizador' : 'Novo temporizador';
  $('tname').value = existing ? existing.name : '';
  const hms = splitTimerDurationHMS(existing ? existing.durationSec : 1800);
  $('thours').value = String(hms.hours);
  $('tmins').value = String(hms.minutes);
  $('tsecs').value = String(hms.seconds);
  $('terr').textContent = '';
  $('tdel').style.display = existing ? '' : 'none';
  dlg.showModal();
  $('tname').focus();
}

function saveTimerModal() {
  const dlg = $('tdlg');
  if (!dlg) return;
  const durSec = calcTimerDurationSec($('thours').value, $('tmins').value, $('tsecs').value);
  if (durSec <= 0) {
    $('terr').textContent = 'Defina um tempo maior que zero (ex.: 15 minutos).';
    return;
  }

  const rawName = $('tname').value.trim();
  const fallbackName = formatTimerHMS(durSec);
  const name = (rawName || fallbackName).slice(0, 40);
  const timers = ensureTimersArray();

  if (editingTimerId) {
    const t = timers.find((x) => x.id === editingTimerId);
    if (t) {
      t.name = name;
      if (t.durationSec !== durSec) {
        t.durationSec = durSec;
        timerRuntime.delete(t.id);
      }
    }
  } else {
    timers.push({
      id: 't-' + uid(),
      name,
      durationSec: durSec,
    });
  }

  editingTimerId = null;
  ensureTickLoop();
  persistAndSyncFocus();
  dlg.close();
  drawClock();
}

function deleteTimerFromModal() {
  if (!editingTimerId) return;
  const timers = ensureTimersArray();
  const idx = timers.findIndex((t) => t.id === editingTimerId);
  if (idx >= 0) timers.splice(idx, 1);
  timerRuntime.delete(editingTimerId);
  if (expandedTimerId === editingTimerId) expandedTimerId = null;
  editingTimerId = null;
  ensureTickLoop();
  persistAndSyncFocus();
  $('tdlg').close();
  drawClock();
}

function bindClockViewEvents() {
  // Painel lateral de navegação (Sessões de concentração <-> Temporizador)
  const navFocus = $('clk-nav-focus');
  const navTimer = $('clk-nav-timer');
  if (navFocus) navFocus.onclick = () => switchClockSubtab('focus');
  if (navTimer) navTimer.onclick = () => switchClockSubtab('timer');

  // Eventos da aba Sessões de concentração
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

  // Eventos da aba Temporizador
  const timerAlarmBtn = $('clk-timer-alarm-btn');
  const addTimerBtn = $('clk-add-timer-btn');
  const fabAddTimer = $('clk-fab-add-timer');
  const timersGrid = $('clk-timers-grid');

  if (timerAlarmBtn) timerAlarmBtn.onclick = openClockConfigModal;
  if (addTimerBtn) addTimerBtn.onclick = () => openTimerModal(null);
  if (fabAddTimer) fabAddTimer.onclick = () => openTimerModal(null);

  if (timersGrid) {
    timersGrid.onclick = (e) => {
      const playBtn = e.target.closest('[data-play-timer]');
      if (playBtn) {
        toggleTimer(playBtn.dataset.playTimer);
        return;
      }
      const resetBtn = e.target.closest('[data-reset-timer]');
      if (resetBtn) {
        resetTimer(resetBtn.dataset.resetTimer);
        return;
      }
      const expandBtn = e.target.closest('[data-expand-timer]');
      if (expandBtn) {
        const id = expandBtn.dataset.expandTimer;
        expandedTimerId = expandedTimerId === id ? null : id;
        drawClock();
        return;
      }
      const editBtn = e.target.closest('[data-edit-timer]');
      if (editBtn) {
        openTimerModal(editBtn.dataset.editTimer);
      }
    };
  }
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

  const tdlg = $('tdlg');
  if (tdlg) {
    $('tok').onclick = saveTimerModal;
    $('tcancel').onclick = () => tdlg.close();
    $('tdel').onclick = deleteTimerFromModal;
    $('tname').onkeydown = (e) => {
      if (e.key === 'Enter') saveTimerModal();
    };
    const presets = $('tpresets');
    if (presets) {
      presets.onclick = (e) => {
        const btn = e.target.closest('[data-sec]');
        if (!btn) return;
        const hms = splitTimerDurationHMS(+btn.dataset.sec);
        $('thours').value = String(hms.hours);
        $('tmins').value = String(hms.minutes);
        $('tsecs').value = String(hms.seconds);
        if (!$('tname').value.trim()) {
          $('tname').value = btn.textContent.trim();
        }
      };
    }
    tdlg.addEventListener('click', (e) => {
      if (e.target === tdlg) tdlg.close();
    });
  }
}
