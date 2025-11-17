#!/usr/bin/env node
import { build } from 'esbuild';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';

// Find all .ts entry points in src
function findEntryPoints(dir, base = 'src') {
  const entries = [];
  const items = readdirSync(dir);

  for (const item of items) {
    const fullPath = join(dir, item);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      entries.push(...findEntryPoints(fullPath, base));
    } else if (item.endsWith('.ts')) {
      entries.push(fullPath);
    }
  }

  return entries;
}

const entryPoints = findEntryPoints('src');

await build({
  entryPoints,
  outdir: 'dist',
  format: 'esm',
  platform: 'node',
  target: 'node18',
  outExtension: { '.js': '.js' },
  bundle: false,
  sourcemap: false,
  plugins: [{
    name: 'rewrite-ts-imports',
    setup(build) {
      build.onLoad({ filter: /\.ts$/ }, async (args) => {
        const fs = await import('fs/promises');
        let contents = await fs.readFile(args.path, 'utf8');
        // Rewrite .ts imports to .js
        contents = contents.replace(/from ['"](\.[^'"]+)\.ts['"]/g, "from '$1.js'");
        return { contents, loader: 'ts' };
      });
    },
  }],
});

console.log('Build complete!');
