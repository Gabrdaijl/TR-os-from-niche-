'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assetDirectories = ['baremux', 'cloud', 'cursors', 'dom', 'epoxy', 'scram', 'shared', 'stratus', 'wallpaper-api', 'worker'];
const assetExtensions = new Set(['.html', '.js', '.mjs', '.css', '.wasm', '.png', '.jpg', '.jpeg', '.webp', '.svg', '.wav', '.cur', '.ani', '.ico', '.woff', '.woff2', '.ttf']);

function build(root = path.resolve(__dirname, '..')) {
  root = path.resolve(root);
  const output = path.resolve(root, 'public');
  if (path.relative(root, output) !== 'public') throw new Error('Invalid public output path');
  // The checked target is always the generated public directory under this root.
  fs.rmSync(output, { recursive: true, force: true });
  fs.mkdirSync(output, { recursive: true });
  let count = 0;
  function copy(directory, destination, topLevel = false) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
      const source = path.join(directory, entry.name);
      const target = path.join(destination, entry.name);
      if (entry.isDirectory()) {
        if (topLevel && !assetDirectories.includes(entry.name)) continue;
        fs.mkdirSync(target, { recursive: true });
        copy(source, target);
      } else if (assetExtensions.has(path.extname(entry.name).toLowerCase())) {
        if (topLevel && entry.name === 'tr-os.config.js') continue;
        fs.copyFileSync(source, target);
        count++;
      }
    }
  }
  copy(root, output, true);
  return { output, count };
}
module.exports = { build };
if (require.main === module) console.log('TR-os public assets:', build().count);
