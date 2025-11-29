#!/usr/bin/env node

import { executeStat } from '../dist/commands/stat.js';

const args = process.argv.slice(2);
const servers = args.filter(a => !a.startsWith('--'));
const noCache = args.includes('--no-cache');
const verbose = args.includes('--verbose');

executeStat({
  servers: servers.length > 0 ? servers : undefined,
  noCache,
  verbose,
}).catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
