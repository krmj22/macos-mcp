#!/usr/bin/env node

/**
 * Development entry point — runs src/index.ts directly via tsx.
 * Use for local stdio-only development; HTTP transport requires a compiled build.
 */

const { register } = require('tsx/cjs/api');
register();
require('../src/index.ts');
