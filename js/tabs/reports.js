/**
 * @fileoverview Módulo de Relatórios (Mensal e Anual) com exportação CSV (UTF-8 BOM para Excel)
 * e visualização formatada para Impressão / PDF.
 */

import {
  DAY,
  dim,
  fmtD,
  fmtMonthYear,
  keyOf,
  MONTHS_SHORT,
  mStart,
  parseKey,
  todayN,
} from '../core/dates.js';
import { $, esc } from '../core/dom.js';
import { state } from '../core/state.js';

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
