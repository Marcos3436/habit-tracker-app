/**
 * @fileoverview Gerenciamento centralizado de estado da aplicação,
 * persistência em LocalStorage, cálculo de ofensivas (streaks) e regras de negócio do Tanque de Lazer.
 */

import { keyOf, parseKey, todayN } from './dates.js';
import { uid } from './dom.js';

const KEY = 'habit-tracker.v1';
const MOCK_KEY = 'habit-tracker.is-mock';
const BK = 'habit-tracker.bank.v1';
const RK = 'habit-tracker.reward.v1';
const FK = 'habit-tracker.focus.v1';

/* Constantes de Recompensa (Tanque de Lazer):
 * 0,5h de estudo = 1 crédito = 20 min de lazer
 * Cada hábito concluído = 0,5 crédito = 10 min de lazer
 */
export const CAP = 500;
export const PER = 0.5;
export const MINS = 20;
export const HABCREDIT = 0.5;
export const HABMIN = MINS * HABCREDIT;

/**
 * Gera dados iniciais de demonstração quando o app é aberto pela primeira vez.
 */
function createMockHabits() {
  let s = 7;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const t = todayN();
  const mk = (name, p) => ({
    id: uid(),
    name,
    dates: Array.from({ length: 60 }, (_, i) => i + 1)
      .filter(() => r() < p)
      .map((i) => keyOf(t - i)),
    fails: [],
  });
  return [
    mk('2h de estudo', 0.8),
    mk('5 Lições duolingo', 0.9),
    mk('15m de limpeza', 0.6),
    mk('Treino', 0.5),
  ];
}

/* Inicialização do estado local */
let loadedHabits = null;
let isMock = false;
try {
  loadedHabits = JSON.parse(localStorage.getItem(KEY));
  isMock = localStorage.getItem(MOCK_KEY) === '1';
} catch (_) {}

if (!loadedHabits) {
  loadedHabits = createMockHabits();
  isMock = true;
  try {
    localStorage.setItem(MOCK_KEY, '1');
  } catch (_) {}
}
loadedHabits.forEach((h) => {
  h.dates = h.dates || [];
  h.fails = h.fails || [];
});

let loadedBank = [];
try {
  loadedBank = JSON.parse(localStorage.getItem(BK)) || [];
} catch (_) {}
loadedBank.forEach((b) => {
  b.done = b.done || [];
  b.half = b.half || [];
});

let loadedRw = { hours: 0, spentMin: 0, habitMin: 0, at: 0 };
let rwSaved = false;
try {
  const j = JSON.parse(localStorage.getItem(RK));
  if (j) {
    Object.assign(loadedRw, j);
    rwSaved = true;
  }
} catch (_) {}

// Migração de formato legado (créditos usados -> minutos)
if (loadedRw.spent !== undefined) {
  loadedRw.spentMin = (loadedRw.spentMin || 0) + loadedRw.spent * MINS;
  delete loadedRw.spent;
}
if (!rwSaved) {
  loadedRw.hours =
    Math.round(loadedBank.reduce((a, b) => a + b.done.length * b.hours, 0) * 100) / 100;
}

// Migração da regra de hábitos: antes 1 hábito = 15 min; agora 0,5 crédito = 10 min.
// Reescala o acumulado uma única vez para que desmarcar hábitos antigos continue consistente.
if (loadedRw.habitRule !== 2) {
  if (rwSaved && loadedRw.habitMin) {
    loadedRw.habitMin = Math.round((loadedRw.habitMin * HABMIN) / 15);
    loadedRw.at = Date.now(); // mais recente que a nuvem: o novo valor é enviado ao Supabase
  }
  loadedRw.habitRule = 2;
  try {
    localStorage.setItem(RK, JSON.stringify(loadedRw));
  } catch (_) {}
}

export const DEFAULT_TIMERS = [
  { id: 't-30m', name: '30 minutos', durationSec: 1800 },
  { id: 't-15m', name: '15 minutos', durationSec: 900 },
  { id: 't-60m', name: '1 hora', durationSec: 3600 },
];

