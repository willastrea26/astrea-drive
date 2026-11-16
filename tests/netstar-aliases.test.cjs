const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const context = { AD: {} };
context.window = context;
vm.createContext(context);
vm.runInContext(
  fs.readFileSync(path.join(__dirname, '..', 'js', 'core', 'netstar-aliases.js'), 'utf8'),
  context
);

const aliases = context.AD.netstarAliases;

test('maps AVT05 and AVT06 plates to their Netstar device IDs', () => {
  assert.equal(aliases.aliasForVehicle({ id: 'AVT05', rego: 'XP58JN' }), '00D2087143');
  assert.equal(aliases.aliasForVehicle({ id: 'AVT06', rego: 'xs34kn' }), '00D208715E');
});

test('maps the device IDs back to the correct fleet plates', () => {
  assert.equal(aliases.fleetRegoForDevice('00d2087143'), 'XP58JN');
  assert.equal(aliases.fleetRegoForDevice('00D208715E'), 'XS34KN');
});

test('does not change AVT04 or unrelated registrations', () => {
  assert.equal(aliases.aliasForVehicle({ id: 'AVT04', rego: 'XP27DS' }), '');
  assert.equal(aliases.fleetRegoForDevice('XP27DS'), 'XP27DS');
});

test('a saved database alias takes priority over the built-in fallback', () => {
  assert.equal(
    aliases.aliasForVehicle({ rego: 'XP58JN', netstarRego: 'CUSTOM-ALIAS' }),
    'CUSTOM-ALIAS'
  );
});
