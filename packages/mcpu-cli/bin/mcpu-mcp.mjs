#!/usr/bin/env node
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const srcDir = join(__dirname, '../src');

if (existsSync(srcDir)) {
  import('../src/mcp-cli.ts');
} else {
  import('../dist/mcp-cli.js');
}
