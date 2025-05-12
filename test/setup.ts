import 'aws-sdk-client-mock-jest';

// Set default timeout for tests
jest.setTimeout(10000);

// Mock console methods to reduce noise in test output
global.console.log = jest.fn();
global.console.info = jest.fn();
global.console.warn = jest.fn();
global.console.error = jest.fn();

// Restore console methods after tests
afterAll(() => {
  (global.console.log as jest.Mock).mockRestore();
  (global.console.info as jest.Mock).mockRestore();
  (global.console.warn as jest.Mock).mockRestore();
  (global.console.error as jest.Mock).mockRestore();
});

// Global test setup file for Jest
// This ensures AWS SDK doesn't try to use real credentials in tests

// Mock AWS credentials for SDK v3
process.env.AWS_ACCESS_KEY_ID = 'test-access-key';
process.env.AWS_SECRET_ACCESS_KEY = 'test-secret-key';
process.env.AWS_REGION = 'us-east-1';

// Set test-specific environment variables
process.env.BEDROCK_EMBEDDING_MODEL = 'amazon.titan-embed-text-v1';
process.env.TRANSLATION_STATE_MACHINE_ARN = 'arn:aws:states:us-east-1:123456789012:stateMachine:test';
process.env.OPENSEARCH_COLLECTION_ENDPOINT = 'https://test.us-east-1.aoss.amazonaws.com';
process.env.SENDER_EMAIL = 'test@example.com';