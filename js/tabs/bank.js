/**
 * @fileoverview Módulo da Aba 3: Banco de Horas e Tanque de Lazer.
 * Gerencia atividades/matérias de estudo, progresso em quadradinhos e saldo de créditos de lazer.
 */

import { $, ask, esc, uid } from '../core/dom.js';
import {
  balance,
  CAP,
  fH,
  fMin,
  MINS,
  persistRw,
  saveBank,
  state,
} from '../core/state.js';
import {
  deleteBankItemRemote,
  pushRw,
  quiet,
  saveBankItemRemote,
  toggleBankSquareRemote,
} from '../core/supabase.js';

let editingBankItem = null;

/**
 * Atualiza a visualização do Tanque de Lazer flutuante (#tank).
 */
export function drawTank() {
  const b = balance();
  const neg = b < 0;
  $('lq').style.height = Math.min(100, (Math.abs(b) / CAP) * 100) + '%';
  document.querySelector('.tk').classList.toggle('neg', neg);
  $('tkc').textContent = (Math.round(b * 100) / 100).toLocaleString('pt-BR', {
    maximumFractionDigits: 2,
  });
  $('tkc').classList.toggle('neg', neg);
  const mn = Math.round(Math.abs(b) * MINS);
  $('tkcw').dataset.tip = neg
    ? `Faltam ${fMin(mn)} para o tanque ficar verde`
    : `Lazer disponível: ${fMin(mn)}`;
}

function saveRw() {
  state.rw.at = Date.now();
  persistRw();
  quiet(pushRw);
}

function triggerTankBump(before) {
  if (balance() > before) {
    const k = $('tank');
    k.classList.remove('bump');
    void k.offsetWidth;
    k.classList.add('bump');
  }
}

/**
 * Soma ou subtrai minutos de lazer provenientes de hábitos concluídos.
 * @param {number} min
 */
export function addLeisure(min) {
  const before = balance();
  state.rw.habitMin = (state.rw.habitMin || 0) + min;
  saveRw();
  triggerTankBump(before);
}

/**
 * Soma ou subtrai horas de estudo provenientes dos quadradinhos do Banco de Horas.
 * @param {number} delta
 */
export function addHours(delta) {
  const before = balance();
  state.rw.hours = Math.max(0, Math.round((state.rw.hours + delta) * 100) / 100);
  saveRw();
  triggerTankBump(before);
}

/**
 * Avança o estado de um quadradinho na matriz do Banco de Horas (ciclo de double-check):
 *  - 1º clique (vazio -> 'half'): deixa o quadrado levemente verde com borda verde escura (apenas visual, 0 crédito).
 *  - 2º clique ('half' -> 'done'): confirma o check e contabiliza os créditos no Tanque de Lazer.
 *  - 3º clique ('done' -> 'empty'): desmarca o quadrado e estorna os créditos.
 * @param {{hours: number, done: number[], half?: number[]}} item
 * @param {number} idx
 * @returns {{state: 'half'|'done'|'empty', hoursDelta: number, remoteConfirmed: boolean|null}}
 */
export function advanceBankSquareState(item, idx) {
  item.done = Array.isArray(item.done) ? item.done : [];
  item.half = Array.isArray(item.half) ? item.half : [];

  const isDone = item.done.includes(idx);
  const isHalf = !isDone && item.half.includes(idx);

  if (!isDone && !isHalf) {
    item.half = [...item.half, idx];
    return { state: 'half', hoursDelta: 0, remoteConfirmed: null };
  }

  if (isHalf) {
    item.half = item.half.filter((x) => x !== idx);
    item.done = [...item.done, idx];
    return { state: 'done', hoursDelta: item.hours, remoteConfirmed: true };
  }

  item.done = item.done.filter((x) => x !== idx);
  item.half = item.half.filter((x) => x !== idx);
  return { state: 'empty', hoursDelta: -item.hours, remoteConfirmed: false };
}

/**
 * Renderiza a aba Banco de Horas (#bank).
 */
export function drawBank() {
  const keep = $('bank').scrollTop;
  const rows = state.bank
    .map((b) => {
      const doneSet = new Set(b.done || []);
      const halfSet = new Set(b.half || []);
      const squares = Array.from({ length: b.size }, (_, i) => {
        const cls = doneSet.has(i) ? 'on' : halfSet.has(i) ? 'half' : '';
        return `<button type="button" class="sq ${cls}" data-b="${b.id}" data-i="${i}"></button>`;
      }).join('');
      return `<div class="br">
        <div class="bn">
          <span>${esc(b.name)}</span>
          <div class="bt">
            <button type="button" data-bedit="${b.id}" title="Editar">✎</button>
            <button type="button" data-bdel="${b.id}" title="Excluir">✕</button>
          </div>
        </div>
        <div class="bsq">${squares}</div>
        <div class="bg"><b>${b.done.length}/${b.size}</b></div>
      </div>`;
    })
    .join('');

  $('bank').innerHTML = `<div class="dp">
    <div class="section-header">
      <h2 class="bh">Banco de horas</h2>
      <button type="button" class="add" id="bnew">+ Nova atividade</button>
    </div>
    <div class="bank-list">
      ${rows || '<p class="muted-msg">Nenhuma atividade ainda. Clique em “+ Nova atividade”.</p>'}
    </div>
  </div>`;

  $('bnew').onclick = () => openBankModal();
  $('bank').scrollTop = keep;
}

