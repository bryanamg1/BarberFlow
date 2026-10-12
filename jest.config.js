/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/tests/ui/**/*.test.ts?(x)'],
  setupFilesAfterEnv: ['<rootDir>/src/test/setup.ts'],
  resetMocks: true,
  restoreMocks: true,
};
