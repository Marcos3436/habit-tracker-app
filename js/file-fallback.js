/* Gerado por scripts/release.mjs — NÃO editar à mão. Fallback para execução direta via file:// */
(() => {
'use strict';

/* === js/core/dates.js === */
/**
 * @fileoverview Motor de manipulação de datas em dias inteiros UTC desde 1970-01-01.
 * Evita bugs de fuso horário (horário de verão / meia-noite local vs UTC).
 */

const DAY = 864e5;
const WD = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];
const MONTHS_SHORT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const MONTHS_INITIAL = 'JFMAMJJASOND';

/**
 * Converte um objeto Date para o número inteiro de dias desde 01/01/1970 (UTC).
 * @param {Date} d
 * @returns {number}
 */
const nOf = (d) => Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY);

/**
 * Converte o índice inteiro do dia (n) para string ISO 'YYYY-MM-DD'.
 * @param {number} n
 * @returns {string}
 */
const keyOf = (n) => new Date(n * DAY).toISOString().slice(0, 10);

/**
 * Converte uma string 'YYYY-MM-DD' de volta para o índice inteiro do dia (n).
 * @param {string} k
 * @returns {number}
 */
const parseKey = (k) => Math.floor(Date.parse(k) / DAY);

/**
 * Retorna o índice inteiro do dia de hoje.
 * @returns {number}
 */
const todayN = () => nOf(new Date());

/**
 * Retorna o dia da semana (0 = Domingo ... 6 = Sábado) para um dia n.
 * @param {number} n
 * @returns {number}
 */
const dow = (n) => (n + 4) % 7;

/**
 * Retorna o índice inteiro do primeiro dia do mês (m: 0..11) do ano y.
 * @param {number} y
 * @param {number} m
 * @returns {number}
 */
const mStart = (y, m) => Math.floor(Date.UTC(y, m, 1) / DAY);

/**
 * Retorna a quantidade de dias no mês (m: 0..11) do ano y.
 * @param {number} y
 * @param {number} m
 * @returns {number}
 */
const dim = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

/**
 * Retorna a quantidade de semanas (linhas no calendário) de um mês.
 * @param {number} y
 * @param {number} m
 * @returns {number}
 */
const nWeeks = (y, m) => Math.ceil((dow(mStart(y, m)) + dim(y, m)) / 7);

/**
 * Formata o índice inteiro do dia (n) como 'DD/MM/AAAA'.
 * @param {number} n
 * @returns {string}
 */
const fmtD = (n) => keyOf(n).split('-').reverse().join('/');

/**
 * Formata mês e ano por extenso em português (ex.: "outubro de 2026").
 * @param {number} y
 * @param {number} m
 * @returns {string}
 */
const fmtMonthYear = (y, m) =>
  new Date(Date.UTC(y, m, 1)).toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });


/* === js/core/dom.js === */
/**
 * @fileoverview Utilitários de DOM, segurança (escape XSS), tema claro/escuro,
 * modal de confirmação assíncrono (compatível com Web e Electron) e sistema de Tooltips.
 */

const THEME_KEY = 'habit-tracker.theme';

/**
 * Atalho para document.getElementById.
 * @param {string} id
 * @returns {HTMLElement|null}
 */
const $ = (id) => document.getElementById(id);

/**
 * Escapa caracteres HTML especiais para prevenir XSS em templates.
 * @param {string} s
 * @returns {string}
 */
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));

/**
 * Gera um identificador único (UUID v4 ou fallback seguro).
 * @returns {string}
 */
const uid = () =>
  crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2);

/**
 * Modal de confirmação interno ao app (substitui o window.confirm nativo, que trava o Electron).
 * @param {string} msg Mensagem da pergunta
 * @param {string} [label='Excluir'] Texto do botão de confirmação
 * @returns {Promise<boolean>}
 */
function ask(msg, label = 'Excluir') {
  return new Promise((resolve) => {
    const q = $('qdlg');
    $('qmsg').textContent = msg;
    $('qyes').textContent = label;
    $('qyes').classList.toggle('danger', label === 'Excluir');
    q.returnValue = '';
    $('qyes').onclick = () => {
      q.returnValue = 'y';
      q.close();
    };
    $('qno').onclick = () => q.close();
    q.onclose = () => resolve(q.returnValue === 'y');
    q.showModal();
  });
}

/**
 * Inicializa e gerencia o tema Claro / Escuro.
 */
function initTheme() {
  function setTheme(theme) {
    document.documentElement.dataset.theme = theme;
    $('theme').textContent = theme === 'dark' ? '☀️' : '🌙';
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch (_) {}
  }

  $('theme').onclick = () =>
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');

  let saved = null;
  try {
    saved = localStorage.getItem(THEME_KEY);
  } catch (_) {}

  const prefersDark = matchMedia('(prefers-color-scheme: dark)').matches;
  setTheme(saved || (prefersDark ? 'dark' : 'light'));
}

/** Tempo padrão (em ms) com o cursor sobre o elemento antes de exibir a descrição: 1,75s */
const DEFAULT_TIP_DELAY = 1750;

/**
 * Inicializa o sistema de Tooltips customizados baseado na Popover API.
 */
function initTooltips() {
  const tip = $('tip');
  let tipEl = null;
  let tipTimer = null;

  function hideTip() {
    clearTimeout(tipTimer);
    tipEl = null;
    try {
      tip.hidePopover();
    } catch (_) {}
  }

  function showTip(el) {
    tipEl = el;
    tip.textContent = el.dataset.tip;
    try {
      if (!tip.matches(':popover-open')) tip.showPopover();
    } catch (_) {}
    const r = el.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    let x = r.left + r.width / 2 - t.width / 2;
    let y = r.top - t.height - 10;
    if (y < 6) y = r.bottom + 10;
    tip.style.left = Math.max(6, Math.min(x, innerWidth - t.width - 6)) + 'px';
    tip.style.top = y + 'px';
  }

  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest('[title],[data-tip]');
    if (el) {
      const t = el.getAttribute('title');
      if (t) {
        el.dataset.tip = t;
        el.removeAttribute('title');
      }
    }
    if (el && el.dataset.tip) {
      if (el !== tipEl) {
        hideTip();
        tipEl = el;
        const delay = +el.dataset.tipDelay || DEFAULT_TIP_DELAY;
        tipTimer = setTimeout(() => {
          if (tipEl === el) showTip(el);
        }, delay);
      }
    } else {
      hideTip();
    }
  });

  document.addEventListener('mousedown', hideTip);
  document.addEventListener('scroll', hideTip, true);
  document.documentElement.addEventListener('mouseleave', hideTip);
}


/* === js/core/state.js === */
/**
 * @fileoverview Gerenciamento centralizado de estado da aplicação,
 * persistência em LocalStorage, cálculo de ofensivas (streaks) e regras de negócio do Tanque de Lazer.
 */

const KEY = 'habit-tracker.v1';
const MOCK_KEY = 'habit-tracker.is-mock';
const BK = 'habit-tracker.bank.v1';
const RK = 'habit-tracker.reward.v1';
const FK = 'habit-tracker.focus.v1';

/* Constantes de Recompensa (Tanque de Lazer):
 * 0,5h de estudo = 1 crédito = 20 min de lazer
 * Cada hábito concluído = 0,5 crédito = 10 min de lazer
 */
const CAP = 500;
const PER = 0.5;
const MINS = 20;
const HABCREDIT = 0.5;
const HABMIN = MINS * HABCREDIT;

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