function updateBankSummary() {
  const n = +$('bsize').value || 0;
  const h = +$('bhours').value || 0;
  $('bsum').textContent = `Total: ${n} × ${fH(h)} = ${fH(n * h)}`;
}

function clearBankErrors() {
  $('berr').textContent = '';
  ['bname', 'bsize', 'bhours'].forEach((id) => $(id).classList.remove('bad'));
}

function openBankModal(id) {
  editingBankItem = id ? state.bank.find((b) => b.id === id) : null;
  $('btitle').textContent = editingBankItem ? 'Editar atividade' : 'Nova atividade';
  $('bname').value = editingBankItem ? editingBankItem.name : '';
  $('bsize').value = editingBankItem ? editingBankItem.size : 10;
  $('bhours').value = editingBankItem ? editingBankItem.hours : 1;
  $('bdel').style.display = editingBankItem ? '' : 'none';
  updateBankSummary();
  clearBankErrors();
  $('bdlg').showModal();
  $('bname').focus();
}

async function saveBankForm() {
  const name = $('bname').value.trim();
  const size = Math.floor(+$('bsize').value);
  const hours = +$('bhours').value;

  const bad = (id, msg) => {
    $('berr').textContent = msg;
    $(id).classList.add('bad');
    $(id).focus();
  };

  if (!name) return bad('bname', 'Dê um nome à atividade.');
  if (!(size >= 1 && size <= 200)) return bad('bsize', 'Use de 1 a 200 quadradinhos.');
  if (!(hours > 0)) return bad('bhours', 'As horas por quadradinho precisam ser maiores que 0.');

  let b = editingBankItem;
  let shrink = false;

  if (b) {
    const lost = b.done.filter((i) => i >= size);
    if (
      lost.length &&
      !(await ask(
        `Reduzir para ${size} quadradinhos apaga ${lost.length} já concluído(s). Continuar?`,
        'Continuar'
      ))
    ) {
      return;
    }
    shrink = size < b.size;
    const oldHoursEarned = b.done.length * b.hours;
    const keptDone = b.done.filter((i) => i < size);
    const keptHalf = (b.half || []).filter((i) => i < size);
    const newHoursEarned = keptDone.length * hours;
    const deltaHours = newHoursEarned - oldHoursEarned;

    Object.assign(b, { name, size, hours, done: keptDone, half: keptHalf });
    if (deltaHours !== 0) addHours(deltaHours);
  } else {
    b = { id: uid(), name, size, hours, done: [], half: [] };
    state.bank.push(b);
  }

  saveBank();
  $('bdlg').close();
  drawBank();
  saveBankItemRemote(b.id, shrink, size);
}

function consumeLeisure() {
  const v = parseFloat($('lzv').value);
  if (!isFinite(v) || v <= 0) {
    $('lzv').value = '';
    return;
  }
  const m = Math.round($('lzu').value === 'h' ? v * 60 : v);
  if (m <= 0) return;
  state.rw.spentMin += m;
  saveRw();
  $('lzv').value = '';
}

/**
 * Inicializa os eventos da Aba Banco de Horas e do Tanque de Lazer.
 */
export function initBankTab() {
  $('bank').addEventListener('click', (e) => {
    const q = e.target.closest('.sq');
    if (q) {
      const b = state.bank.find((x) => x.id === q.dataset.b);
      if (!b) return;
      const i = +q.dataset.i;
      const transition = advanceBankSquareState(b, i);
      saveBank();
      if (transition.hoursDelta !== 0) {
        addHours(transition.hoursDelta);
      }
      drawBank();
      if (transition.remoteConfirmed !== null) {
        toggleBankSquareRemote(b.id, i, !transition.remoteConfirmed);
      }
      return;
    }

    const ed = e.target.closest('[data-bedit]');
    const dl = e.target.closest('[data-bdel]');
    if (ed) openBankModal(ed.dataset.bedit);
    if (dl) {
      const b = state.bank.find((x) => x.id === dl.dataset.bdel);
      if (!b) return;
      ask(`Excluir "${b.name}" e todo o progresso?`).then((ok) => {
        if (!ok) return;
        state.bank = state.bank.filter((x) => x !== b);
        saveBank();
        drawBank();
        deleteBankItemRemote(b.id);
      });
    }
  });

  $('bok').onclick = saveBankForm;
  $('bcancel').onclick = () => $('bdlg').close();
  ['bsize', 'bhours'].forEach((id) => {
    $(id).oninput = () => {
      updateBankSummary();
      clearBankErrors();
    };
  });
  $('bname').oninput = clearBankErrors;
  $('bname').onkeydown = (e) => {
    if (e.key === 'Enter') saveBankForm();
  };
  $('bdel').onclick = () => {
    const b = editingBankItem;
    if (!b) return;
    ask(`Excluir "${b.name}" e todo o progresso?`).then((ok) => {
      if (!ok) return;
      state.bank = state.bank.filter((x) => x !== b);
      saveBank();
      $('bdlg').close();
      drawBank();
      deleteBankItemRemote(b.id);
    });
  };

  $('lzb').onclick = consumeLeisure;
  $('lzv').onkeydown = (e) => {
    if (['-', '+', 'e', 'E'].includes(e.key)) e.preventDefault();
    if (e.key === 'Enter') consumeLeisure();
  };

  drawTank();
}
