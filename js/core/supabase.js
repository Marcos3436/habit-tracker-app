/**
 * @fileoverview Cliente REST direto para o Supabase (sem dependências externas)
 * e motor de sincronização bidirecional (Hábitos, Conclusões, Banco de Horas e Tanque de Lazer).
 */

import { $ } from './dom.js';
import {
  MINS,
  notifyUI,
  persistRw,
  saveBank,
  saveFocus,
  saveHabits,
  state,
} from './state.js';

const SB_KEY = 'habit-tracker.sb';
const UP = { Prefer: 'resolution=merge-duplicates,return=minimal' };

/**
 * Obtém a configuração salva do Supabase (URL e Anon Key).
 * @returns {{url?: string, key?: string}}
 */
export const cfg = () => {
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
export const isCloudOn = () => {
  const c = cfg();
  return !!(c.url && c.key);
};

/**
 * Atualiza o indicador visual de status da nuvem no topo da tela.
 * @param {'off'|'busy'|'ok'|'err'} st
 * @param {string} [msg]
 */
export function cloud(st, msg) {
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
export async function sb(path, o = {}) {
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
export const quiet = (fn) => {
  if (isCloudOn()) {
    fn()
      .then(() => cloud('ok', 'Última sincronização: ' + new Date().toLocaleTimeString()))
      .catch((e) => cloud('err', e.message));
  }
};

/* ---------- Sincronização de Hábitos e Marcações ---------- */

export async function pushHabits() {
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

export async function pushDay(id, k, st) {
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

export function deleteHabitRemote(id) {
  quiet(() => sb('habits?id=eq.' + encodeURIComponent(id), { method: 'DELETE' }));
}

/* ---------- Sincronização do Banco de Horas ---------- */

export async function pushBankItems() {
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

export function toggleBankSquareRemote(itemId, idx, had) {
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

export function saveBankItemRemote(itemId, shrink, newSize) {
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

export function deleteBankItemRemote(itemId) {
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

export async function pushRw() {
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

export async function pushFocus() {
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

export async function sync() {
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
export function initSupabaseModal() {
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