const DEFAULT_TIMERS = [
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
const state = {
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
function subscribeUI(fn) {
  listeners.add(fn);
}
function notifyUI() {
  listeners.forEach((fn) => fn());
}

/**
 * Salva a lista de hábitos no LocalStorage.
 * @param {boolean} [userAction=true] Se verdadeiro, desmarca a flag de dados mock.
 */
function saveHabits(userAction = true) {
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
function saveBank() {
  try {
    localStorage.setItem(BK, JSON.stringify(state.bank));
  } catch (_) {}
}

/**
 * Salva o estado do Tanque de Lazer no LocalStorage.
 */
function persistRw() {
  try {
    localStorage.setItem(RK, JSON.stringify(state.rw));
  } catch (_) {}
  notifyUI();
}

/**
 * Salva as configurações e histórico do Relógio de Foco no LocalStorage.
 */
function saveFocus() {
  try {
    localStorage.setItem(FK, JSON.stringify(state.focus));
  } catch (_) {}
}

/**
 * Calcula estatísticas de ofensiva (streak atual, melhor ofensiva e total) de um hábito.
 * @param {{dates: string[]}} h
 * @returns {{cur: number, best: number, total: number}}
 */
function stats(h) {
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
const earned = () => Math.floor((state.rw.hours + 1e-9) / PER);

/**
 * Calcula o saldo líquido em créditos de lazer (pode ser negativo em caso de dívida).
 * @returns {number}
 */
const balance = () =>
  (earned() * MINS + (state.rw.habitMin || 0) - state.rw.spentMin) / MINS;

/**
 * Formata minutos em string legível (ex.: "45 min" ou "1h30").
 * @param {number} m
 * @returns {string}
 */
const fMin = (m) =>
  m >= 60
    ? Math.floor(m / 60) + 'h' + (m % 60 ? String(m % 60).padStart(2, '0') : '')
    : m + ' min';

/**
 * Formata horas decimais no padrão brasileiro (ex.: "1,5h").
 * @param {number} h
 * @returns {string}
 */
const fH = (h) => (Math.round(h * 100) / 100).toLocaleString('pt-BR') + 'h';


/* === js/core/supabase.js === */
/**
 * @fileoverview Cliente REST direto para o Supabase (sem dependências externas)
 * e motor de sincronização bidirecional (Hábitos, Conclusões, Banco de Horas e Tanque de Lazer).
 */

const SB_KEY = 'habit-tracker.sb';
const UP = { Prefer: 'resolution=merge-duplicates,return=minimal' };

/**
 * Obtém a configuração salva do Supabase (URL e Anon Key).
 * @returns {{url?: string, key?: string}}
 */
const cfg = () => {
  try {
    return JSON.parse(localStorage.getItem(SB_KEY)) || {};
  } catch (_) {
    return {};
  }
};

/**
 * Verifica se a sincronização em nuvem está configurada.
 * @returns {boolean}
 */
const isCloudOn = () => {
  const c = cfg();
  return !!(c.url && c.key);
};

/**
 * Atualiza o indicador visual de status da nuvem no topo da tela.
 * @param {'off'|'busy'|'ok'|'err'} st
 * @param {string} [msg]
 */
function cloud(st, msg) {
  const labels = {
    off: 'off',
    busy: 'sincronizando…',
    ok: 'ok',
    err: 'erro',
  };
  $('cs').textContent = labels[st] || 'off';
  const tipText = msg || 'Supabase';
  $('cloud').dataset.tip = tipText;
}

/**
 * Executa uma chamada HTTP para a API REST v1 do Supabase.
 * @param {string} path Caminho relativo em /rest/v1/
 * @param {RequestInit} [o={}] Opções do fetch
 * @returns {Promise<any>}
 */
async function sb(path, o = {}) {
  const c = cfg();
  const baseUrl = c.url.replace(/\/$/, '');
  const res = await fetch(`${baseUrl}/rest/v1/${path}`, {
    ...o,
    headers: {
      apikey: c.key,
      Authorization: 'Bearer ' + c.key,
      'Content-Type': 'application/json',
      ...(o.headers || {}),
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text);
  return text ? JSON.parse(text) : null;
}

/**
 * Busca todos os registros paginados de uma tabela do Supabase (blocos de 1000).
 * @param {string} query Query string inicial (ex.: 'habits?select=*')
 * @returns {Promise<any[]>}
 */
async function sbAll(query) {
  let out = [];
  let off = 0;
  for (;;) {
    const r = await sb(`${query}&limit=1000&offset=${off}`);
    out = out.concat(r);
    if (r.length < 1000) break;
    off += 1000;
  }
  return out;
}

/**
 * Executa uma operação assíncrona na nuvem em background se estiver conectado.
 * @param {() => Promise<any>} fn
 */
const quiet = (fn) => {
  if (isCloudOn()) {
    fn()
      .then(() => cloud('ok', 'Última sincronização: ' + new Date().toLocaleTimeString()))
      .catch((e) => cloud('err', e.message));
  }
};

/* ---------- Sincronização de Hábitos e Marcações ---------- */

async function pushHabits() {
  if (!state.habits.length) return;
  const rows = state.habits.map((h, i) => ({
    id: h.id,
    name: h.name,
    position: i,
  }));
  try {
    await sb('habits', { method: 'POST', headers: UP, body: JSON.stringify(rows) });
  } catch (e) {
    if (!/position/i.test(e.message)) throw e;
    await sb('habits', {
      method: 'POST',
      headers: UP,
      body: JSON.stringify(rows.map(({ id, name }) => ({ id, name }))),
    });
  }
}

async function pushDay(id, k, st) {
  const del = () =>
    sb(`completions?habit_id=eq.${encodeURIComponent(id)}&day=eq.${k}`, {
      method: 'DELETE',
    });
  if (!st) return del();
  const post = (b) =>
    sb('completions', { method: 'POST', headers: UP, body: JSON.stringify([b]) });
  try {
    await post({ habit_id: id, day: k, status: st === 'f' ? 'fail' : 'done' });
  } catch (e) {
    if (!/status/i.test(e.message)) throw e;
    if (st === 'd') await post({ habit_id: id, day: k });
    else await del();
  }
}

async function pushRows(rows) {
  if (!rows.length) return;
  const go = async (r) => {
    for (let i = 0; i < r.length; i += 500) {
      await sb('completions', {
        method: 'POST',
        headers: UP,
        body: JSON.stringify(r.slice(i, i + 500)),
      });
    }
  };
  try {
    await go(rows);
  } catch (e) {
    if (!/status/i.test(e.message)) throw e;
    await go(
      rows
        .filter((r) => r.status === 'done')
        .map(({ habit_id, day }) => ({ habit_id, day }))
    );
  }
}

function deleteHabitRemote(id) {
  quiet(() => sb('habits?id=eq.' + encodeURIComponent(id), { method: 'DELETE' }));
}

/* ---------- Sincronização do Banco de Horas ---------- */

async function pushBankItems() {
  if (!state.bank.length) return;
  await sb('study_items', {
    method: 'POST',
    headers: UP,
    body: JSON.stringify(
      state.bank.map((b, i) => ({
        id: b.id,
        name: b.name,
        size: b.size,
        hours: b.hours,
        position: i,
      }))
    ),
  });
}

function toggleBankSquareRemote(itemId, idx, had) {
  quiet(() =>
    had
      ? sb(`study_progress?item_id=eq.${encodeURIComponent(itemId)}&idx=eq.${idx}`, {
          method: 'DELETE',
        })
      : sb('study_progress', {
          method: 'POST',
          headers: UP,
          body: JSON.stringify([{ item_id: itemId, idx }]),
        })
  );
}

function saveBankItemRemote(itemId, shrink, newSize) {
  quiet(async () => {
    await pushBankItems();
    if (shrink) {
      await sb(
        `study_progress?item_id=eq.${encodeURIComponent(itemId)}&idx=gte.${newSize}`,
        { method: 'DELETE' }
      );
    }
  });
}

function deleteBankItemRemote(itemId) {
  quiet(() => sb('study_items?id=eq.' + encodeURIComponent(itemId), { method: 'DELETE' }));
}

async function syncBank() {
  if (!isCloudOn()) return;
  const ri = await sbAll('study_items?select=*');
  const rp = await sbAll('study_progress?select=item_id,idx');

  ri.sort((a, b) => (a.position || 0) - (b.position || 0)).forEach((r) => {
    const existing = state.bank.find((b) => b.id === r.id);
    if (!existing) {
      state.bank.push({
        id: r.id,
        name: r.name,
        size: r.size,
        hours: +r.hours,
        done: [],
        half: [],
      });
    } else {
      existing.name = r.name;
      existing.size = r.size;
      existing.hours = +r.hours;
      existing.half = existing.half || [];
    }
  });

  const map = Object.fromEntries(state.bank.map((b) => [b.id, b]));
  rp.forEach((r) => {
    const b = map[r.item_id];
    if (b && r.idx < b.size && !b.done.includes(r.idx)) {
      b.done.push(r.idx);
      b.half = (b.half || []).filter((x) => x !== r.idx);
    }
  });
  saveBank();

  await pushBankItems();
  const rows = [];
  state.bank.forEach((b) =>
    b.done.forEach((i) => {
      if (i < b.size) rows.push({ item_id: b.id, idx: i });
    })
  );
  for (let i = 0; i < rows.length; i += 500) {
    await sb('study_progress', {
      method: 'POST',
      headers: UP,
      body: JSON.stringify(rows.slice(i, i + 500)),
    });
  }
}

/* ---------- Sincronização do Tanque de Lazer ---------- */

async function pushRw() {
  await sb('reward_state', {
    method: 'POST',
    headers: UP,
    body: JSON.stringify([
      {
        id: 'main',
        hours: state.rw.hours,
        spent: 0,
        spent_min: state.rw.spentMin,
        habit_min: state.rw.habitMin || 0,
        updated_at: new Date(state.rw.at || Date.now()).toISOString(),
      },
    ]),
  });
}

async function syncReward() {
  if (!isCloudOn()) return;
  const rows = await sb('reward_state?id=eq.main&select=*');
  const r = rows && rows[0];
  const ra = r ? Date.parse(r.updated_at) : 0;
  if (r && ra > state.rw.at) {
    state.rw.hours = +r.hours;
    state.rw.spentMin = r.spent_min > 0 ? r.spent_min : (r.spent || 0) * MINS;
    state.rw.habitMin = r.habit_min || 0;
    state.rw.at = ra;
    persistRw();
  } else {
    await pushRw();
  }
}

/* ---------- Sincronização do Relógio de Foco ---------- */

async function pushFocus() {
  try {
    await sb('focus_state', {
      method: 'POST',
      headers: UP,
      body: JSON.stringify([
        {
          id: 'main',
          daily_goal_min: state.focus.dailyGoalMin,
          session_min: state.focus.sessionMin,
          skip_breaks: state.focus.skipBreaks,
          block_min: state.focus.blockMin,
          break_min: state.focus.breakMin,
          history: state.focus.history || {},
          updated_at: new Date(state.focus.at || Date.now()).toISOString(),
        },
      ]),
    });
  } catch (_) {
    // Ignora silenciosamente caso a tabela opcional focus_state ainda não tenha sido criada no Supabase
  }
}

async function syncFocus() {
  if (!isCloudOn()) return;
  try {
    const rows = await sb('focus_state?id=eq.main&select=*');
    const r = rows && rows[0];
    const ra = r ? Date.parse(r.updated_at) : 0;
    if (r && ra > (state.focus.at || 0)) {
      state.focus.dailyGoalMin = +r.daily_goal_min || 240;
      state.focus.sessionMin = +r.session_min || 180;
      state.focus.skipBreaks = !!r.skip_breaks;
      state.focus.blockMin = +r.block_min || 60;
      state.focus.breakMin = +r.break_min || 5;
      const mergedHist = { ...(r.history || {}) };
      for (const [day, min] of Object.entries(state.focus.history || {})) {
        mergedHist[day] = Math.max(mergedHist[day] || 0, min || 0);
      }
      state.focus.history = mergedHist;
      state.focus.at = ra;
      saveFocus();
    } else {
      await pushFocus();
    }
  } catch (_) {}
}

/* ---------- Sincronização Geral (Inicialização e Manual) ---------- */

async function sync() {
  if (!isCloudOn()) return cloud('off');
  cloud('busy');
  try {
    const rh = await sbAll('habits?select=*');
    const rc = await sbAll('completions?select=*');

    // Se os dados locais ainda forem os dados de exemplo (mock) e a nuvem já tiver hábitos,
    // substitui os dados mock pelos dados reais da nuvem para não poluir o banco.
    if (state.isMock && rh.length > 0) {
      state.habits = [];
      state.isMock = false;
    }

    rh.sort((a, b) => (a.position || 0) - (b.position || 0)).forEach((r) => {
      const existing = state.habits.find((h) => h.id === r.id);
      if (!existing) {
        state.habits.push({ id: r.id, name: r.name, dates: [], fails: [] });
      } else {
        existing.name = r.name;
      }
    });

    const map = Object.fromEntries(state.habits.map((h) => [h.id, h]));
    rc.forEach((r) => {
      const h = map[r.habit_id];
      if (!h) return;
      h.fails = h.fails || [];
      if (h.dates.includes(r.day) || h.fails.includes(r.day)) return;
      (r.status === 'fail' ? h.fails : h.dates).push(r.day);
    });
    saveHabits(false);

    await pushHabits();

    // Sincroniza todas as marcações (incluindo o mês atual e o dia de hoje)
    const rows = [];
    state.habits.forEach((h) => {
      h.dates.forEach((d) => rows.push({ habit_id: h.id, day: d, status: 'done' }));
      (h.fails || []).forEach((d) =>
        rows.push({ habit_id: h.id, day: d, status: 'fail' })
      );
    });
    await pushRows(rows);

    let bankErr = null;
    try {
      await syncBank();
      await syncReward();
      await syncFocus();
    } catch (e) {
      bankErr = e.message;
    }

    cloud(
      bankErr ? 'err' : 'ok',
      bankErr
        ? 'Banco de horas: ' + bankErr
        : 'Última sincronização: ' + new Date().toLocaleTimeString()
    );
    notifyUI();
  } catch (e) {
    cloud('err', e.message);
  }
}

/**
 * Inicializa o modal de configuração do Supabase (#sdlg).
 */
function initSupabaseModal() {
  const sd = $('sdlg');
  $('cloud').onclick = () => {
    const c = cfg();
    $('surl').value = c.url || '';
    $('skey').value = c.key || '';
    sd.showModal();
  };
  $('scancel').onclick = () => sd.close();
  $('sok').onclick = () => {
    try {
      localStorage.setItem(
        SB_KEY,
        JSON.stringify({
          url: $('surl').value.trim(),
          key: $('skey').value.trim(),
        })
      );
    } catch (_) {}
    sd.close();
    sync();
  };
  $('sclear').onclick = () => {
    try {
      localStorage.removeItem(SB_KEY);
    } catch (_) {}
    sd.close();
    cloud('off');
  };
}


/* === js/tabs/bank.js === */
/**
 * @fileoverview Módulo da Aba 3: Banco de Horas e Tanque de Lazer.
 * Gerencia atividades/matérias de estudo, progresso em quadradinhos e saldo de créditos de lazer.
 */

let editingBankItem = null;

/**
 * Atualiza a visualização do Tanque de Lazer flutuante (#tank).
 */
function drawTank() {
  const b = balance();
  const neg = b < 0;
  $('lq').style.height = Math.min(100, (Math.abs(b) / CAP) * 100) + '%';
  document.querySelector('.tk').classList.toggle('neg', neg);
  $('tkc').textContent = (Math.round(b * 100) / 100).toLocaleString('pt-BR', {
    maximumFractionDigits: 2,
  });
  $('tkc').classList.toggle('neg', neg);
  const mn = Math.round(Math.abs(b) * MINS);
  $('tkcw').dataset.tip = neg
    ? `Faltam ${fMin(mn)} para o tanque ficar verde`
    : `Lazer disponível: ${fMin(mn)}`;
}

function saveRw() {
  state.rw.at = Date.now();
  persistRw();
  quiet(pushRw);
}

function triggerTankBump(before) {
  if (balance() > before) {
    const k = $('tank');
    k.classList.remove('bump');
    void k.offsetWidth;
    k.classList.add('bump');
  }
}

/**
 * Soma ou subtrai minutos de lazer provenientes de hábitos concluídos.
 * @param {number} min
 */
function addLeisure(min) {
  const before = balance();
  state.rw.habitMin = (state.rw.habitMin || 0) + min;
  saveRw();
  triggerTankBump(before);
}

/**
 * Soma ou subtrai horas de estudo provenientes dos quadradinhos do Banco de Horas.
 * @param {number} delta
 */
function addHours(delta) {
  const before = balance();
  state.rw.hours = Math.max(0, Math.round((state.rw.hours + delta) * 100) / 100);
  saveRw();
  triggerTankBump(before);
}

/**
 * Avança o estado de um quadradinho na matriz do Banco de Horas (ciclo de double-check):
 *  - 1º clique (vazio -> 'half'): deixa o quadrado levemente verde com borda verde escura (apenas visual, 0 crédito).
 *  - 2º clique ('half' -> 'done'): confirma o check e contabiliza os créditos no Tanque de Lazer.
 *  - 3º clique ('done' -> 'empty'): desmarca o quadrado e estorna os créditos.
 * @param {{hours: number, done: number[], half?: number[]}} item
 * @param {number} idx
 * @returns {{state: 'half'|'done'|'empty', hoursDelta: number, remoteConfirmed: boolean|null}}
 */
function advanceBankSquareState(item, idx) {
  item.done = Array.isArray(item.done) ? item.done : [];
  item.half = Array.isArray(item.half) ? item.half : [];

  const isDone = item.done.includes(idx);
  const isHalf = !isDone && item.half.includes(idx);

  if (!isDone && !isHalf) {
    item.half = [...item.half, idx];
    return { state: 'half', hoursDelta: 0, remoteConfirmed: null };
  }

  if (isHalf) {
    item.half = item.half.filter((x) => x !== idx);
    item.done = [...item.done, idx];
    return { state: 'done', hoursDelta: item.hours, remoteConfirmed: true };
  }

  item.done = item.done.filter((x) => x !== idx);
  item.half = item.half.filter((x) => x !== idx);
  return { state: 'empty', hoursDelta: -item.hours, remoteConfirmed: false };
}

/**
 * Renderiza a aba Banco de Horas (#bank).
 */
function drawBank() {
  const keep = $('bank').scrollTop;
  const rows = state.bank
    .map((b) => {
      const doneSet = new Set(b.done || []);
      const halfSet = new Set(b.half || []);
      const squares = Array.from({ length: b.size }, (_, i) => {
        const cls = doneSet.has(i) ? 'on' : halfSet.has(i) ? 'half' : '';
        return `<button type="button" class="sq ${cls}" data-b="${b.id}" data-i="${i}"></button>`;
      }).join('');
      return `<div class="br">
        <div class="bn">
          <span>${esc(b.name)}</span>
          <div class="bt">
            <button type="button" data-bedit="${b.id}" title="Editar">✎</button>
            <button type="button" data-bdel="${b.id}" title="Excluir">✕</button>
          </div>
        </div>
        <div class="bsq">${squares}</div>
        <div class="bg"><b>${b.done.length}/${b.size}</b></div>
      </div>`;
    })
    .join('');

  $('bank').innerHTML = `<div class="dp">
    <div class="section-header">
      <h2 class="bh">Banco de horas</h2>
      <button type="button" class="add" id="bnew">+ Nova atividade</button>
    </div>
    <div class="bank-list">
      ${rows || '<p class="muted-msg">Nenhuma atividade ainda. Clique em “+ Nova atividade”.</p>'}
    </div>
  </div>`;

  $('bnew').onclick = () => openBankModal();
  $('bank').scrollTop = keep;
}

function updateBankSummary() {
  const n = +$('bsize').value || 0;
  const h = +$('bhours').value || 0;
  $('bsum').textContent = `Total: ${n} × ${fH(h)} = ${fH(n * h)}`;
}

function clearBankErrors() {
  $('berr').textContent = '';
  ['bname', 'bsize', 'bhours'].forEach((id) => $(id).classList.remove('bad'));
}

function openBankModal(id) {
  editingBankItem = id ? state.bank.find((b) => b.id === id) : null;
  $('btitle').textContent = editingBankItem ? 'Editar atividade' : 'Nova atividade';
  $('bname').value = editingBankItem ? editingBankItem.name : '';
  $('bsize').value = editingBankItem ? editingBankItem.size : 10;
  $('bhours').value = editingBankItem ? editingBankItem.hours : 1;
  $('bdel').style.display = editingBankItem ? '' : 'none';
  updateBankSummary();
  clearBankErrors();
  $('bdlg').showModal();
  $('bname').focus();
}

async function saveBankForm() {
  const name = $('bname').value.trim();
  const size = Math.floor(+$('bsize').value);
  const hours = +$('bhours').value;

  const bad = (id, msg) => {
    $('berr').textContent = msg;
    $(id).classList.add('bad');
    $(id).focus();
  };

  if (!name) return bad('bname', 'Dê um nome à atividade.');
  if (!(size >= 1 && size <= 200)) return bad('bsize', 'Use de 1 a 200 quadradinhos.');
  if (!(hours > 0)) return bad('bhours', 'As horas por quadradinho precisam ser maiores que 0.');

  let b = editingBankItem;
  let shrink = false;

  if (b) {
    const lost = b.done.filter((i) => i >= size);
    if (
      lost.length &&
      !(await ask(
        `Reduzir para ${size} quadradinhos apaga ${lost.length} já concluído(s). Continuar?`,
        'Continuar'
      ))
    ) {
      return;
    }
    shrink = size < b.size;
    const oldHoursEarned = b.done.length * b.hours;
    const keptDone = b.done.filter((i) => i < size);
    const keptHalf = (b.half || []).filter((i) => i < size);
    const newHoursEarned = keptDone.length * hours;
    const deltaHours = newHoursEarned - oldHoursEarned;

    Object.assign(b, { name, size, hours, done: keptDone, half: keptHalf });
    if (deltaHours !== 0) addHours(deltaHours);
  } else {
    b = { id: uid(), name, size, hours, done: [], half: [] };
    state.bank.push(b);
  }

  saveBank();
  $('bdlg').close();
  drawBank();
  saveBankItemRemote(b.id, shrink, size);
}

function consumeLeisure() {
  const v = parseFloat($('lzv').value);
  if (!isFinite(v) || v <= 0) {
    $('lzv').value = '';
    return;
  }
  const m = Math.round($('lzu').value === 'h' ? v * 60 : v);
  if (m <= 0) return;
  state.rw.spentMin += m;
  saveRw();
  $('lzv').value = '';
}

/**
 * Inicializa os eventos da Aba Banco de Horas e do Tanque de Lazer.
 */
function initBankTab() {
  $('bank').addEventListener('click', (e) => {
    const q = e.target.closest('.sq');
    if (q) {
      const b = state.bank.find((x) => x.id === q.dataset.b);
      if (!b) return;
      const i = +q.dataset.i;
      const transition = advanceBankSquareState(b, i);
      saveBank();
      if (transition.hoursDelta !== 0) {
        addHours(transition.hoursDelta);
      }
      drawBank();
      if (transition.remoteConfirmed !== null) {
        toggleBankSquareRemote(b.id, i, !transition.remoteConfirmed);
      }
      return;
    }

    const ed = e.target.closest('[data-bedit]');
    const dl = e.target.closest('[data-bdel]');
    if (ed) openBankModal(ed.dataset.bedit);
    if (dl) {
      const b = state.bank.find((x) => x.id === dl.dataset.bdel);
      if (!b) return;
      ask(`Excluir "${b.name}" e todo o progresso?`).then((ok) => {
        if (!ok) return;
        state.bank = state.bank.filter((x) => x !== b);
        saveBank();
        drawBank();
        deleteBankItemRemote(b.id);
      });
    }
  });

  $('bok').onclick = saveBankForm;
  $('bcancel').onclick = () => $('bdlg').close();
  ['bsize', 'bhours'].forEach((id) => {
    $(id).oninput = () => {
      updateBankSummary();
      clearBankErrors();
    };
  });
  $('bname').oninput = clearBankErrors;
  $('bname').onkeydown = (e) => {
    if (e.key === 'Enter') saveBankForm();
  };
  $('bdel').onclick = () => {
    const b = editingBankItem;
    if (!b) return;
    ask(`Excluir "${b.name}" e todo o progresso?`).then((ok) => {
      if (!ok) return;
      state.bank = state.bank.filter((x) => x !== b);
      saveBank();
      $('bdlg').close();
      drawBank();
      deleteBankItemRemote(b.id);
    });
  };

  $('lzb').onclick = consumeLeisure;
  $('lzv').onkeydown = (e) => {
    if (['-', '+', 'e', 'E'].includes(e.key)) e.preventDefault();
    if (e.key === 'Enter') consumeLeisure();
  };

  drawTank();
}


/* === js/tabs/dashboard.js === */
/**
 * @fileoverview Módulo da Aba 2: Dashboard.
 * Exibe indicadores de hábitos ativos, gráfico de barras empilhadas (concluídos vs falhas)
 * e barras de progresso individuais por período (Mês atual, 30 dias, Ano atual).
 */

let dashRange = 'month';

/**
 * Renderiza a aba Dashboard (#dash).
 */
function drawDash() {
  const d0 = new Date();
  const t = todayN();
  const y = d0.getFullYear();
  const s =
    dashRange === 'month'
      ? mStart(y, d0.getMonth())
      : dashRange === '30d'
        ? t - 29
        : Math.floor(Date.UTC(y, 0, 1) / DAY);

  const days = t - s + 1;
  const H = state.habits;
  const sets = H.map((h) => new Set(h.dates));
  const fsets = H.map((h) => new Set(h.fails || []));

  const per = H.map((h, i) => {
    let c = 0;
    for (let n = s; n <= t; n++) {
      if (sets[i].has(keyOf(n))) c++;
    }
    return { h, c, st: stats(h) };
  });

  const daily = [];
  for (let n = s; n <= t; n++) {
    const k = keyOf(n);
    const c = sets.filter((x) => x.has(k)).length;
    const f = fsets.filter((x) => x.has(k)).length;
    daily.push([n, c, f]);
  }

  let bars; // [rótulo, concluídos, máximo possível, falhas]
  if (dashRange === 'year') {
    const byMonth = {};
    daily.forEach(([n, c, f]) => {
      const m = new Date(n * DAY).getUTCMonth();
      byMonth[m] = byMonth[m] || [0, 0, 0];
      byMonth[m][0] += c;
      byMonth[m][1]++;
      byMonth[m][2] += f;
    });
    bars = Object.entries(byMonth).map(([m, [c, dd, f]]) => [
      MONTHS_INITIAL[m],
      c,
      dd * H.length,
      f,
    ]);
  } else {
    bars = daily.map(([n, c, f]) => [
      new Date(n * DAY).getUTCDate(),
      c,
      H.length,
      f,
    ]);
  }

  const kp = (v, l) => `<div class="kc"><b>${v}</b><small>${l}</small></div>`;

  $('dash').innerHTML = `<div class="dp">
    <div class="section-header">
      <h2>Dashboard</h2>
      <select class="sel" id="drg">
        <option value="month">Este mês</option>
        <option value="30d">Últimos 30 dias</option>
        <option value="year">Este ano</option>
      </select>
    </div>
    <div class="kp">${kp(H.length, 'hábitos ativos')}</div>
    <strong>Conclusões por ${dashRange === 'year' ? 'mês' : 'dia'}</strong>
    <div class="bars">
      ${bars
        .map(
          ([l, v, m, f]) =>
            `<div class="bc" title="${l}: ✓${v} ✕${f} de ${m}">
              <i style="height:${m ? (v / m) * 100 : 0}%"></i>
              <i class="r" style="height:${m ? (f / m) * 100 : 0}%"></i>
            </div>`
        )
        .join('')}
    </div>
    <div class="bl">${bars.map((b) => `<span>${b[0]}</span>`).join('')}</div>
    <strong class="dash-section-title">Progresso por hábito</strong>
    ${
      per
        .map((p) => {
          const r = Math.round((p.c / days) * 100);
          return `<div class="pr">
            <span class="pr-name">${esc(p.h.name)}</span>
            <div class="pb"><i style="width:${r}%"></i></div>
            <b class="pr-streak">${p.st.cur}</b>
          </div>`;
        })
        .join('') || '<p class="muted-msg">Nenhum hábito ainda.</p>'
    }
  </div>`;

  $('drg').value = dashRange;
  $('drg').onchange = () => {
    dashRange = $('drg').value;
    drawDash();
  };
}


/* === js/tabs/reports.js === */
/**
 * @fileoverview Módulo de Relatórios (Mensal e Anual) com exportação CSV (UTF-8 BOM para Excel)
 * e visualização formatada para Impressão / PDF.
 */

let reportData = null;

function buildReport() {
  const t = todayN();
  const yr = $('rtype').value === 'year';
  const pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '—');
  const V = state.view;

  let s;
  let e;
  let title;
  let head;
  const rows = [];

  if (yr) {
    const y = +$('ryear').value || V.y;
    s = Math.floor(Date.UTC(y, 0, 1) / DAY);
    e = Math.floor(Date.UTC(y, 11, 31) / DAY);
    title = 'Relatório anual — ' + y;
  } else {
    const [y, m1] = ($('rmonth').value || `${V.y}-${V.m + 1}`).split('-').map(Number);
    const m = m1 - 1;
    s = mStart(y, m);
    e = s + dim(y, m) - 1;
    title = 'Relatório mensal — ' + fmtMonthYear(y, m);
  }

  const end = Math.min(e, t);
  const days = Math.max(0, end - s + 1);
  const inR = (h) =>
    h.dates.filter((d) => {
      const n = parseKey(d);
      return n >= s && n <= end;
    });
  const inF = (h) =>
    (h.fails || []).filter((d) => {
      const n = parseKey(d);
      return n >= s && n <= end;
    });

  if (yr) {
    head = ['Hábito', ...MONTHS_SHORT, 'Total', 'Com X', 'Taxa'];
    const tot = Array(12).fill(0);
    let all = 0;
    let allF = 0;

    state.habits.forEach((h) => {
      const c = Array(12).fill(0);
      inR(h).forEach((d) => c[+d.slice(5, 7) - 1]++);
      c.forEach((v, i) => (tot[i] += v));
      const sum = c.reduce((a, b) => a + b, 0);
      const fx = inF(h).length;
      all += sum;
      allF += fx;
      rows.push([h.name, ...c, sum, fx, pct(sum, days)]);
    });
    rows.push(['Total', ...tot, all, allF, pct(all, days * state.habits.length)]);
  } else {
    head = ['Hábito', 'Concluídos', 'Com X', 'Dias no período', 'Taxa', 'Maior ofensiva'];
    let all = 0;
    let allF = 0;

    state.habits.forEach((h) => {
      const set = new Set(inR(h));
      const c = set.size;
      const fx = inF(h).length;
      all += c;
      allF += fx;
      let b = 0;
      let r = 0;
      for (let n = s; n <= end; n++) {
        r = set.has(keyOf(n)) ? r + 1 : 0;
        b = Math.max(b, r);
      }
      rows.push([h.name, c, fx, days, pct(c, days), b]);
    });
    rows.push(['Total', all, allF, days * state.habits.length, pct(all, days * state.habits.length), '—']);
  }

  const sub = days
    ? `Período considerado: ${fmtD(s)} a ${fmtD(end)} · Gerado em ${new Date().toLocaleDateString('pt-BR')}`
    : 'Este período ainda não começou.';

  return { title, sub, head, rows };
}

function showReport() {
  const y = $('rtype').value === 'year';
  $('rmonth').style.display = y ? 'none' : '';
  $('ryear').style.display = y ? '' : 'none';
  reportData = buildReport();

  $('rpt').innerHTML = `<h3 class="report-heading">${esc(reportData.title)}</h3>
    <p class="report-sub">${esc(reportData.sub)}</p>
    <table class="rt">
      <tr>${reportData.head.map((x) => `<th>${esc(x)}</th>`).join('')}</tr>
      ${reportData.rows
        .map((r) => `<tr>${r.map((x) => `<td>${esc(String(x))}</td>`).join('')}</tr>`)
        .join('')}
    </table>`;
}

/**
 * Inicializa os eventos do Modal de Relatórios (#rdlg).
 */
function initReportsModal() {
  $('rbtn').onclick = () => {
    const V = state.view;
    $('rtype').value = 'month';
    $('rmonth').value = `${V.y}-${String(V.m + 1).padStart(2, '0')}`;
    $('ryear').value = V.y;
    showReport();
    $('rdlg').showModal();
  };

  ['rtype', 'rmonth', 'ryear'].forEach((id) => {
    $(id).onchange = showReport;
  });

  $('rclose').onclick = () => $('rdlg').close();

  $('rcsv').onclick = () => {
    const q = (v) => `"${String(v).replace(/"/g, '""')}"`;
    const csv =
      '\ufeff' +
      [reportData.head, ...reportData.rows].map((r) => r.map(q).join(';')).join('\r\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download =
      reportData.title
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/\W+/g, '_') + '.csv';
    a.click();
  };

  $('rprint').onclick = () => {
    $('pa').innerHTML = $('rpt').innerHTML;
    window.print();
  };
}


/* === js/tabs/habits.js === */
/**
 * @fileoverview Módulo da Aba 1: Hábitos.
 * Responsável pela grade semanal, navegação no calendário, marcação de dias (✓ / ✕),
 * arrastar para reordenar (drag-and-drop), modal de criação/edição, diagrama de pontos mensal
 * e detalhes da ofensiva (🔥).
 */

let dotsPopupState = null;
let editingHabit = null;
let dragState = null;

const isCurrentMonth = () => {
  const d = new Date();
  return state.view.y === d.getFullYear() && state.view.m === d.getMonth();
};

/**
 * Navega para a semana do dia de hoje e renderiza a grade.
 */
function goToday() {
  const d = new Date();
  state.view.y = d.getFullYear();
  state.view.m = d.getMonth();
  state.view.w = Math.floor(
    (dow(mStart(state.view.y, state.view.m)) + d.getDate() - 1) / 7
  );
  renderHabits();
}

function shiftMonth(k) {
  const V = state.view;
  V.m += k;
  if (V.m < 0) {
    V.m = 11;
    V.y--;
  }
  if (V.m > 11) {
    V.m = 0;
    V.y++;
  }
  V.w = isCurrentMonth()
    ? Math.floor((dow(mStart(V.y, V.m)) + new Date().getDate() - 1) / 7)
    : 0;
  renderHabits();
}

function shiftWeek(k) {
  const V = state.view;
  V.w += k;
  if (V.w < 0) {
    V.m--;
    if (V.m < 0) {
      V.m = 11;
      V.y--;
    }
    V.w = nWeeks(V.y, V.m) - 1;
  } else if (V.w >= nWeeks(V.y, V.m)) {
    V.m++;
    if (V.m > 11) {
      V.m = 0;
      V.y++;
    }
    V.w = 0;
  }
  renderHabits();
}

/**
 * Renderiza a grade semanal de hábitos (#main) e atualiza a melhor ofensiva no topo.
 */
function renderHabits() {
  const V = state.view;
  const t = todayN();
  const ms = mStart(V.y, V.m);
  const D = dim(V.y, V.m);
  const w0 = ms - dow(ms) + V.w * 7;

  const days = Array.from({ length: 7 }, (_, i) => {
    const n = w0 + i;
    return { n, in: n >= ms && n < ms + D };
  });

  $('mlabel').textContent = fmtMonthYear(V.y, V.m);

  const head =
    `<div class="g hd"><div class="nm"><span class="ttl">Meus Hábitos</span></div>` +
    days
      .map(
        (d) =>
          `<div class="dh ${d.n === t ? 'today' : ''} ${d.in ? '' : 'off'}">${WD[dow(d.n)]}<em>${new Date(d.n * DAY).getUTCDate()}</em></div>`
      )
      .join('') +
    `<div class="st"><small>Ofensiva<br>atual</small></div></div>`;

  const rows = state.habits
    .map((h) => {
      const set = new Set(h.dates);
      const fs = new Set(h.fails || []);
      const s = stats(h);
      const cells = days
        .map((d, i) => {
          const k = keyOf(d.n);
          const on = set.has(k);
          const pl = i > 0 && days[i - 1].in && set.has(keyOf(d.n - 1));
          const nr = i < 6 && days[i + 1].in && set.has(keyOf(d.n + 1));
          return `<div class="d ${on ? 'on' : ''} ${on && pl ? 'pl' : ''} ${on && nr ? 'nr' : ''} ${fs.has(k) ? 'x' : ''} ${d.n > t ? 'fut' : ''} ${d.in ? '' : 'off'}" data-h="${h.id}" data-n="${d.n}"><i></i></div>`;
        })
        .join('');

      return `<div class="h" data-id="${h.id}">
        <div class="g">
          <div class="nm">
            <b class="grip">⋮⋮</b>
            <span data-open="${h.id}">${esc(h.name)}</span>
            <button type="button" data-edit="${h.id}">✎</button>
            <button type="button" data-del="${h.id}">✕</button>
          </div>
          ${cells}
          <div class="st">
            <button type="button" class="fire ${s.cur ? 'on' : ''}" data-streak="${h.id}" title="Ver detalhes da ofensiva">
              🔥<b>${s.cur}</b>
            </button>
          </div>
        </div>
      </div>`;
    })
    .join('');

  const keep = $('main').scrollTop;
  $('main').innerHTML = state.habits.length
    ? head + rows
    : '<div class="empty">Nenhum hábito ainda. Clique em “+ Novo Hábito”.</div>';
  $('main').scrollTop = keep;
  $('best').textContent = Math.max(0, ...state.habits.map((h) => stats(h).best));
}

/**
 * Alterna o estado de um dia para um hábito: vazio → ✓ (feito) → ✕ (não feito) → vazio.
 * @param {string} id ID do hábito
 * @param {number} n Índice inteiro do dia
 * @param {'d'|'f'|''|null} to Estado alvo explícito ou null para avançar no ciclo
 */
function mark(id, n, to) {
  if (n > todayN()) return; // Dias futuros não podem ser marcados
  const h = state.habits.find((x) => x.id === id);
  if (!h) return;

  const k = keyOf(n);
  h.fails = h.fails || [];
  const cur = h.dates.includes(k) ? 'd' : h.fails.includes(k) ? 'f' : '';
  const nx = to !== null ? (cur === to ? '' : to) : { '': 'd', d: 'f', f: '' }[cur];

  h.dates = h.dates.filter((d) => d !== k);
  h.fails = h.fails.filter((d) => d !== k);
  if (nx === 'd') h.dates.push(k);
  if (nx === 'f') h.fails.push(k);

  // ✓ soma minutos de lazer; desmarcar ✓ retira os minutos correspondentes
  const dm = (nx === 'd' ? HABMIN : 0) - (cur === 'd' ? HABMIN : 0);
  if (dm) addLeisure(dm);

  saveHabits();
  renderHabits();
  quiet(() => pushDay(h.id, k, nx));
}

/* ---------- Modal: Diagrama de Pontos Mensal (#ddlg) ---------- */

function drawDots() {
  const h = state.habits.find((x) => x.id === dotsPopupState.id);
  if (!h) return;
  const set = new Set(h.dates);
  const fs = new Set(h.fails || []);
  const D = dim(dotsPopupState.y, dotsPopupState.m);
  const ms = mStart(dotsPopupState.y, dotsPopupState.m);
  const t = todayN();

  let c = 0;
  let g =
    ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((w) => `<b>${w}</b>`).join('') +
    '<span></span>'.repeat(dow(ms));

  for (let i = 0; i < D; i++) {
    const n = ms + i;
    const k = keyOf(n);
    const on = set.has(k);
    const x = fs.has(k);
    if (on) c++;
    g += `<span class="dot ${on ? 'on' : ''} ${x ? 'x' : ''} ${n > t ? 'fut' : ''} ${n === t ? 't' : ''}" title="${fmtD(n)}">${x ? '✕' : i + 1}</span>`;
  }

  $('pname').textContent = h.name;
  $('pgrid').innerHTML = g;
  $('pcount').innerHTML = `<b class="dot-check">✓</b> ${c} concluídos &nbsp;·&nbsp; ${D} dias no mês`;
  $('pmonth').textContent = fmtMonthYear(dotsPopupState.y, dotsPopupState.m);
}

function openDots(id) {
  dotsPopupState = { id, y: state.view.y, m: state.view.m };
  drawDots();
  $('ddlg').showModal();
}

function shiftDotsMonth(k) {
  dotsPopupState.m += k;
  if (dotsPopupState.m < 0) {
    dotsPopupState.m = 11;
    dotsPopupState.y--;
  }
  if (dotsPopupState.m > 11) {
    dotsPopupState.m = 0;
    dotsPopupState.y++;
  }
  drawDots();
}

/* ---------- Modal: Detalhes da Ofensiva (#fdlg) ---------- */

function openStreak(id) {
  const h = state.habits.find((x) => x.id === id);
  if (!h) return;
  const s = stats(h);
  const set = new Set(h.dates);
  const t = todayN();
  const d = new Date();

  let l30 = 0;
  let mo = 0;
  for (let n = t - 29; n <= t; n++) {
    if (set.has(keyOf(n))) l30++;
  }
  for (let n = mStart(d.getFullYear(), d.getMonth()); n <= t; n++) {
    if (set.has(keyOf(n))) mo++;
  }

  const last = [...set].sort().pop();
  const row = (l, v) => `<div class="fr"><span>${l}</span><b>${v}</b></div>`;

  $('fname').textContent = h.name;
  $('fbody').innerHTML =
    `<div class="fbig">🔥<b>${s.cur}</b><small>${s.cur === 1 ? 'dia seguido' : 'dias seguidos'}</small></div>` +
    row('Ofensiva atual', s.cur) +
    row('Maior ofensiva', s.best) +
    row('Total de dias concluídos', s.total) +
    row('Concluídos este mês', mo) +
    row('Taxa nos últimos 30 dias', Math.round((l30 / 30) * 100) + '%') +
    row('Último dia concluído', last ? fmtD(parseKey(last)) : '—');

  $('fdlg').showModal();
}

/* ---------- Modal: Criar / Editar Hábito (#dlg) ---------- */

function openHabitModal(id) {
  editingHabit = id ? state.habits.find((h) => h.id === id) : null;
  $('dtitle').textContent = editingHabit ? 'Editar hábito' : 'Novo hábito';
  $('dname').value = editingHabit ? editingHabit.name : '';
  $('ddel').style.display = editingHabit ? '' : 'none';
  $('dlg').showModal();
  $('dname').focus();
}

function submitHabitForm() {
  const name = $('dname').value.trim();
  if (!name) return;
  let h = editingHabit;
  if (h) {
    h.name = name;
  } else {
    h = { id: uid(), name, dates: [], fails: [] };
    state.habits.push(h);
  }
  saveHabits();
  $('dlg').close();
  renderHabits();
  quiet(pushHabits);
}

/* ---------- Inicialização de Eventos da Aba Hábitos ---------- */

function initHabitsTab() {
  const mainEl = $('main');
  const dlg = $('dlg');
  const ddlg = $('ddlg');
  const fdlg = $('fdlg');

  // Cliques na grade de hábitos
  mainEl.addEventListener('click', (e) => {
    const c = e.target.closest('.d[data-h]');
    if (c) {
      mark(c.dataset.h, +c.dataset.n, null);
      return;
    }
    const sk = e.target.closest('[data-streak]');
    if (sk) {
      openStreak(sk.dataset.streak);
      return;
    }
    const op = e.target.closest('[data-open]');
    if (op) {
      openDots(op.dataset.open);
      return;
    }
    const ed = e.target.closest('[data-edit]');
    const dl = e.target.closest('[data-del]');
    if (ed) openHabitModal(ed.dataset.edit);
    if (dl) {
      const h = state.habits.find((x) => x.id === dl.dataset.del);
      if (!h) return;
      ask(`Excluir "${h.name}" e todo o histórico?`).then((ok) => {
        if (!ok) return;
        state.habits = state.habits.filter((x) => x !== h);
        saveHabits();
        renderHabits();
        deleteHabitRemote(h.id);
      });
    }
  });

  // Clique direito marca diretamente como falha (✕)
  mainEl.addEventListener('contextmenu', (e) => {
    const c = e.target.closest('.d[data-h]');
    if (!c) return;
    e.preventDefault();
    mark(c.dataset.h, +c.dataset.n, 'f');
  });

  // Drag-and-drop para reordenar hábitos
  mainEl.addEventListener('pointerdown', (e) => {
    const g = e.target.closest('.grip');
    if (!g) return;
    e.preventDefault();
    const row = g.closest('.h');
    dragState = { row, y: e.clientY };
    row.classList.add('lift');
    document.body.classList.add('dragging');
  });

  addEventListener('pointermove', (e) => {
    if (!dragState) return;
    const r = dragState.row;
    r.style.transform = `translateY(${e.clientY - dragState.y}px)`;
    const b = r.getBoundingClientRect();
    const c = b.top + b.height / 2;
    const p = r.previousElementSibling;
    const n = r.nextElementSibling;

    if (
      p &&
      p.classList.contains('h') &&
      c < p.getBoundingClientRect().top + p.offsetHeight / 2
    ) {
      const h = p.offsetHeight;
      r.parentNode.insertBefore(r, p);
      dragState.y -= h;
    } else if (
      n &&
      n.classList.contains('h') &&
      c > n.getBoundingClientRect().top + n.offsetHeight / 2
    ) {
      const h = n.offsetHeight;
      r.parentNode.insertBefore(n, r);
      dragState.y += h;
    }
    r.style.transform = `translateY(${e.clientY - dragState.y}px)`;
  });

  function endDrag() {
    if (!dragState) return;
    const ids = [...mainEl.querySelectorAll('.h')].map((x) => x.dataset.id);
    state.habits.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    dragState = null;
    document.body.classList.remove('dragging');
    saveHabits();
    renderHabits();
    quiet(pushHabits);
  }

  addEventListener('pointerup', endDrag);
  addEventListener('pointercancel', endDrag);

  // Modal de Diagrama de Pontos (#ddlg)
  $('ppm').onclick = () => shiftDotsMonth(-1);
  $('pnm').onclick = () => shiftDotsMonth(1);
  $('pclose').onclick = () => ddlg.close();

  // Modal de Ofensiva (#fdlg)
  $('fclose').onclick = () => fdlg.close();

  // Modal de Criar / Editar Hábito (#dlg)
  $('new').onclick = () => openHabitModal();
  $('dok').onclick = submitHabitForm;
  $('dcancel').onclick = () => dlg.close();
  $('dname').onkeydown = (e) => {
    if (e.key === 'Enter') submitHabitForm();
  };
  $('ddel').onclick = () => {
    const h = editingHabit;
    if (!h) return;
    ask('Excluir este hábito?').then((ok) => {
      if (!ok) return;
      state.habits = state.habits.filter((x) => x !== h);
      saveHabits();
      dlg.close();
      renderHabits();
      deleteHabitRemote(h.id);
    });
  };

  // Botões de navegação de semana/mês no cabeçalho
  $('pw').onclick = () => shiftWeek(-1);
  $('nw').onclick = () => shiftWeek(1);
  $('pm').onclick = () => shiftMonth(-1);
  $('nm').onclick = () => shiftMonth(1);
  $('today').onclick = goToday;

  // Atalhos de teclado (apenas quando a aba Hábitos está ativa e sem foco em inputs/dialogs)
  document.addEventListener('keydown', (e) => {
    if (state.activeTab !== 'habits') return;
    if (document.querySelector('dialog[open]')) return;
    const tag = document.activeElement ? document.activeElement.tagName : '';
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(tag)) return;
    if (e.key === 'ArrowLeft') shiftWeek(-1);
    if (e.key === 'ArrowRight') shiftWeek(1);
  });
}


/* === js/tabs/clock.js === */
/**
 * @fileoverview Módulo da Aba 4: Relógio de Foco (Sessões de Concentração & Andamento Diário).
 * Arquitetura baseada em funções puras (determinísticas e testáveis), múltiplos timbres de alarme,
 * notificações nativas do Windows e motor de tempo baseado em timestamps reais (Date.now).
 */

const MIN_SESSION_MIN = 15;
const MAX_SESSION_MIN = 240;
const SESSION_STEP_MIN = 15;

const TCARD_RADIUS = 86;
const TCARD_CIRC = 2 * Math.PI * TCARD_RADIUS;

/**
 * Catálogo de opções de som de alarme sintetizados via Web Audio API.
 */
const ALARM_SOUNDS = [
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
function calcFocusIntervals(totalMinutes, skipBreaks = false, blockMinutes = 60) {
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
function buildSessionPlan(
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
function calcDailyFocusStats(history = {}, dailyGoalMin = 240, todayInt = todayN()) {
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
function formatGoalDisplay(goalMin) {
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
function formatCountdown(totalSeconds) {
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
function formatTimerHMS(totalSeconds) {
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
function calcTimerDurationSec(hours = 0, minutes = 0, seconds = 0) {
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
function splitTimerDurationHMS(totalSeconds) {
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
function calcTimerProgress(remainingSec, durationSec, circumference = TCARD_CIRC) {
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
function buildTimerNotification(timerName, durationSec) {
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
function resolveAlarmId(focus = {}) {
  if (focus.sound === false || focus.soundType === 'off') return 'off';
  return ALARM_SOUNDS.some((s) => s.id === focus.soundType) ? focus.soundType : 'chime';
}

/**
 * Monta a notificação de transição entre etapas da sessão (função pura).
 * @param {{type: string, minutes?: number, label?: string}|undefined} finishedStep Etapa que acabou de terminar
 * @param {{type: string, minutes: number, label: string}|undefined} nextStep Próxima etapa (undefined = sessão acabou)
 * @returns {{title: string, body: string}|null}
 */
function buildPhaseNotification(finishedStep, nextStep) {
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
function justReachedGoal(before, after, goal) {
  return before < goal && after >= goal;
}

/** Duração padrão (em ms) da repetição do alarme sonoro e da exibição da notificação (5 segundos). */
const ALARM_DURATION_MS = 5000;
const ALARM_REPEAT_CYCLES = 5;
const NOTIFY_DURATION_MS = 5000;

let sharedAudioCtx = null;
let activeAlarmNodes = [];

function getAudioContext() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!sharedAudioCtx || sharedAudioCtx.state === 'closed') sharedAudioCtx = new Ctx();
  if (sharedAudioCtx.state === 'suspended') sharedAudioCtx.resume().catch(() => {});
  return sharedAudioCtx;
}

/**
 * Interrompe imediatamente qualquer alarme sonoro em andamento.
 */
function stopAlarmSound() {
  while (activeAlarmNodes.length) {
    const node = activeAlarmNodes.pop();
    try {
      node.osc.stop();
    } catch (_) {}
    try {
      node.osc.disconnect();
      node.gain.disconnect();
    } catch (_) {}
  }
}

/**
 * Toca um som de alarme usando Web Audio API, repetindo por 5 segundos como um alarme real.
 * Sem argumento toca o alarme configurado (respeitando "Silencioso").
 * Com `soundType` explícito é uma PRÉVIA: toca mesmo que o alarme salvo esteja silenciado,
 * para que o usuário possa ouvir antes de aplicar.
 * @param {string} [soundType] 'chime'|'bell'|'digital'|'marimba'|'harp'
 * @param {{durationMs?: number}} [options]
 * @returns {boolean} true se algum som foi disparado
 */
function playAlarmSound(soundType, options = {}) {
  const isPreview = soundType !== undefined;
  const type = isPreview ? soundType : resolveAlarmId(state.focus);
  stopAlarmSound();
  if (type === 'off') return false;

  try {
    const ctx = getAudioContext();
    if (!ctx) return false;
    const now = ctx.currentTime + 0.02;
    const durationMs = Math.max(1000, +(options.durationMs || ALARM_DURATION_MS));
    const cycles = Math.max(1, Math.round(durationMs / 1000));

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
      activeAlarmNodes.push({ osc, gain });
    };

    for (let c = 0; c < cycles; c++) {
      const offset = c * 1.0;
      if (type === 'bell') {
        // Campainha Cristalina (harmônicos agudos)
        [880, 1318.5, 1760].forEach((f, i) => {
          tone(f, offset + i * 0.18, 0.55, 'sine', 0.15);
          tone(f * 2, offset + i * 0.18, 0.28, 'triangle', 0.06);
        });
      } else if (type === 'digital') {
        // Alarme Digital Clássico (bipes duplos)
        [0, 0.12, 0.24, 0.52, 0.64, 0.76].forEach((t) => {
          tone(1046.5, offset + t, 0.08, 'square', 0.09);
        });
      } else if (type === 'marimba') {
        // Marimba Zen
        [392.0, 493.88, 587.33, 783.99].forEach((f, i) => {
          tone(f, offset + i * 0.11, 0.3, 'triangle', 0.2);
        });
      } else if (type === 'harp') {
        // Harpa Celestial (arpejo ascendente suave)
        [523.25, 587.33, 659.25, 783.99, 1046.5].forEach((f, i) => {
          tone(f, offset + i * 0.09, 0.5, 'sine', 0.13);
        });
      } else {
        // 'chime' (Padrão: Sino Suave)
        [523.25, 659.25, 783.99].forEach((f, i) => {
          tone(f, offset + i * 0.15, 0.45, 'sine', 0.15);
        });
      }
    }
    return true;
  } catch (_) {
    return false;
  }
}

let inAppToastTimer = null;

/**
 * Oculta o banner flutuante de notificação interno (#app-toast).
 */
function hideInAppNotification() {
  clearTimeout(inAppToastTimer);
  inAppToastTimer = null;
  const el = $('app-toast');
  if (!el) return;
  try {
    if (typeof el.hidePopover === 'function' && el.matches(':popover-open')) {
      el.hidePopover();
    }
  } catch (_) {}
  el.style.display = 'none';
}

/**
 * Exibe o banner flutuante interno (#app-toast) por 5 segundos no Top-Layer do navegador.
 * Funciona mesmo quando o navegador ou app está em tela cheia (F11 ou Fullscreen API),
 * onde o Windows suprime toasts nativos por padrão via Assistência de Foco.
 * @param {string} title
 * @param {string} body
 * @param {number} [durationMs=NOTIFY_DURATION_MS]
 * @returns {boolean}
 */
function showInAppNotification(title, body, durationMs = NOTIFY_DURATION_MS) {
  if (typeof document === 'undefined') return false;
  const el = $('app-toast');
  if (!el) return false;

  clearTimeout(inAppToastTimer);
  const host = document.fullscreenElement || document.body;
  if (host && el.parentElement !== host) {
    try {
      host.appendChild(el);
    } catch (_) {}
  }

  const dur = Math.max(1000, +durationMs || NOTIFY_DURATION_MS);
  el.innerHTML = `
    <div class="app-toast-head">
      <strong class="app-toast-title">${esc(title || 'Rabitu')}</strong>
      <button type="button" class="app-toast-close" id="app-toast-close" aria-label="Fechar notificação">✕</button>
    </div>
    <p class="app-toast-body">${esc(body || '')}</p>
    <div class="app-toast-bar" style="animation-duration:${dur}ms"></div>
  `;
  el.style.display = 'block';
  try {
    if (typeof el.showPopover === 'function') {
      if (el.matches(':popover-open')) el.hidePopover();
      el.showPopover();
    }
  } catch (_) {}

  const closeBtn = $('app-toast-close');
  if (closeBtn) {
    closeBtn.onclick = () => {
      stopAlarmSound();
      hideInAppNotification();
    };
  }

  inAppToastTimer = setTimeout(() => {
    hideInAppNotification();
  }, dur);
  return true;
}

/**
 * Envia uma notificação do sistema com duração de 5 segundos (compatível com F11 Fullscreen).
 * Sempre exibe o banner Top-Layer interno (#app-toast) por 5 segundos — garantindo visibilidade
 * mesmo em modo tela cheia (F11) no navegador ou Electron — e também dispara o toast do Windows/Web.
 * @param {string} title Título da notificação
 * @param {string} body Corpo da mensagem
 * @param {number} [durationMs=NOTIFY_DURATION_MS] Duração em ms (padrão: 5000ms)
 * @returns {Promise<{channel: 'native'|'web'|'in-app'|'unsupported'|'denied', ok: boolean, error?: string}>}
 */
async function sendWindowsNotification(title, body, durationMs = NOTIFY_DURATION_MS) {
  const shownInApp = showInAppNotification(title, body, durationMs);
  try {
    if (window.rabituNative && typeof window.rabituNative.notify === 'function') {
      const r = await window.rabituNative.notify(title, body, durationMs);
      return { channel: 'native', ok: !!(r && r.ok) || shownInApp, error: r && r.error };
    }
    if (typeof Notification === 'undefined') {
      return shownInApp
        ? { channel: 'in-app', ok: true }
        : { channel: 'unsupported', ok: false, error: 'Notification API indisponível' };
    }
    let perm = Notification.permission;
    if (perm === 'default') perm = await Notification.requestPermission();
    if (perm !== 'granted') {
      return shownInApp
        ? { channel: 'in-app', ok: true }
        : { channel: 'denied', ok: false, error: 'Permissão de notificação negada' };
    }
    const n = new Notification(title, { body });
    setTimeout(() => {
      try {
        n.close();
      } catch (_) {}
    }, Math.max(1000, +durationMs || NOTIFY_DURATION_MS));
    return { channel: 'web', ok: true };
  } catch (err) {
    return shownInApp
      ? { channel: 'in-app', ok: true }
      : { channel: 'unsupported', ok: false, error: err && err.message ? err.message : String(err) };
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
function recordFocusMinutes(mins) {
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

function advanceSessionStep() {
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

function getTimerRemainingSec(timer) {
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

function completeTimer(timerId) {
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

function toggleTimer(timerId) {
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

function resetTimer(timerId) {
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

function startFocusSession() {
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

function togglePauseSession() {
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

function stopFocusSession(flushPartial = true) {
  if (activeSession && flushPartial) {
    creditElapsedFocusMinutes(false);
  }
  activeSession = null;
  ensureTickLoop();
  drawClock();
}

function switchClockSubtab(subtab) {
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
function drawClock() {
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
  stopAlarmSound();
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
    stopAlarmSound();
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

function openTimerModal(timerId = null) {
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
function initClockTab() {
  const gdlg = $('gdlg');
  if (gdlg) {
    $('gok').onclick = saveGoalModal;
    $('gcancel').onclick = () => gdlg.close();
    ['ggoal', 'gtoday'].forEach((id) => {
      const el = $(id);
      if (el) {
        el.onkeydown = (e) => {
          if (e.key === 'Enter') saveGoalModal();
        };
      }
    });
  }

  const cdlg = $('cdlg');
  if (cdlg) {
    $('cok').onclick = saveClockConfigModal;
    $('ccancel').onclick = () => {
      stopAlarmSound();
      cdlg.close();
    };
    ['cblock', 'cbreak'].forEach((id) => {
      const el = $(id);
      if (el) {
        el.onkeydown = (e) => {
          if (e.key === 'Enter') saveClockConfigModal();
        };
      }
    });
    $('csound-test').onclick = previewSelectedAlarm;
    // Ao trocar a opção, já toca a prévia (ainda sem aplicar).
    $('csound').onchange = previewSelectedAlarm;
    const nbtn = $('cnotify-test');
    if (nbtn) nbtn.onclick = testNotification;
  }

  const tdlg = $('tdlg');
  if (tdlg) {
    $('tok').onclick = saveTimerModal;
    $('tcancel').onclick = () => tdlg.close();
    $('tdel').onclick = deleteTimerFromModal;
    ['tname', 'thours', 'tmins', 'tsecs'].forEach((id) => {
      const el = $(id);
      if (el) {
        el.onkeydown = (e) => {
          if (e.key === 'Enter') saveTimerModal();
        };
      }
    });
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
  }
}


/* === js/core/health.js === */
/**
 * @fileoverview Suíte Pré-definida de Testes de Qualidade e Saúde do Programa (Self-Diagnostic Suite).
 * Executa automaticamente na inicialização do aplicativo (e via terminal) para validar
 * datas, segurança XSS, cálculo de ofensivas, regras de créditos, sessões de foco, sons,
 * tempo de tooltip (1,75s) e integridade do DOM.
 */

/**
 * Executa todos os testes de saúde e qualidade do sistema.
 * @param {{checkDOM?: boolean, silent?: boolean}} [options]
 * @returns {{passed: number, failed: number, total: number, results: Array<{name: string, ok: boolean, error?: string}>}}
 */
function runHealthCheck(options = {}) {
  const checkDOM = options.checkDOM ?? typeof document !== 'undefined';
  const silent = options.silent ?? false;
  const results = [];

  function test(name, fn) {
    try {
      fn();
      results.push({ name, ok: true });
    } catch (err) {
      results.push({
        name,
        ok: false,
        error: err && err.message ? err.message : String(err),
      });
    }
  }

  function assert(condition, msg) {
    if (!condition) throw new Error(msg || 'Falha de asserção');
  }

  // 1. Motor de Datas UTC
  test('Datas UTC: conversão keyOf <-> parseKey e ano bissexto', () => {
    const sampleDay = 20742; // 2026-10-16
    const iso = keyOf(sampleDay);
    assert(iso === '2026-10-16', `Esperado 2026-10-16, obtido ${iso}`);
    assert(parseKey(iso) === sampleDay, 'parseKey deve reverter keyOf com exatidão');
    assert(fmtD(sampleDay) === '16/10/2026', 'fmtD deve formatar DD/MM/AAAA');
    assert(dim(2024, 1) === 29, 'Fevereiro de 2024 (bissexto) deve ter 29 dias');
    assert(dim(2026, 1) === 28, 'Fevereiro de 2026 deve ter 28 dias');
    assert(dow(sampleDay) >= 0 && dow(sampleDay) <= 6, 'dow deve estar entre 0 e 6');
    assert(nWeeks(2026, 9) >= 4 && nWeeks(2026, 9) <= 6, 'nWeeks válido');
  });

  // 2. Segurança XSS e Tempo de Tooltip (1,75s = 1750ms)
  test('UI Global: escape XSS e tempo de tooltip de 1,75s (1750ms)', () => {
    const dirty = `<script>alert("x"&'y')</script>`;
    const clean = esc(dirty);
    assert(!clean.includes('<') && !clean.includes('>'), 'Tags HTML devem ser escapadas');
    assert(clean.includes('&lt;script&gt;'), 'Deve conter entidades escapadas');
    assert(
      DEFAULT_TIP_DELAY === 1750,
      `Delay padrão de tooltip deve ser 1750ms (1,75s), obtido ${DEFAULT_TIP_DELAY}`
    );
  });

  // 3. Regras do Tanque de Lazer e Double-Check do Banco de Horas
  test('Banco de Horas & Tanque de Lazer: créditos e double-check de atividades', () => {
    assert(MINS === 20, '1 crédito deve equivaler a 20 minutos');
    assert(PER === 0.5, 'Cada 0,5h de estudo deve gerar 1 crédito');
    assert(HABCREDIT === 0.5, 'Cada hábito concluído deve valer 0,5 crédito');
    assert(HABMIN === 10, 'Cada hábito concluído deve somar 10 minutos de lazer');

    const dummyItem = { hours: 1.5, done: [], half: [] };
    const c1 = advanceBankSquareState(dummyItem, 2);
    assert(c1.state === 'half' && c1.hoursDelta === 0, '1º clique deve ser apenas visual (half) e somar 0h');
    assert(dummyItem.half.includes(2) && !dummyItem.done.includes(2), '1º clique deve registrar em half e não em done');

    const c2 = advanceBankSquareState(dummyItem, 2);
    assert(c2.state === 'done' && c2.hoursDelta === 1.5, '2º clique (double-check) deve confirmar e somar 1.5h');
    assert(!dummyItem.half.includes(2) && dummyItem.done.includes(2), '2º clique deve mover de half para done');

    const c3 = advanceBankSquareState(dummyItem, 2);
    assert(c3.state === 'empty' && c3.hoursDelta === -1.5, '3º clique deve desmarcar e estornar -1.5h');
    assert(!dummyItem.half.includes(2) && !dummyItem.done.includes(2), '3º clique deve limpar half e done');
  });

  // 4. Cálculo de Ofensivas (Streaks) de Hábitos
  test('Hábitos: cálculo de ofensiva atual e recorde (stats)', () => {
    const t = 20000;
    const h = {
      dates: [keyOf(t - 5), keyOf(t - 4), keyOf(t - 3), keyOf(t - 1)],
    };
    const st = stats(h);
    assert(st.best === 3, `Melhor ofensiva esperada 3, obtida ${st.best}`);
    assert(st.total === 4, `Total esperado 4, obtido ${st.total}`);
  });

  // 5. Relógio de Foco: Cálculo de Intervalos, Plano de Sessão e Sons de Alarme
  test('Relógio de Foco: intervalos, plano de 180 min e catálogo de sons', () => {
    assert(
      calcFocusIntervals(180, false, 60) === 2,
      '180 min com blocos de 60 min deve ter 2 intervalos'
    );
    assert(
      calcFocusIntervals(180, true, 60) === 0,
      'Com "Pular pausas" marcado deve ter 0 intervalos'
    );
    assert(
      calcFocusIntervals(45, false, 60) === 0,
      'Sessão menor ou igual ao bloco deve ter 0 intervalos'
    );

    const plan = buildSessionPlan(180, false, 60, 5);
    assert(plan.breakCount === 2, 'Plano de 180 min deve conter 2 pausas');
    assert(plan.steps.length === 5, 'Plano deve ter 3 blocos de foco + 2 pausas = 5 etapas');
    const sumFocus = plan.steps
      .filter((s) => s.type === 'focus')
      .reduce((acc, s) => acc + s.minutes, 0);
    assert(sumFocus === 180, `Soma dos blocos de foco deve ser 180, obtido ${sumFocus}`);
    assert(plan.steps[1].type === 'break' && plan.steps[1].minutes === 5, 'Pausa deve ter 5 min');
    assert(
      Array.isArray(ALARM_SOUNDS) && ALARM_SOUNDS.length >= 6,
      'Catálogo de sons deve ter ao menos 6 opções'
    );
  });

  // 6. Relógio de Foco: Andamento Diário, Parabéns da Meta e Sequência
  test('Relógio de Foco: andamento diário, meta batida (goalReached) e sequência', () => {
    const fakeToday = 20742;
    const hist = {
      [keyOf(fakeToday - 3)]: 240,
      [keyOf(fakeToday - 2)]: 250,
      [keyOf(fakeToday - 1)]: 240,
      [keyOf(fakeToday)]: 53,
    };
    const st = calcDailyFocusStats(hist, 240, fakeToday);
    assert(st.todayMin === 53, `Hoje esperado 53 min, obtido ${st.todayMin}`);
    assert(st.yesterdayMin === 240, `Ontem esperado 240 min, obtido ${st.yesterdayMin}`);
    assert(st.streak === 3, `Sequência esperada 3 dias (ontem + 2 anteriores), obtido ${st.streak}`);
    assert(st.goalReached === false, 'Com 53/240 min goalReached deve ser false');

    const stDone = calcDailyFocusStats({ ...hist, [keyOf(fakeToday)]: 240 }, 240, fakeToday);
    assert(stDone.goalReached === true, 'Com 240/240 min goalReached deve ser true');
    assert(stDone.streak === 4, 'Ao bater a meta hoje, a sequência sobe para 4 dias');

    const disp = formatGoalDisplay(240);
    assert(disp.value === '4' && disp.unit === 'horas', '240 min deve exibir 4 horas');
    assert(formatCountdown(1500) === '25:00', '1500s deve formatar como 25:00');
    assert(formatCountdown(3661) === '01:01:01', '3661s deve formatar como 01:01:01');
  });

  // 6b. Relógio de Foco: alarme de 5s, notificações de 5s e detecção de meta batida
  test('Relógio de Foco: alarme repetitivo de 5s, notificações de 5s e meta batida', () => {
    assert(ALARM_DURATION_MS === 5000, 'Duração do alarme sonoro deve ser 5000ms (5s)');
    assert(ALARM_REPEAT_CYCLES === 5, 'Alarme deve repetir por 5 ciclos em 5 segundos');
    assert(NOTIFY_DURATION_MS === 5000, 'Duração da notificação deve ser 5000ms (5s)');
    assert(resolveAlarmId({ sound: true, soundType: 'bell' }) === 'bell', 'Deve respeitar o som escolhido');
    assert(resolveAlarmId({ sound: false, soundType: 'bell' }) === 'off', 'sound=false silencia o alarme');
    assert(resolveAlarmId({ soundType: 'off' }) === 'off', 'soundType=off silencia o alarme');
    assert(resolveAlarmId({ soundType: 'inexistente' }) === 'chime', 'Som inválido cai no padrão (chime)');
    assert(resolveAlarmId({}) === 'chime', 'Sem configuração usa o chime');

    const focus = { type: 'focus', minutes: 60, label: 'Foco (1 de 3)' };
    const brk = { type: 'break', minutes: 5, label: 'Intervalo (1 de 2)' };
    const n1 = buildPhaseNotification(focus, brk);
    assert(n1 && n1.title.includes('intervalo') && n1.body.includes('5 min'), 'Fim do foco deve avisar do intervalo');
    const n2 = buildPhaseNotification(brk, focus);
    assert(n2 && n2.title.includes('Fim do intervalo'), 'Fim da pausa deve avisar para retomar');
    const n3 = buildPhaseNotification(focus, undefined);
    assert(n3 && n3.title.includes('concluída'), 'Última etapa deve avisar que a sessão acabou');
    assert(buildPhaseNotification(focus, focus) === null, 'Foco -> foco não gera notificação');

    assert(justReachedGoal(239, 240, 240) === true, 'Cruzar a meta deve disparar o parabéns');
    assert(justReachedGoal(240, 241, 240) === false, 'Já estava batida: não repete o parabéns');
    assert(justReachedGoal(10, 50, 240) === false, 'Abaixo da meta: sem parabéns');
  });

  // 6c. Temporizador: formatação HH:MM:SS, conversão de duração, anel de progresso e notificação
  test('Temporizador: formatação HH:MM:SS, cálculo de duração e progresso circular', () => {
    assert(formatTimerHMS(1805) === '00:30:05', '1805s deve formatar como 00:30:05');
    assert(formatTimerHMS(1478) === '00:24:38', '1478s deve formatar como 00:24:38');
    assert(formatTimerHMS(0) === '00:00:00', '0s deve formatar como 00:00:00');
    assert(calcTimerDurationSec(0, 30, 5) === 1805, '0h 30m 5s deve ser 1805s');
    assert(calcTimerDurationSec(1, 0, 0) === 3600, '1h deve ser 3600s');
    assert(calcTimerDurationSec(0, 0, 0) === 0, '0h 0m 0s deve retornar 0');

    const hms = splitTimerDurationHMS(3665);
    assert(hms.hours === 1 && hms.minutes === 1 && hms.seconds === 5, 'splitTimerDurationHMS deve separar 1h 1m 5s');

    const pHalf = calcTimerProgress(900, 1800, TCARD_CIRC);
    assert(Math.abs(pHalf.ratio - 0.5) < 1e-6, 'Proporção em metade do tempo deve ser 0.5');
    assert(Math.abs(pHalf.dashOffset - TCARD_CIRC * 0.5) < 1e-4, 'dashOffset em 50% deve ser metade da circunferência');

    const tn = buildTimerNotification('CALC II', 1800);
    assert(tn.title.includes('Temporizador') && tn.body.includes('CALC II') && tn.body.includes('00:30:00'), 'Notificação de temporizador deve incluir nome e duração');
  });

  // 7. Integridade do Estado, DOM e Estabilidade dos Modais (quando no navegador)
  if (checkDOM) {
    test('Integridade do DOM, Identidade "Rabitu" e Estado da Aplicação', () => {
      const requiredIds = [
        'app',
        'tH',
        'tD',
        'tB',
        'tC',
        'main',
        'dash',
        'bank',
        'clock',
        'app-toast',
        'dlg',
        'ddlg',
        'fdlg',
        'bdlg',
        'rdlg',
        'sdlg',
        'qdlg',
        'gdlg',
        'cdlg',
        'tdlg',
      ];
      for (const id of requiredIds) {
        assert($(id) !== null, `Elemento obrigatório #${id} ausente no DOM`);
      }
      const logoSpan = document.querySelector('.logo span');
      assert(
        logoSpan && logoSpan.textContent.trim() === 'Rabitu',
        'Logo deve exibir o nome "Rabitu"'
      );
      assert(Array.isArray(state.habits), 'state.habits deve ser um Array');
      assert(Array.isArray(state.bank), 'state.bank deve ser um Array');
      assert(state.focus && typeof state.focus === 'object', 'state.focus deve existir');
      assert(Array.isArray(state.focus.timers), 'state.focus.timers deve ser um Array');
    });

    test('Estabilidade dos Modais (<dialog>): não fecham ao clicar fora dos campos editáveis', () => {
      const dialogIds = ['dlg', 'ddlg', 'fdlg', 'bdlg', 'rdlg', 'sdlg', 'qdlg', 'gdlg', 'cdlg', 'tdlg'];
      for (const id of dialogIds) {
        const dlg = $(id);
        assert(dlg !== null, `Modal #${id} não encontrado`);
        const wasOpen = dlg.open;
        if (!wasOpen) dlg.showModal();
        try {
          // Simula clique diretamente na superfície do <dialog> (fora dos inputs) e em rótulos internos
          dlg.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
          dlg.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
          dlg.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          const label = dlg.querySelector('label, strong, p');
          if (label) {
            label.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          }
          assert(
            dlg.open === true,
            `Modal #${id} fechou sozinho ao clicar fora dos campos editáveis`
          );
        } finally {
          if (!wasOpen && dlg.open) dlg.close();
        }
      }
    });
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;

  if (!silent) {
    if (failed === 0) {
      console.info(`✅ [HealthCheck] Todos os ${passed}/${results.length} testes de saúde passaram.`);
    } else {
      console.error(
        `❌ [HealthCheck] ${failed} falha(s) em ${results.length} testes:`,
        results.filter((r) => !r.ok)
      );
    }
  }

  return { passed, failed, total: results.length, results };
}


/* === js/main.js === */
/**
 * @fileoverview Bootstrapper principal da aplicação.
 * Conecta o roteamento de abas (Hábitos, Dashboard, Banco de Horas, Relógio),
 * inicializa os módulos independentes, executa a suíte de testes de saúde e dispara a sincronização.
 */

/**
 * Alterna a aba ativa do aplicativo.
 * @param {'habits'|'dash'|'bank'|'clock'} view
 */
function setView(view) {
  state.activeTab = view;
  $('app').classList.toggle('dashmode', view !== 'habits');
  $('main').style.display = view === 'habits' ? '' : 'none';
  $('dash').style.display = view === 'dash' ? '' : 'none';
  $('bank').style.display = view === 'bank' ? '' : 'none';
  $('clock').style.display = view === 'clock' ? '' : 'none';

  [
    ['tH', 'habits'],
    ['tD', 'dash'],
    ['tB', 'bank'],
    ['tC', 'clock'],
  ].forEach(([id, key]) => $(id).classList.toggle('on', key === view));

  $('tank').style.display = view === 'bank' ? '' : 'none';

  if (view === 'habits') renderHabits();
  if (view === 'dash') drawDash();
  if (view === 'bank') drawBank();
  if (view === 'clock') drawClock();
}

function initApp() {
  // Inicializa infraestrutura global de UI
  initTheme();
  initTooltips();

  // Registra observador para atualizações vindas da sincronização ou do tanque
  subscribeUI(() => {
    drawTank();
    if (state.activeTab === 'habits') renderHabits();
    if (state.activeTab === 'dash') drawDash();
    if (state.activeTab === 'bank') drawBank();
    if (state.activeTab === 'clock') drawClock();
  });

  // Navegação entre abas
  $('tH').onclick = () => setView('habits');
  $('tD').onclick = () => setView('dash');
  $('tB').onclick = () => setView('bank');
  $('tC').onclick = () => setView('clock');

  // Inicializa cada módulo de aba e modais
  initHabitsTab();
  initBankTab();
  initClockTab();
  initReportsModal();
  initSupabaseModal();

  // Posiciona na semana de hoje e sincroniza com o Supabase
  goToday();
  sync();

  // Executa os testes de saúde e qualidade do programa na inicialização
  window.runHealthCheck = runHealthCheck;
  runHealthCheck();
}

initApp();


})();
