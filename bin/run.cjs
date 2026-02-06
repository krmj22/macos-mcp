#!/usr/bin/env node

const path = require('node:path');
const fs = require('node:fs');

const entryPoint = path.resolve(__dirname, '..', 'dist', 'index.js');

if (!fs.existsSync(entryPoint)) {
  process.stderr.write(
    'Error: dist/index.js not found. Run `pnpm build` before starting the server.\n',
  );
  process.exit(1);
}

import(entryPoint);
