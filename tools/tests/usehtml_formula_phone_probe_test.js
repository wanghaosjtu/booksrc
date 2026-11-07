'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {build} = require('../usehtml_formula_phone_probe');

test('phone formula probe uses captured TeX, guarded incoming code and read-only local requests', () => {
  const capture = {status: 200, host: 'ieeexplore.ieee.org', body: '<tex-math>\\frac {d}{{d\\mathrm {snr} }}I</tex-math>'};
  const {key, markup} = build(capture);
  assert.equal(markup, capture.body);
  assert(!key.includes('{{') && !key.includes('<tex-math>'));
  const options = JSON.parse(key.slice(key.indexOf(',') + 1));
  assert(options.bodyJs.includes(markup.replaceAll('\\', '\\\\')));
  assert(options.bodyJs.includes("finally{_ltOptions=original;}"));
  assert(!/saveBook|setCookie|document\.cookie/.test(options.bodyJs));
  assert(options.bodyJs.includes('fullIeeePipeline:false,translationService:false'));
});

test('phone formula probe rejects unsuccessful captures and articles without the actual fragment', () => {
  assert.throws(() => build({status: 403, host: 'ieeexplore.ieee.org', body: ''}), /successful actual/);
  assert.throws(() => build({status: 200, host: 'ieeexplore.ieee.org', body: '<tex-math>x</tex-math>'}), /actual derivative/);
});
