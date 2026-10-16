/* Fallback automatico para execucao direta via protocolo file:// (duplo-clique no index.html sem servidor HTTP) */
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
        const delay = +el.dataset.tipDelay || 0;
        if (delay) {
          tipTimer = setTimeout(() => {
            if (tipEl === el) showTip(el);
          }, delay);
        } else {
          showTip(el);
        }
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

const now = new Date();

/**
 * Estado reativo compartilhado entre os módulos.
 */
const state = {
  habits: loadedHabits,
  isMock,
  bank: loadedBank,
  rw: loadedRw,
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
      });
    } else {
      existing.name = r.name;
      existing.size = r.size;
      existing.hours = +r.hours;
    }
  });

  const map = Object.fromEntries(state.bank.map((b) => [b.id, b]));
  rp.forEach((r) => {
    const b = map[r.item_id];
    if (b && r.idx < b.size && !b.done.includes(r.idx)) {
      b.done.push(r.idx);
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
 * Renderiza a aba Banco de Horas (#bank).
 */
function drawBank() {
  const keep = $('bank').scrollTop;
  const rows = state.bank
    .map((b) => {
      const set = new Set(b.done);
      const squares = Array.from(
        { length: b.size },
        (_, i) =>
          `<button type="button" class="sq ${set.has(i) ? 'on' : ''}" data-b="${b.id}" data-i="${i}"></button>`
      ).join('');
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
    const newHoursEarned = keptDone.length * hours;
    const deltaHours = newHoursEarned - oldHoursEarned;

    Object.assign(b, { name, size, hours, done: keptDone });
    if (deltaHours !== 0) addHours(deltaHours);
  } else {
    b = { id: uid(), name, size, hours, done: [] };
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
      const had = b.done.includes(i);
      b.done = had ? b.done.filter((x) => x !== i) : [...b.done, i];
      saveBank();
      addHours(had ? -b.hours : b.hours);
      drawBank();
      toggleBankSquareRemote(b.id, i, had);
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
            <button type="button" class="fire ${s.cur ? 'on' : ''}" data-streak="${h.id}" title="Ver detalhes da ofensiva" data-tip-delay="2500">
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
  ddlg.addEventListener('click', (e) => {
    if (e.target === ddlg) ddlg.close();
  });

  // Modal de Ofensiva (#fdlg)
  $('fclose').onclick = () => fdlg.close();
  fdlg.addEventListener('click', (e) => {
    if (e.target === fdlg) fdlg.close();
  });

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


/* === js/main.js === */
/**
 * @fileoverview Bootstrapper principal da aplicação.
 * Conecta o roteamento de abas (Hábitos, Dashboard, Banco de Horas),
 * inicializa os módulos independentes e dispara a sincronização inicial.
 */

/**
 * Alterna a aba ativa do aplicativo.
 * @param {'habits'|'dash'|'bank'} view
 */
function setView(view) {
  state.activeTab = view;
  $('app').classList.toggle('dashmode', view !== 'habits');
  $('main').style.display = view === 'habits' ? '' : 'none';
  $('dash').style.display = view === 'dash' ? '' : 'none';
  $('bank').style.display = view === 'bank' ? '' : 'none';

  [
    ['tH', 'habits'],
    ['tD', 'dash'],
    ['tB', 'bank'],
  ].forEach(([id, key]) => $(id).classList.toggle('on', key === view));

  $('tank').style.display = view === 'bank' ? '' : 'none';

  if (view === 'habits') renderHabits();
  if (view === 'dash') drawDash();
  if (view === 'bank') drawBank();
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
  });

  // Navegação entre abas
  $('tH').onclick = () => setView('habits');
  $('tD').onclick = () => setView('dash');
  $('tB').onclick = () => setView('bank');

  // Inicializa cada módulo de aba e modais
  initHabitsTab();
  initBankTab();
  initReportsModal();
  initSupabaseModal();

  // Posiciona na semana de hoje e sincroniza com o Supabase
  goToday();
  sync();
}

initApp();

})();
