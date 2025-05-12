import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';
import { Context } from 'aws-lambda';

// Mock the s3-request-presigner
// We need to mock the specific named export `getSignedUrl`
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://mock-presigned-url.com/document?sig=v3')
}));

// Import the handler AFTER mocking presigner
import { handler } from '../../lambda/functions/notificationSender';
// Import the mocked function to allow assertion on it
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

// Set up environment variables
process.env.AWS_REGION = 'us-east-1';
process.env.SENDER_EMAIL = 'test@example.com';

// Create mocks for the SDK v3 clients
const sesMock = mockClient(SESClient);
// S3Client is used by getSignedUrl internally, but we don't need to mock its methods directly
// as we're mocking the getSignedUrl function itself.
const s3ClientMock = mockClient(S3Client); // Keep mock for completeness if needed elsewhere

// Type assertion for the mocked function
const mockedGetSignedUrl = getSignedUrl as jest.Mock;

// Mock Lambda context
const mockContext: Context = {
  callbackWaitsForEmptyEventLoop: false,
  functionName: 'notificationSender',
  functionVersion: '1.0.0',
  invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:notificationSender',
  memoryLimitInMB: '128',
  awsRequestId: '123456789012',
  logGroupName: '/aws/lambda/notificationSender',
  logStreamName: '2023/01/01/[$LATEST]123456789012',
  getRemainingTimeInMillis: () => 3000,
  done: () => {},
  fail: () => {},
  succeed: () => {},
};

describe('Notification Sender Lambda (SDK v3)', () => {
  beforeEach(() => {
    // Reset mocks before each test
    sesMock.reset();
    mockedGetSignedUrl.mockClear();
    // Optionally reset the implementation if needed between tests, but clear usually suffices
    // mockedGetSignedUrl.mockResolvedValue('https://mock-presigned-url.com/document?sig=v3');
  });

  test('sends email notification successfully', async () => {
    // Arrange: Mock SES SendEmailCommand response
    sesMock.on(SendEmailCommand).resolves({
      MessageId: 'mock-message-id-123'
    });

    const mockEvent = {
      bucket: 'test-bucket',
      key: 'translated/document.txt',
      recipientEmail: 'user@example.com',
      metadata: {
        documentId: 'doc123',
        sourceLanguage: 'en',
        targetLanguage: 'es',
        confidence: 0.95
      }
    };

    // Act
    await handler(mockEvent, mockContext);

    // Assert: Verify getSignedUrl was called correctly
    expect(mockedGetSignedUrl).toHaveBeenCalledTimes(1);
    expect(mockedGetSignedUrl).toHaveBeenCalledWith(
      expect.any(S3Client), // Check that an S3 client instance was passed
      expect.objectContaining({ // NEW Check: Ensure it's an object...
        input: {                // ... and verify the 'input' property
           Bucket: 'test-bucket',
           Key: 'translated/document.txt'
        }
      }),
      { expiresIn: 604800 } // Check expiration time
    );

    // Assert: Verify SES SendEmailCommand was called correctly
    expect(sesMock).toHaveReceivedCommandTimes(SendEmailCommand, 1);
    expect(sesMock).toHaveReceivedCommandWith(SendEmailCommand, {
      Destination: {
        ToAddresses: ['user@example.com']
      },
      Message: {
        Body: {
          Html: {
            Charset: 'UTF-8',
            Data: expect.stringContaining('https://mock-presigned-url.com/document?sig=v3')
          },
          Text: {
            Charset: 'UTF-8',
            Data: expect.stringContaining('https://mock-presigned-url.com/document?sig=v3')
          }
        },
        Subject: {
          Charset: 'UTF-8',
          Data: 'Translation Complete - doc123'
        }
      },
      Source: 'test@example.com'
    });
  });

  // Note: Test for missing recipientEmail is removed as it's not a function input validation anymore

  test('handles SES error', async () => {
    // Arrange: Mock SES SendEmailCommand to reject
    const sesError = new Error('SES Send Failed');
    sesMock.on(SendEmailCommand).rejects(sesError);

    const mockEvent = {
      bucket: 'test-bucket',
      key: 'translated/document.txt',
      recipientEmail: 'user@example.com',
      metadata: {
        documentId: 'docError456',
        sourceLanguage: 'en',
        targetLanguage: 'es',
        confidence: 0.95
      }
    };

    // Act & Assert
    await expect(handler(mockEvent, mockContext)).rejects.toThrow(sesError);

    // Assert: Verify getSignedUrl was still called
    expect(mockedGetSignedUrl).toHaveBeenCalledTimes(1);
    // Assert: Verify SES SendEmailCommand was called (even though it failed)
    expect(sesMock).toHaveReceivedCommand(SendEmailCommand);
  });

  test('handles s3-request-presigner error', async () => {
    // Arrange: Mock getSignedUrl to throw an error
    const presignerError = new Error('Presigner Failed');
    mockedGetSignedUrl.mockRejectedValue(presignerError);

    const mockEvent = {
      bucket: 'test-bucket',
      key: 'translated/document.txt',
      recipientEmail: 'user@example.com',
      metadata: {
        documentId: 'docError789',
        sourceLanguage: 'en',
        targetLanguage: 'es',
        confidence: 0.95
      }
    };

    // Act & Assert
    await expect(handler(mockEvent, mockContext)).rejects.toThrow(presignerError);

    // Assert: Verify getSignedUrl was called
    expect(mockedGetSignedUrl).toHaveBeenCalledTimes(1);
    // Assert: Verify SES SendEmailCommand was NOT called
    expect(sesMock).not.toHaveReceivedCommand(SendEmailCommand);
  });
});