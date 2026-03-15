module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    '^../../../shared/(.*)$': '<rootDir>/../../shared/$1',
    '^../../../../shared/(.*)$': '<rootDir>/../../shared/$1',
  },
  globals: {
    'ts-jest': {
      tsconfig: {
        rootDir: '../../',
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        types: ['node', 'jest'],
      },
    },
  },
  testTimeout: 30000,
};
