/**
 * @fileoverview Bootstrapper principal da aplicação.
 * Conecta o roteamento de abas (Hábitos, Dashboard, Banco de Horas, Relógio),
 * inicializa os módulos independentes, executa a suíte de testes de saúde e dispara a sincronização.
 */

import { $, initTheme, initTooltips } from './core/dom.js';
import { runHealthCheck } from './core/health.js';
import { state, subscribeUI } from './core/state.js';
import { initSupabaseModal, sync } from './core/supabase.js';
import { drawBank, drawTank, initBankTab } from './tabs/bank.js';
import { drawClock, initClockTab } from './tabs/clock.js';
import { drawDash } from './tabs/dashboard.js';
import { goToday, initHabitsTab, renderHabits } from './tabs/habits.js';
import { initReportsModal } from './tabs/reports.js';

/**
 * Alterna a aba ativa do aplicativo.
 * @param {'habits'|'dash'|'bank'|'clock'} view
 */
export function setView(view) {
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
