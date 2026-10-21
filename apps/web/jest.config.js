/**
 * Component-level tests for the web app (server-side rendering with react-dom/server: no browser, no network, no
 * provider). Run with `npm test` in apps/web. The API workspace has its own Jest config for the backend.
 */
module.exports = {
  rootDir: 'src',
  testEnvironment: 'node',
  testRegex: '.*\.test\.tsx?$',
  setupFilesAfterEnv: ['<rootDir>/__tests__/setup.tsx'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/$1' },
  transform: {
    '^.+\.tsx?$': ['ts-jest', {
      diagnostics: false,
      isolatedModules: true,
      tsconfig: { jsx: 'react-jsx', module: 'commonjs', target: 'ES2021', esModuleInterop: true, moduleResolution: 'node', skipLibCheck: true },
    }],
  },
};
