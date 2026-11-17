const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const context = { AD: {} };
context.window = context;
vm.createContext(context);
vm.runInContext(
  fs.readFileSync(path.join(__dirname, '..', 'js', 'core', 'fuel-identity.js'), 'utf8'),
  context
);

const identity = context.AD.fuelIdentity;

test('BP PDF and future API forms create the same receipt identity', () => {
  const pdf = identity.bpId({ cardNumber: '7050 16938653 00114', date: '20/10/26', docket: '001395' });
  const api = identity.bpId({ cardNumber: '***************0114', date: '2026-10-20T09:30:00+11:00', receiptNumber: 1395 });
  assert.equal(pdf, api);
  assert.match(pdf, /^fuel-bp-v1-/);
});

test('separate receipts and cards cannot collapse into one BP transaction', () => {
  const base = { cardNumber: '7050 16938653 00114', date: '2026-10-20', docket: '001395' };
  assert.notEqual(identity.bpId(base), identity.bpId({ ...base, docket: '001396' }));
  assert.notEqual(identity.bpId(base), identity.bpId({ ...base, cardNumber: '7050 16938653 00122' }));
});

test('BP identity requires the fields shared with the future API', () => {
  assert.equal(identity.bpId({ cardNumber: '00114', date: '2026-10-20' }), '');
  assert.equal(identity.bpId({ docket: '001395', date: '2026-10-20' }), '');
});
