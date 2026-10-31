/**
 * @fileoverview Módulo de Relatórios (Mensal e Anual) com Matriz Visual de Hábitos
 * (barras de conclusão diária conectadas no mês e barras mensais no ano),
 * exportação CSV (UTF-8 BOM para Excel) e visualização para Impressão / PDF.
 */

import {
  DAY,
  dim,
  dow,
  fmtD,
  fmtMonthYear,
  keyOf,
  MONTHS_SHORT,
  mStart,
  parseKey,
  todayN,
  WD,
} from '../core/dates.js';
import { $, esc } from '../core/dom.js';
import { state } from '../core/state.js';

let reportData = null;

/**
 * Constrói os dados da matriz visual de hábitos concluídos no mês.
 * Cada dia do mês possui flags de barra conectada (`on`, `pl`, `nr`) e falha (`x`),
 * idênticas às barras de conclusão diária da aba Hábitos.
 * @param {Array<{id?: string, name: string, dates?: string[], fails?: string[]}>} habits
 * @param {number} y Ano
 * @param {number} m Mês (0..11)
 * @param {number} [today] Dia atual inteiro UTC
 */
export function buildMonthlyReportMatrix(habits, y, m, today = todayN()) {
  const list = Array.isArray(habits) ? habits : [];
  const totalDays = dim(y, m);
  const startDay = mStart(y, m);
  const endDay = startDay + totalDays - 1;
  const evalEnd = Math.min(endDay, today);
  const evalDays = Math.max(0, evalEnd - startDay + 1);
  const denomDays = evalDays > 0 ? evalDays : totalDays;

  const dayHeaders = [];
  for (let i = 0; i < totalDays; i++) {
    const n = startDay + i;
    dayHeaders.push({
      dayNum: i + 1,
      n,
      wd: WD[dow(n)].slice(0, 1),
      isToday: n === today,
      isFuture: n > today,
    });
  }

  let totalDone = 0;
  let totalFails = 0;

  const rows = list.map((h) => {
    const set = new Set(Array.isArray(h.dates) ? h.dates : []);
    const fset = new Set(Array.isArray(h.fails) ? h.fails : []);
    let doneCount = 0;
    let failCount = 0;

    const cells = [];
    for (let i = 0; i < totalDays; i++) {
      const n = startDay + i;
      const k = keyOf(n);
      const on = set.has(k);
      const x = !on && fset.has(k);
      const pl = on && i > 0 && set.has(keyOf(n - 1));
      const nr = on && i < totalDays - 1 && set.has(keyOf(n + 1));
      const fut = n > today;

      if (on) doneCount++;
      if (x) failCount++;

      cells.push({
        dayNum: i + 1,
        n,
        k,
        on,
        pl,
        nr,
        x,
        fut,
        isToday: n === today,
      });
    }

    totalDone += doneCount;
    totalFails += failCount;
    const pct = denomDays > 0 ? Math.round((doneCount / denomDays) * 100) : 0;

    return {
      id: h.id || h.name,
      name: h.name,
      cells,
      doneCount,
      failCount,
      pct,
    };
  });

  const totalPossible = list.length * denomDays;
  const overallPct = totalPossible > 0 ? Math.round((totalDone / totalPossible) * 100) : 0;

  return {
    y,
    m,
    totalDays,
    startDay,
    endDay,
    evalEnd,
    evalDays,
    denomDays,
    dayHeaders,
    rows,
    totalDone,
    totalFails,
    overallPct,
  };
}

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
    const y = +$('ryear').value || V.y;
    head = ['Hábito', ...MONTHS_SHORT, 'Taxa'];
    const tot = Array(12).fill(0);
    let all = 0;
    let allF = 0;

    const visualAnnualRows = state.habits.map((h) => {
      const c = Array(12).fill(0);
      inR(h).forEach((d) => c[+d.slice(5, 7) - 1]++);
      c.forEach((v, i) => (tot[i] += v));
      const sum = c.reduce((a, b) => a + b, 0);
      const fx = inF(h).length;
      all += sum;
      allF += fx;
      const monthPcts = c.map((v, mIdx) => {
        const md = dim(y, mIdx);
        return Math.round((v / md) * 100);
      });
      const rateNum = days > 0 ? Math.round((sum / days) * 100) : 0;
      rows.push([h.name, ...monthPcts.map((p) => p + '%'), pct(sum, days)]);
      return { name: h.name, monthCounts: c, monthPcts, rateNum };
    });

    const overallAnnualPct =
      days * state.habits.length > 0
        ? Math.round((all / (days * state.habits.length)) * 100)
        : 0;
    rows.push([
      'Média Geral',
      ...tot.map((v, mIdx) =>
        state.habits.length ? Math.round((v / (dim(y, mIdx) * state.habits.length)) * 100) + '%' : '0%'
      ),
      overallAnnualPct + '%',
    ]);

    const sub = days
      ? `Período considerado: ${fmtD(s)} a ${fmtD(end)} · Gerado em ${new Date().toLocaleDateString('pt-BR')}`
      : 'Este período ainda não começou.';

    return {
      isYear: true,
      title,
      sub,
      head,
      rows,
      visualAnnualRows,
      overallPct: overallAnnualPct,
    };
  }

  const [y, m1] = ($('rmonth').value || `${V.y}-${V.m + 1}`).split('-').map(Number);
  const m = m1 - 1;
  const matrix = buildMonthlyReportMatrix(state.habits, y, m, t);

  head = ['Hábito', ...matrix.dayHeaders.map((d) => String(d.dayNum)), 'Taxa'];
  matrix.rows.forEach((r) => {
    rows.push([
      r.name,
      ...r.cells.map((c) => (c.on ? '✓' : c.x ? '✕' : '')),
      r.pct + '%',
    ]);
  });

  const sub = matrix.evalDays
    ? `Matriz mensal de hábitos · ${fmtD(s)} a ${fmtD(matrix.evalEnd)} · Gerado em ${new Date().toLocaleDateString('pt-BR')}`
    : `Matriz mensal de hábitos · ${fmtMonthYear(y, m)}`;

  return {
    isYear: false,
    title,
    sub,
    head,
    rows,
    matrix,
    overallPct: matrix.overallPct,
  };
}

