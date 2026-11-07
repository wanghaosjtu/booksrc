'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '../..');
const fixture = fs.readFileSync(path.join(root, 'booksource/fixtures/usehtml-validation.html'), 'utf8');

for (const file of ['prepare_usehtml_inline_fixture.js', 'refresh_usehtml_inline_fixture.js']) {
  test(file + ': embedded HTML and nested TOC options remain exact', () => {
    const source = fs.readFileSync(path.join(root, 'tools', file), 'utf8');
    const line = source.match(/^const safeJs = .*$/m);
    assert(line, 'expected protected JS-string encoder');
    const safeJs = vm.runInNewContext(line[0] + '\nsafeJs');
    const values = [fixture, '', null, {
      html: '<h1>heading</h1> &lt;h1&gt; &amp; &#10; \"quoted\" 😀',
      url: 'https://example.test/a?first=1&second=2',
      pre: 'first\n  second',
      nested: ['&nbsp;', '\\u003c', '<literal>']
    }];
    for (const value of values) {
      const encoded = JSON.parse(JSON.stringify({bodyJs: safeJs(value)})).bodyJs;
      assert(!/[&<>]/.test(encoded), 'URL entity unescaping must have nothing to decode');
      const restored = vm.runInNewContext('(' + encoded + ')');
      assert.equal(JSON.stringify(restored), JSON.stringify(value));
    }

    const fixtureUrl = 'https://example.test/article,' + JSON.stringify({bodyJs: safeJs(fixture)});
    const toc = {results: [{hits: [{document: {path: fixtureUrl}}]}]};
    const bodyJs = 'JSON.stringify(' + safeJs(toc) + ')';
    assert(!/[&<>]/.test(bodyJs));
    const restoredToc = JSON.parse(vm.runInNewContext(bodyJs));
    assert.deepEqual(restoredToc, toc);
    const restoredUrl = restoredToc.results[0].hits[0].document.path;
    const options = JSON.parse(restoredUrl.slice(restoredUrl.indexOf(',') + 1));
    assert.equal(vm.runInNewContext(options.bodyJs), fixture);
  });
}
