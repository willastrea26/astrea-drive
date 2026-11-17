const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function mapsFor(vehicles) {
  const context = {
    AD: {
      ui: { esc: (value) => String(value) },
      icons: {},
      store: { all: (name) => name === 'vehicles' ? vehicles : [] }
    }
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(path.join(__dirname, '..', 'js', 'views', 'cost-import.js'), 'utf8'),
    context,
    { filename: 'js/views/cost-import.js' }
  );
  return context.AD.importFuelData._regoMaps();
}

test('fuel imports prefer the owned XO29ZS record over its hired duplicate', () => {
  const maps = mapsFor([
    { id: 'H-XO29ZS', rego: 'XO29ZS', hired: true },
    { id: 'AHV01', rego: 'XO29ZS', hired: false }
  ]);
  assert.equal(maps.exact.get('XO29ZS').id, 'AHV01');
});

test('two owned records with the same registration remain safely ambiguous', () => {
  const maps = mapsFor([
    { id: 'ONE', rego: 'SAME01', hired: false },
    { id: 'TWO', rego: 'SAME01', hired: false }
  ]);
  assert.equal(maps.exact.get('SAME01'), null);
});
