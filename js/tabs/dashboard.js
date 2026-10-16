/**
 * @fileoverview Módulo da Aba 2: Dashboard.
 * Exibe indicadores de hábitos ativos, gráfico de barras empilhadas (concluídos vs falhas)
 * e barras de progresso individuais por período (Mês atual, 30 dias, Ano atual).
 */

import {
  DAY,
  keyOf,
  MONTHS_INITIAL,
  mStart,
  todayN,
} from '../core/dates.js';
import { $, esc } from '../core/dom.js';
import { state, stats } from '../core/state.js';

let dashRange = 'month';

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
