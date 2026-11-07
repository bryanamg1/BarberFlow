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
  ['-0.00', 'ARS', '-ARS 0,00'],
  ['15.01', 'ARS', 'ARS 15,01'],
  ['1000.00', 'ARS', 'ARS 1.000,00'],
  ['1000000.99', 'ARS', 'ARS 1.000.000,99'],
  ['-0.01', 'ARS', '-ARS 0,01'],
  ['-1.00', 'ARS', '-ARS 1,00'],
  ['-1234.56', 'ARS', '-ARS 1.234,56'],
  ['9007199254740991.99', 'ARS', 'ARS 9.007.199.254.740.991,99'],
  ['9007199254740992.99', 'ARS', 'ARS 9.007.199.254.740.992,99'],
  ['9999999999999999.99', 'ARS', 'ARS 9.999.999.999.999.999,99'],
  ['00015.01', 'ARS', 'ARS 15,01'],
])
  test(`BF251 exact canonical money ${value} ${currency}`, () =>
    assert.equal(formatMoney(value, currency), expected));

test('BF306 rejects ambiguous decimal strings and invalid currency codes', () => {
  for (const value of [
    '',
    '.',
    '15',
    '15.',
    '.01',
    'abc',
    'NaN',
    'Infinity',
    '15.1',
    '15.001',
    '15,01',
    '1e2.00',
    '+15.01',
    ' 15.01',
    '15.01\n',
  ])
    assert.equal(formatMoney(value, 'ARS'), 'Importe no disponible', JSON.stringify(value));
  assert.equal(formatMoney('15.01', 'INVALID'), 'Importe no disponible');
});

test('BF306 keeps exact cents with the Android number-only Intl capability', ({ mock }) => {
  const original = Intl.NumberFormat.prototype.formatToParts;
  mock.method(Intl.NumberFormat.prototype, 'formatToParts', function (value) {
    if (typeof value !== 'number') throw new TypeError('Cannot convert BigInt to number');
    return original.call(this, value);
  });

  assert.equal(formatMoney('15.01', 'ARS'), 'ARS 15,01');
  assert.equal(formatMoney('9007199254740992.99', 'ARS'), 'ARS 9.007.199.254.740.992,99');
});
