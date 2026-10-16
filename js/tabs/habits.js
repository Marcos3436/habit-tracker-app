/**
 * @fileoverview Módulo da Aba 1: Hábitos.
 * Responsável pela grade semanal, navegação no calendário, marcação de dias (✓ / ✕),
 * arrastar para reordenar (drag-and-drop), modal de criação/edição, diagrama de pontos mensal
 * e detalhes da ofensiva (🔥).
 */

import {
  DAY,
  dim,
  dow,
  fmtD,
  fmtMonthYear,
  keyOf,
  mStart,
  nWeeks,
  parseKey,
  todayN,
  WD,
} from '../core/dates.js';
import { $, ask, esc, uid } from '../core/dom.js';
import { HABMIN, saveHabits, state, stats } from '../core/state.js';
import {
  deleteHabitRemote,
  pushDay,
  pushHabits,
  quiet,
} from '../core/supabase.js';
import { addLeisure } from './bank.js';

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
export function goToday() {
  const d = new Date();
  state.view.y = d.getFullYear();
  state.view.m = d.getMonth();
  state.view.w = Math.floor(
    (dow(mStart(state.view.y, state.view.m)) + d.getDate() - 1) / 7
  );
  renderHabits();
}

export function shiftMonth(k) {
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

export function shiftWeek(k) {
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
export function renderHabits() {
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

export function initHabitsTab() {
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
