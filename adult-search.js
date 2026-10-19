(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TR_OS_ADULT_SEARCH = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const terms = [
    'sex', 'sexual', 'sexually', 'sexology', 'sexting', 'sexwork', 'sexworker',
    'sexchat', 'sexvideo', 'sextoy', 'porn', 'pornography', 'pornographic',
    'pornhub', 'xxx', 'nsfw', 'nude', 'nudes', 'naked', 'hentai', 'erotic',
    'erotica', 'onlyfans', 'adultvideo', 'camgirl', 'camsex', 'blowjob',
    'handjob', 'dildo', 'fetish', 'bdsm', 'xvideos'
  ];
  const patterns = terms.map(term => new RegExp('(^|[^a-z0-9])' +
    term.split('').join('[^a-z0-9]*') + '(?=$|[^a-z0-9])', 'i'));
  function normalize(value) {
    let text = String(value == null ? '' : value);
    try { text = text.normalize('NFKC'); } catch {}
    text = text.toLowerCase().replace(/[\u200b-\u200f\u2060\ufeff]/g, '');
    try { text = text.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch {}
    return text.replace(/[013457@$]/g, char => ({ '0':'o', '1':'i', '3':'e', '4':'a', '5':'s', '7':'t', '@':'a', '$':'s' })[char]);
  }
  function detects(value) {
    const query = normalize(value);
    return !!query && patterns.some(pattern => pattern.test(query));
  }
  return Object.freeze({ detects });
});
