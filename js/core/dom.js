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
export const $ = (id) => document.getElementById(id);

/**
 * Escapa caracteres HTML especiais para prevenir XSS em templates.
 * @param {string} s
 * @returns {string}
 */
export const esc = (s) =>
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
export const uid = () =>
  crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2);

/**
 * Modal de confirmação interno ao app (substitui o window.confirm nativo, que trava o Electron).
 * @param {string} msg Mensagem da pergunta
 * @param {string} [label='Excluir'] Texto do botão de confirmação
 * @returns {Promise<boolean>}
 */
export function ask(msg, label = 'Excluir') {
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
export function initTheme() {
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

/** Tempo padrão (em ms) com o cursor sobre o elemento antes de exibir a descrição: 1,75s */
export const DEFAULT_TIP_DELAY = 1750;

/**
 * Inicializa o sistema de Tooltips customizados baseado na Popover API.
 */
export function initTooltips() {
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
        const delay = +el.dataset.tipDelay || DEFAULT_TIP_DELAY;
        tipTimer = setTimeout(() => {
          if (tipEl === el) showTip(el);
        }, delay);
      }
    } else {
      hideTip();
    }
  });

  document.addEventListener('mousedown', hideTip);
  document.addEventListener('scroll', hideTip, true);
  document.documentElement.addEventListener('mouseleave', hideTip);
}
