const assert = require('node:assert/strict');
const { test } = require('node:test');
const { load } = require('./helpers/agenda.cjs');
const { formatMoney } = load('../../utils/formatMoney');
for (const [value, currency, expected] of [
  ['-0.50', 'ARS', '-ARS 0,50'],
  ['0.50', 'ARS', 'ARS 0,50'],
  ['-1.01', 'USD', '-USD 1,01'],
  ['900719925474099312345.29', 'USD', 'USD 900.719.925.474.099.312.345,29'],
  ['-900719925474099312345.29', 'USD', '-USD 900.719.925.474.099.312.345,29'],
  ['0.00', 'ARS', 'ARS 0,00'],
])
  test(`BF251 exact canonical money ${value} ${currency}`, () =>
    assert.equal(formatMoney(value, currency), expected));
