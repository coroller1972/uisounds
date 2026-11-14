// Vérification minimale hors navigateur : le module se charge (CommonJS)
// et expose bien les sons attendus. Sans Web Audio, play() ne joue rien.
const assert = require('node:assert');
const UISounds = require('../uisounds.js');

const expected = [
  'tap', 'click', 'tick', 'toc', 'pat', 'pop', 'bloop',
  'blip', 'ding', 'woof', 'shh', 'whoosh', 'success', 'error'
];

assert.deepStrictEqual(UISounds.names, expected);
for (const name of expected) {
  assert.strictEqual(typeof UISounds[name], 'function', name);
}
assert.strictEqual(UISounds.play('tap'), 0);

UISounds.volume = 2;
assert.strictEqual(UISounds.volume, 1);
UISounds.muted = true;
assert.strictEqual(UISounds.muted, true);

UISounds.define('custom', (k) => k.tone({ freq: 440 }));
assert.ok(UISounds.names.includes('custom'));
assert.throws(() => UISounds.define('play', () => {}));

console.log('ok — ' + expected.length + ' sons');