function showReport() {
  const isYear = $('rtype').value === 'year';
  $('rmonth').style.display = isYear ? 'none' : '';
  $('ryear').style.display = isYear ? '' : 'none';
  reportData = buildReport();

  const headerHtml = `<div class="rpt-top-bar">
    <div>
      <h3 class="report-heading">${esc(reportData.title)}</h3>
      <p class="report-sub">${esc(reportData.sub)}</p>
    </div>
    <div class="rpt-meta-right">
      <div class="rpt-legend">
        <span><i class="leg-bar on"></i> Concluído</span>
        <span><i class="leg-bar x"></i> Falha (✕)</span>
      </div>
      <div class="rpt-overall-pill">
        <b>${reportData.overallPct}%</b> concluído
      </div>
    </div>
  </div>`;

  if (!state.habits.length) {
    $('rpt').innerHTML = `${headerHtml}<p class="muted-msg">Nenhum hábito cadastrado.</p>`;
    return;
  }

  if (!reportData.isYear) {
    const mx = reportData.matrix;
    const thDays = mx.dayHeaders
      .map(
        (d) =>
          `<th class="rpt-th-day ${d.isToday ? 'today' : ''} ${d.isFuture ? 'fut' : ''}">
            <small>${d.wd}</small>
            <span>${d.dayNum}</span>
          </th>`
      )
      .join('');

    const bodyRows = mx.rows
      .map((r) => {
        const dayCells = r.cells
          .map((c) => {
            const statusLabel = c.on
              ? 'Concluído ✓'
              : c.x
                ? 'Não feito ✕'
                : 'Em branco';
            return `<td class="rpt-d ${c.on ? 'on' : ''} ${c.pl ? 'pl' : ''} ${c.nr ? 'nr' : ''} ${c.x ? 'x' : ''} ${c.fut ? 'fut' : ''} ${c.isToday ? 'today' : ''}" title="${esc(r.name)} — ${fmtD(c.n)}: ${statusLabel}"><i></i></td>`;
          })
          .join('');
        return `<tr class="rpt-row">
          <td class="rpt-hname" title="${esc(r.name)}">${esc(r.name)}</td>
          ${dayCells}
          <td class="rpt-pct"><b>${r.pct}%</b></td>
        </tr>`;
      })
      .join('');

    $('rpt').innerHTML = `${headerHtml}
      <div class="rpt-matrix-wrap">
        <table class="rt rpt-matrix" id="rpt-matrix-table">
          <thead>
            <tr>
              <th class="rpt-th-name">Hábito</th>
              ${thDays}
              <th class="rpt-th-pct">Taxa</th>
            </tr>
          </thead>
          <tbody>
            ${bodyRows}
          </tbody>
        </table>
      </div>`;
    return;
  }

  // Visualização Anual com barras visuais mensais
  const thMonths = MONTHS_SHORT.map((m) => `<th class="rpt-th-month">${esc(m)}</th>`).join('');
  const annualBody = reportData.visualAnnualRows
    .map((r) => {
      const mCells = r.monthPcts
        .map(
          (p, idx) =>
            `<td class="rpt-mcell" title="${esc(r.name)} — ${MONTHS_SHORT[idx]}: ${p}%">
              <div class="rpt-mbar"><i style="width:${p}%"></i></div>
              <small>${p}%</small>
            </td>`
        )
        .join('');
      return `<tr class="rpt-row">
        <td class="rpt-hname" title="${esc(r.name)}">${esc(r.name)}</td>
        ${mCells}
        <td class="rpt-pct"><b>${r.rateNum}%</b></td>
      </tr>`;
    })
    .join('');

  $('rpt').innerHTML = `${headerHtml}
    <div class="rpt-matrix-wrap">
      <table class="rt rpt-annual" id="rpt-annual-table">
        <thead>
          <tr>
            <th class="rpt-th-name">Hábito</th>
            ${thMonths}
            <th class="rpt-th-pct">Taxa</th>
          </tr>
        </thead>
        <tbody>
          ${annualBody}
        </tbody>
      </table>
    </div>`;
}

/**
 * Inicializa os eventos do Modal de Relatórios (#rdlg).
 */
export function initReportsModal() {
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
