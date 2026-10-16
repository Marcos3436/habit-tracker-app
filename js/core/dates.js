/**
 * @fileoverview Motor de manipulação de datas em dias inteiros UTC desde 1970-01-01.
 * Evita bugs de fuso horário (horário de verão / meia-noite local vs UTC).
 */

export const DAY = 864e5;
export const WD = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];
export const MONTHS_SHORT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
export const MONTHS_INITIAL = 'JFMAMJJASOND';

/**
 * Converte um objeto Date para o número inteiro de dias desde 01/01/1970 (UTC).
 * @param {Date} d
 * @returns {number}
 */
export const nOf = (d) => Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY);

/**
 * Converte o índice inteiro do dia (n) para string ISO 'YYYY-MM-DD'.
 * @param {number} n
 * @returns {string}
 */
export const keyOf = (n) => new Date(n * DAY).toISOString().slice(0, 10);

/**
 * Converte uma string 'YYYY-MM-DD' de volta para o índice inteiro do dia (n).
 * @param {string} k
 * @returns {number}
 */
export const parseKey = (k) => Math.floor(Date.parse(k) / DAY);

/**
 * Retorna o índice inteiro do dia de hoje.
 * @returns {number}
 */
export const todayN = () => nOf(new Date());

/**
 * Retorna o dia da semana (0 = Domingo ... 6 = Sábado) para um dia n.
 * @param {number} n
 * @returns {number}
 */
export const dow = (n) => (n + 4) % 7;

/**
 * Retorna o índice inteiro do primeiro dia do mês (m: 0..11) do ano y.
 * @param {number} y
 * @param {number} m
 * @returns {number}
 */
export const mStart = (y, m) => Math.floor(Date.UTC(y, m, 1) / DAY);

/**
 * Retorna a quantidade de dias no mês (m: 0..11) do ano y.
 * @param {number} y
 * @param {number} m
 * @returns {number}
 */
export const dim = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

/**
 * Retorna a quantidade de semanas (linhas no calendário) de um mês.
 * @param {number} y
 * @param {number} m
 * @returns {number}
 */
export const nWeeks = (y, m) => Math.ceil((dow(mStart(y, m)) + dim(y, m)) / 7);

/**
 * Formata o índice inteiro do dia (n) como 'DD/MM/AAAA'.
 * @param {number} n
 * @returns {string}
 */
export const fmtD = (n) => keyOf(n).split('-').reverse().join('/');

/**
 * Formata mês e ano por extenso em português (ex.: "outubro de 2026").
 * @param {number} y
 * @param {number} m
 * @returns {string}
 */
export const fmtMonthYear = (y, m) =>
  new Date(Date.UTC(y, m, 1)).toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