let loadedFocus = {
  sessionMin: 180,
  skipBreaks: false,
  blockMin: 60,
  breakMin: 5,
  sound: true,
  soundType: 'chime',
  dailyGoalMin: 240,
  history: {},
  timers: DEFAULT_TIMERS.map((t) => ({ ...t })),
  subtab: 'focus',
  at: 0,
};
try {
  const f = JSON.parse(localStorage.getItem(FK));
  if (f && typeof f === 'object') {
    Object.assign(loadedFocus, f);
    if (!f.soundType) {
      loadedFocus.soundType = f.sound === false ? 'off' : 'chime';
    }
    loadedFocus.history = loadedFocus.history && typeof loadedFocus.history === 'object' ? loadedFocus.history : {};
    if (!Array.isArray(loadedFocus.timers)) {
      loadedFocus.timers = DEFAULT_TIMERS.map((t) => ({ ...t }));
    } else {
      loadedFocus.timers = loadedFocus.timers
        .filter((t) => t && typeof t === 'object')
        .map((t, idx) => ({
          id: String(t.id || `t-${idx}-${uid()}`),
          name: String(t.name || `Temporizador ${idx + 1}`).slice(0, 40),
          durationSec: Math.max(1, Math.min(359999, Math.round(+t.durationSec || 60))),
        }));
    }
    if (loadedFocus.subtab !== 'timer') loadedFocus.subtab = 'focus';
  }
} catch (_) {}

const now = new Date();

/**
 * Estado reativo compartilhado entre os módulos.
 */
export const state = {
  habits: loadedHabits,
  isMock,
  bank: loadedBank,
  rw: loadedRw,
  focus: loadedFocus,
  activeTab: 'habits',
  view: {
    y: now.getFullYear(),
    m: now.getMonth(),
    w: 0,
  },
};

/* Listeners de atualização de interface */
const listeners = new Set();
export function subscribeUI(fn) {
  listeners.add(fn);
}
export function notifyUI() {
  listeners.forEach((fn) => fn());
}

/**
 * Salva a lista de hábitos no LocalStorage.
 * @param {boolean} [userAction=true] Se verdadeiro, desmarca a flag de dados mock.
 */
export function saveHabits(userAction = true) {
  if (userAction && state.isMock) {
    state.isMock = false;
    try {
      localStorage.removeItem(MOCK_KEY);
    } catch (_) {}
  }
  try {
    localStorage.setItem(KEY, JSON.stringify(state.habits));
  } catch (_) {}
}

/**
 * Salva a lista de atividades do Banco de Horas no LocalStorage.
 */
export function saveBank() {
  try {
    localStorage.setItem(BK, JSON.stringify(state.bank));
  } catch (_) {}
}

/**
 * Salva o estado do Tanque de Lazer no LocalStorage.
 */
export function persistRw() {
  try {
    localStorage.setItem(RK, JSON.stringify(state.rw));
  } catch (_) {}
  notifyUI();
}

/**
 * Salva as configurações e histórico do Relógio de Foco no LocalStorage.
 */
export function saveFocus() {
  try {
    localStorage.setItem(FK, JSON.stringify(state.focus));
  } catch (_) {}
}

/**
 * Calcula estatísticas de ofensiva (streak atual, melhor ofensiva e total) de um hábito.
 * @param {{dates: string[]}} h
 * @returns {{cur: number, best: number, total: number}}
 */
export function stats(h) {
  const set = new Set(h.dates);
  let n = todayN();
  let cur = 0;
  if (!set.has(keyOf(n))) n--; // Hoje ainda pode ser marcado sem quebrar a ofensiva de ontem
  while (set.has(keyOf(n))) {
    cur++;
    n--;
  }
  const nums = [...set].map(parseKey).sort((a, b) => a - b);
  let best = 0;
  let run = 0;
  let p = null;
  for (const x of nums) {
    run = p !== null && x === p + 1 ? run + 1 : 1;
    best = Math.max(best, run);
    p = x;
  }
  return { cur, best, total: set.size };
}

/**
 * Calcula créditos ganhos pelas horas acumuladas no Banco de Horas.
 * @returns {number}
 */
export const earned = () => Math.floor((state.rw.hours + 1e-9) / PER);

/**
 * Calcula o saldo líquido em créditos de lazer (pode ser negativo em caso de dívida).
 * @returns {number}
 */
export const balance = () =>
  (earned() * MINS + (state.rw.habitMin || 0) - state.rw.spentMin) / MINS;

/**
 * Formata minutos em string legível (ex.: "45 min" ou "1h30").
 * @param {number} m
 * @returns {string}
 */
export const fMin = (m) =>
  m >= 60
    ? Math.floor(m / 60) + 'h' + (m % 60 ? String(m % 60).padStart(2, '0') : '')
    : m + ' min';

/**
 * Formata horas decimais no padrão brasileiro (ex.: "1,5h").
 * @param {number} h
 * @returns {string}
 */
export const fH = (h) => (Math.round(h * 100) / 100).toLocaleString('pt-BR') + 'h';
