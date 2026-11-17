const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const context = { AD: {} };
context.window = context;
vm.createContext(context);
for (const file of ['js/core/fuel-identity.js', 'js/core/bp-pdf.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, { filename: file });
}

const parser = context.AD.bpPdf;

test('BP PDF rows are grouped by receipt and card fees are excluded', () => {
  const pages = [[
    'Customer Number: 2116938653 ASTREA PTY LTD Reference: XS34KN',
    'Card Number: 7050 16938653 00114',
    'Vehicle: XS34KN SCANIA P320 Driver:',
    '20/10/26 121395 HORSLEY PARK AU AdBlue 25.13 0 0 50.24 5.02 55.26',
    '20/10/26 121395 HORSLEY PARK AU BP Ultimate Diesel 53.02 0 0 134.43 13.44 147.87',
    '26/10/26 010721 HORSLEY PARK AU BP Ultimate Diesel 122.14 0 0 311.90 31.19 343.09',
    'Card Fees 2.68 0.27 2.95'
  ]];
  const result = parser.parsePages(pages, [{ id: 'AVT06', rego: 'XS34KN' }]);
  assert.equal(result.meta.lineItems, 3);
  assert.equal(result.meta.transactions, 2);
  assert.equal(result.meta.feeRows, 1);
  assert.equal(result.meta.feeTotal, 2.95);
  assert.deepEqual(Array.from(result.rows[0]), [
    'XS34KN', '2026-10-20', '121395', '70501693865300114', 'HORSLEY PARK',
    'AdBlue + BP Ultimate Diesel', 78.15, 203.13, 'BP'
  ]);
});

test('spaced BP registrations match the canonical fleet registration', () => {
  const result = parser.parsePages([[
    'Customer Number: 2116938653 ASTREA PTY LTD Reference:',
    'Card Number: 7050 16938653 00106',
    'Vehicle: XP5 8JN VOLVO Driver:',
    '18/10/26 000851 BRENDALE AU BP Ultimate Diesel 232.65 0 0 617.37 61.74 679.11'
  ]], [{ id: 'AVT05', rego: 'XP58JN' }]);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0][0], 'XP58JN');
});
