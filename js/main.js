/**
 * @fileoverview Bootstrapper principal da aplicação.
 * Conecta o roteamento de abas (Hábitos, Dashboard, Banco de Horas),
 * inicializa os módulos independentes e dispara a sincronização inicial.
 */

import { $, initTheme, initTooltips } from './core/dom.js';
import { state, subscribeUI } from './core/state.js';
import { initSupabaseModal, sync } from './core/supabase.js';
import { drawBank, drawTank, initBankTab } from './tabs/bank.js';
import { drawDash } from './tabs/dashboard.js';
import { goToday, initHabitsTab, renderHabits } from './tabs/habits.js';
import { initReportsModal } from './tabs/reports.js';

/**
 * Alterna a aba ativa do aplicativo.
 * @param {'habits'|'dash'|'bank'} view
 */
export function setView(view) {
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
