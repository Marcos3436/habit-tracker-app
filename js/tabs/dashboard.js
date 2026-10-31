/**
 * @fileoverview Módulo da Aba 2: Dashboard.
 * Exibe o gráfico de barras empilhadas (concluídos vs falhas) e, ao lado dele,
 * a estatística de porcentagem de hábitos concluídos e as listas de hábitos
 * que mais são feitos e hábitos mais falhos no período.
 */

import {
  DAY,
  keyOf,
  MONTHS_INITIAL,
  mStart,
  todayN,
} from '../core/dates.js';
import { $, esc } from '../core/dom.js';
import { state } from '../core/state.js';

let dashRange = 'month';

/**
 * Calcula o resumo estatístico do Dashboard para o intervalo [startDay, endDay].
 * @param {Array<{id?: string, name: string, dates?: string[], fails?: string[]}>} habits
 * @param {number} startDay
 * @param {number} endDay
 */
export function calcDashboardSummary(habits, startDay, endDay) {
  const list = Array.isArray(habits) ? habits : [];
  const days = Math.max(1, endDay - startDay + 1);

  const items = list.map((h) => {
    const set = new Set(Array.isArray(h.dates) ? h.dates : []);
    const fset = new Set(Array.isArray(h.fails) ? h.fails : []);
    let done = 0;
    let fails = 0;
    for (let n = startDay; n <= endDay; n++) {
      const k = keyOf(n);
      if (set.has(k)) done++;
      if (fset.has(k)) fails++;
    }
    const missed = Math.max(0, days - done);
    const pct = Math.round((done / days) * 100);
    const failPct = Math.max(0, 100 - pct);
    return {
      id: h.id || h.name,
      name: h.name,
      done,
      fails,
      missed,
      days,
      pct,
      failPct,
    };
  });

  const totalPossible = list.length * days;
  const totalDone = items.reduce((acc, it) => acc + it.done, 0);
  const totalFails = items.reduce((acc, it) => acc + it.fails, 0);
  const overallPct = totalPossible > 0 ? Math.round((totalDone / totalPossible) * 100) : 0;

  // Hábitos que mais são feitos: maior número de conclusões, desempate por menor número de falhas
  const mostDone = [...items].sort(
    (a, b) => b.done - a.done || a.fails - b.fails || a.name.localeCompare(b.name)
  );

  // Hábitos mais falhos: prioriza os que têm mais marcações de falha (✕) e menos conclusões no período
  const mostFailed = [...items]
    .filter((it) => it.fails > 0 || it.done < days)
    .sort(
      (a, b) => b.fails - a.fails || a.done - b.done || a.name.localeCompare(b.name)
    );

  return {
    days,
    totalHabits: list.length,
    totalPossible,
    totalDone,
    totalFails,
    overallPct,
    items,
    mostDone,
    mostFailed,
  };
}

/**
 * Renderiza a aba Dashboard (#dash).
 */
export function drawDash() {
  const d0 = new Date();
  const t = todayN();
  const y = d0.getFullYear();
  const s =
    dashRange === 'month'
      ? mStart(y, d0.getMonth())
      : dashRange === '30d'
        ? t - 29
        : Math.floor(Date.UTC(y, 0, 1) / DAY);

  const H = state.habits;
  const sets = H.map((h) => new Set(h.dates));
  const fsets = H.map((h) => new Set(h.fails || []));
  const summary = calcDashboardSummary(H, s, t);

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

  const topDone = summary.mostDone.slice(0, 5);
  const topFailed = summary.mostFailed.slice(0, 5);

  const doneListHtml = topDone.length
    ? topDone
        .map(
          (it) => `<div class="dash-rank-item">
            <div class="dash-rank-top">
              <span class="dash-rank-name" title="${esc(it.name)}">${esc(it.name)}</span>
              <b class="dash-rank-val good">${it.done}/${it.days}d · ${it.pct}%</b>
            </div>
            <div class="dash-rank-bar"><i class="good" style="width:${it.pct}%"></i></div>
          </div>`
        )
        .join('')
    : '<p class="muted-msg">Nenhum hábito cadastrado.</p>';

  const failListHtml = !H.length
    ? '<p class="muted-msg">Nenhum hábito cadastrado.</p>'
    : topFailed.length
      ? topFailed
          .map((it) => {
            const failDetail =
              it.fails > 0
                ? `${it.fails} ✕ · ${it.failPct}% falho`
                : `${it.missed}d sem fazer · ${it.failPct}% falho`;
            return `<div class="dash-rank-item">
              <div class="dash-rank-top">
                <span class="dash-rank-name" title="${esc(it.name)}">${esc(it.name)}</span>
                <b class="dash-rank-val bad">${failDetail}</b>
              </div>
              <div class="dash-rank-bar"><i class="bad" style="width:${it.failPct}%"></i></div>
            </div>`;
          })
          .join('')
      : '<p class="muted-msg">Todos os hábitos foram 100% concluídos!</p>';

  $('dash').innerHTML = `<div class="dp">
    <div class="section-header">
      <h2>Dashboard</h2>
      <select class="sel" id="drg">
        <option value="month">Este mês</option>
        <option value="30d">Últimos 30 dias</option>
        <option value="year">Este ano</option>
      </select>
    </div>

    <div class="dash-main-grid">
      <div class="dash-chart-card">
        <div class="dash-card-head">
          <strong>Conclusões por ${dashRange === 'year' ? 'mês' : 'dia'}</strong>
          <div class="dash-legend">
            <span><i class="dot-g"></i> Concluídos</span>
            <span><i class="dot-r"></i> Falhas (✕)</span>
          </div>
        </div>
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
      </div>

      <div class="dash-side-panel">
        <div class="dash-pct-card" id="dash-pct-card">
          <div class="dash-pct-ring" style="--pct:${summary.overallPct}">
            <span id="dash-pct-value">${summary.overallPct}%</span>
          </div>
          <div class="dash-pct-info">
            <strong>Hábitos concluídos</strong>
            <p>${summary.totalDone} de ${summary.totalPossible} conclusões no período</p>
            <small>${summary.totalHabits} ${summary.totalHabits === 1 ? 'hábito ativo' : 'hábitos ativos'} · ${summary.days} ${summary.days === 1 ? 'dia avaliado' : 'dias avaliados'}</small>
          </div>
        </div>

        <div class="dash-lists-grid">
          <div class="dash-rank-card" id="dash-most-done">
            <div class="dash-rank-head">
              <span class="dash-badge good">✓</span>
              <strong>Mais feitos</strong>
            </div>
            <div class="dash-rank-list">
              ${doneListHtml}
            </div>
          </div>

          <div class="dash-rank-card" id="dash-most-failed">
            <div class="dash-rank-head">
              <span class="dash-badge bad">✕</span>
              <strong>Mais falhos</strong>
            </div>
            <div class="dash-rank-list">
              ${failListHtml}
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>`;

  $('drg').value = dashRange;
  $('drg').onchange = () => {
    dashRange = $('drg').value;
    drawDash();
  };
}
