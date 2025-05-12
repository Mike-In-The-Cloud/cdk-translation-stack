module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest'
  },
  collectCoverage: true,
  coverageReporters: ['text', 'lcov'],
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'lib/**/*.ts',
    'lambda/functions/**/*.ts',
    '!**/node_modules/**',
    '!**/cdk.out/**'
  ],
  setupFilesAfterEnv: ['<rootDir>/test/setup.ts']
};
