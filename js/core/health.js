/**
 * @fileoverview Suíte Pré-definida de Testes de Qualidade e Saúde do Programa (Self-Diagnostic Suite).
 * Executa automaticamente na inicialização do aplicativo (e via terminal) para validar
 * datas, segurança XSS, cálculo de ofensivas, regras de créditos, sessões de foco e integridade do DOM.
 */

import { dim, dow, fmtD, keyOf, nWeeks, parseKey } from './dates.js';
import { $, esc } from './dom.js';
import { HABCREDIT, HABMIN, MINS, PER, state, stats } from './state.js';
import {
  buildSessionPlan,
  calcDailyFocusStats,
  calcFocusIntervals,
  formatCountdown,
  formatGoalDisplay,
} from '../tabs/clock.js';

/**
 * Executa todos os testes de saúde e qualidade do sistema.
 * @param {{checkDOM?: boolean, silent?: boolean}} [options]
 * @returns {{passed: number, failed: number, total: number, results: Array<{name: string, ok: boolean, error?: string}>}}
 */
export function runHealthCheck(options = {}) {
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

  // 2. Segurança XSS
  test('Segurança: escape de caracteres HTML (XSS)', () => {
    const dirty = `<script>alert("x"&'y')</script>`;
    const clean = esc(dirty);
    assert(!clean.includes('<') && !clean.includes('>'), 'Tags HTML devem ser escapadas');
    assert(clean.includes('&lt;script&gt;'), 'Deve conter entidades escapadas');
  });

  // 3. Regras do Tanque de Lazer (0,5 crédito por hábito = 10 min)
  test('Tanque de Lazer: constantes de conversão de créditos', () => {
    assert(MINS === 20, '1 crédito deve equivaler a 20 minutos');
    assert(PER === 0.5, 'Cada 0,5h de estudo deve gerar 1 crédito');
    assert(HABCREDIT === 0.5, 'Cada hábito concluído deve valer 0,5 crédito');
    assert(HABMIN === 10, 'Cada hábito concluído deve somar 10 minutos de lazer');
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

  // 5. Relógio de Foco: Cálculo de Intervalos e Plano de Sessão
  test('Relógio de Foco: cálculo de intervalos e plano de 180 min', () => {
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
  });

  // 6. Relógio de Foco: Andamento Diário, Sequência e Formatação
  test('Relógio de Foco: andamento diário, meta e sequência de dias', () => {
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
    assert(st.progressPct === Math.round((53 / 240) * 100), 'Percentual da meta incorreto');

    const disp = formatGoalDisplay(240);
    assert(disp.value === '4' && disp.unit === 'horas', '240 min deve exibir 4 horas');
    assert(formatCountdown(1500) === '25:00', '1500s deve formatar como 25:00');
    assert(formatCountdown(3661) === '01:01:01', '3661s deve formatar como 01:01:01');
  });

  // 7. Integridade do Estado e DOM (quando no navegador)
  if (checkDOM) {
    test('Integridade do DOM e Estado da Aplicação', () => {
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
        'dlg',
        'ddlg',
        'fdlg',
        'bdlg',
        'rdlg',
        'sdlg',
        'qdlg',
        'gdlg',
        'cdlg',
      ];
      for (const id of requiredIds) {
        assert($(id) !== null, `Elemento obrigatório #${id} ausente no DOM`);
      }
      assert(Array.isArray(state.habits), 'state.habits deve ser um Array');
      assert(Array.isArray(state.bank), 'state.bank deve ser um Array');
      assert(state.focus && typeof state.focus === 'object', 'state.focus deve existir');
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
