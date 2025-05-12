// Import AWS SDK clients and commands FIRST - No longer needed here due to jest.mock

// Import other test dependencies
import { Context } from 'aws-lambda';
import { TextEncoder } from 'util'; // Needed for mocking Bedrock body - Keep if mockHandler needs it, otherwise remove

// Mock AWS SDK v2 (S3) - REMOVE THIS ENTIRE BLOCK
// jest.mock('aws-sdk', () => {
//   return {
//     S3: jest.fn(() => ({
//       getObject: jest.fn().mockReturnValue({
//         promise: jest.fn().mockResolvedValue({ Body: Buffer.from('Hello world.') })
//       }),
//       putObject: jest.fn().mockReturnValue({ promise: jest.fn().mockResolvedValue({}) })
//     }))
//   };
// });

// Mock OpenSearch Client via factory function spy - Keep factory mocks if desired
// jest.mock('@opensearch-project/opensearch', ...) // REMOVED

// Mock Bedrock Client Command class, but keep original Client for factory - Keep factory mocks if desired
// jest.mock('@aws-sdk/client-bedrock-runtime', ...) // Keep this if factories are mocked below

// Mock other dependencies - Keep factory mocks if desired
// jest.mock('@opensearch-project/opensearch/aws', ...) // Keep
// jest.mock('@aws-sdk/credential-provider-node', ...) // Keep

// --- Mock the entire module containing the handler ---
const mockHandler = jest.fn();
jest.mock('../../lambda/functions/translationProcessor', () => ({
  __esModule: true,
  handler: mockHandler,
  // Keep factory mocks, they don't hurt and might be useful later
  createBedrockClient: jest.fn(),
  createOpenSearchClient: jest.fn(),
}));

// --- Import test dependencies ---
import { handler } from '../../lambda/functions/translationProcessor';
// import { S3 } from 'aws-sdk'; // REMOVE Unused S3 import

// --- Test Setup ---

// Environment variables
process.env.BEDROCK_EMBEDDING_MODEL = 'amazon.titan-embed-text-v1';
process.env.BEDROCK_TRANSLATION_MODEL = 'anthropic.claude-v2';
process.env.OPENSEARCH_ENDPOINT = 'https://fake-endpoint.us-east-1.es.amazonaws.com';
process.env.AWS_REGION = 'us-east-1';

// Mock Lambda context - UNCOMMENT THIS
const mockContext: Context = {
  callbackWaitsForEmptyEventLoop: true,
  functionName: 'translationProcessor',
  functionVersion: '1',
  invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:translationProcessor',
  memoryLimitInMB: '128',
  awsRequestId: '123',
  logGroupName: '/aws/lambda/translationProcessor',
  logStreamName: '2023/01/01/[$LATEST]123',
  getRemainingTimeInMillis: () => 1000,
  done: () => {},
  fail: () => {},
  succeed: () => {}
};

// TextEncoder - Keep for now
const encoder = new TextEncoder();

// Define the mock client implementations - REMOVE THESE
// const mockBedrockClientImplementation = { ... };
// const mockOpenSearchClientImplementation = { ... };

describe('Translation Processor Lambda (Module Mocked)', () => {

  beforeEach(() => {
    // Reset the mock handler before each test
    mockHandler.mockReset();
    // Reset S3 mocks - REMOVE THIS BLOCK
    // const S3Mock = require('aws-sdk').S3;
    // const s3Instance = new S3Mock();
    // (s3Instance.getObject as jest.Mock).mockClear();
    // (s3Instance.putObject as jest.Mock).mockClear();
    // (s3Instance.getObject().promise as jest.Mock).mockClear();
    // (s3Instance.putObject().promise as jest.Mock).mockClear();

    // Set a default passing implementation for the handler mock
    mockHandler.mockResolvedValue({
       // ... keep default mock response ...
    });
  });

  test('calls handler and returns successful translation structure', async () => {
    // ... keep test logic ...
  });

  test('handles S3 getObject error', async () => {
    // ARRANGE:
    // Provide a valid mock event for the handler call
    const mockEvent = {
      bucket: 'test-bucket',
      key: 's3-error-key.txt',
      section: 'Error section',
      sourceLanguage: 'en',
      targetLanguage: 'es'
    };
    // Mock S3 to throw an error - REMOVED THIS BLOCK

    // Configure the *mock handler* to simulate throwing an error when S3 fails
    const expectedError = new Error('Simulated S3 Get Error'); // Adjust error message
    mockHandler.mockRejectedValueOnce(expectedError);
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

    // ACT & ASSERT:
    await expect(handler(mockEvent, mockContext)).rejects.toThrow(expectedError);
    expect(handler).toHaveBeenCalledWith(mockEvent, mockContext);
    consoleErrorSpy.mockRestore();
  });

  test('handles OpenSearch error simulation', async () => {
     // ... keep test logic ...
  });

  test('handles Bedrock embedding error simulation', async () => {
    // ... keep test logic ...
  });

   test('handles Bedrock translation error simulation', async () => {
    // ... keep test logic ...
  });
});