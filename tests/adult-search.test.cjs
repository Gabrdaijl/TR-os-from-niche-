'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { detects } = require('../adult-search.js');

test('adult searches are recognized despite spacing, punctuation, and common leetspeak', () => {
  for (const query of ['porn', 'best porn sites', 'sex', 'sexual content', 'only fans', 'n.u.d.e photos', 'p0rn', 's e x']) {
    assert.equal(detects(query), true, query);
  }
});

test('ordinary words containing similar letters do not trigger a ban', () => {
  for (const query of ['Sussex county', 'sextant', 'asexual reproduction', 'sexagesimal', 'weather in Essex']) {
    assert.equal(detects(query), false, query);
  }
});
