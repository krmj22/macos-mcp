/** @type {import('jest').Config} */
export default {
  preset: 'ts-jest/presets/default-esm',
  extensionsToTreatAsEsm: ['.ts'],
  testEnvironment: './jest-env.cjs',
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: {
          module: 'ES2022',
          target: 'ES2020',
          moduleResolution: 'Node',
          allowSyntheticDefaultImports: true,
          esModuleInterop: true,
          isolatedModules: true,
          types: ['jest', 'node'],
        },
        diagnostics: {
          ignoreCodes: ['TS151001'],
        },
      },
    ],
    '^.+\\.m?js$': 'babel-jest',
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^import-meta$': '<rootDir>/src/__mocks__/importMeta.js',
    '^jose$': '<rootDir>/src/__mocks__/jose.ts',
  },
  transformIgnorePatterns: ['node_modules/(?!(jose|supertest)/)'],
  testMatch: ['<rootDir>/src/**/*.test.ts', '<rootDir>/src/**/*.spec.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '<rootDir>/dist/'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.test.ts',
    '!src/**/*.spec.ts',
    '!src/**/*.d.ts',
    '!src/**/__mocks__/**',
    '!src/**/__fixtures__/**',
    '!src/utils/projectUtils.ts', // Excluded: import.meta.url line cannot be tested in Jest
    '!src/server/transports/http/index.ts', // Excluded: HTTP transport integration tested via E2E
    '!src/index.ts', // Excluded: entry point with process signals + transport bootstrap (integration-only)
  ],
  coveragePathIgnorePatterns: ['/node_modules/', '/dist/'],
  // Ignore import.meta.url line in projectUtils.ts
  coverageReporters: ['text', 'text-summary', 'html'],
  coverageThreshold: {
    global: {
      // Right-sized to actual floor + ~1% buffer (2026-02-11)
      // Actual: 95.96% stmts, 80.97% branches, 93.63% funcs, 96.35% lines
      statements: 95,
      branches: 80,
      functions: 93,
      lines: 95,
    },
  },
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
};
