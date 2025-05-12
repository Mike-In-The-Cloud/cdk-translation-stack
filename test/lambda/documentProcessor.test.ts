import { S3Event } from 'aws-lambda';
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest'; // Extends jest assertions

// Import the handler AFTER setting up mocks if needed, but here we mock globally
import { handler } from '../../lambda/functions/documentProcessor';

// Set up environment variables (consider moving to jest.config.js or setup file)
process.env.AWS_REGION = 'us-east-1';
process.env.TRANSLATION_STATE_MACHINE_ARN = 'arn:aws:states:us-east-1:123456789012:stateMachine:test';

// Create mocks for the SDK v3 clients
const s3Mock = mockClient(S3Client);
const sfnMock = mockClient(SFNClient);

// Helper to create valid S3 event structure
const createMockS3Event = (bucket: string, key: string): S3Event => ({
  Records: [
    {
      eventVersion: '2.1',
      eventSource: 'aws:s3',
      awsRegion: 'us-east-1',
      eventTime: new Date().toISOString(),
      eventName: 'ObjectCreated:Put',
      userIdentity: {
        principalId: 'AWS:123456789012:root'
      },
      requestParameters: {
        sourceIPAddress: '127.0.0.1'
      },
      responseElements: {
        'x-amz-request-id': '12345678',
        'x-amz-id-2': 'example'
      },
      s3: {
        s3SchemaVersion: '1.0',
        configurationId: 'test-config',
        bucket: {
          name: bucket,
          ownerIdentity: {
            principalId: 'A1B2C3D4E5F6G7'
          },
          arn: `arn:aws:s3:::${bucket}`
        },
        object: {
          key: key,
          size: 1024,
          eTag: '12345678',
          sequencer: '0A1B2C3D4E5F6G7'
        }
      }
    }
  ]
});

describe('Document Processor Lambda (SDK v3)', () => {
  beforeEach(() => {
    // Reset mocks before each test
    s3Mock.reset();
    sfnMock.reset();
  });

  test('processes document and starts state machine', async () => {
    // Arrange: Mock S3 HeadObjectCommand response
    s3Mock.on(HeadObjectCommand).resolves({
      ContentType: 'text/plain'
    });

    // Arrange: Mock SFN StartExecutionCommand response
    sfnMock.on(StartExecutionCommand).resolves({
      executionArn: 'arn:aws:states:us-east-1:123456789012:execution:test:12345',
      startDate: new Date()
    });

    const bucket = 'test-bucket';
    const key = 'documents/test.txt';
    const mockEvent = createMockS3Event(bucket, key);

    // Act
    await handler(mockEvent);

    // Assert: Verify S3Client was called correctly
    expect(s3Mock).toHaveReceivedCommandWith(HeadObjectCommand, {
      Bucket: bucket,
      Key: key
    });

    // Assert: Verify SFNClient was called correctly
    expect(sfnMock).toHaveReceivedCommandTimes(StartExecutionCommand, 1);
    const receivedCommand = sfnMock.commandCalls(StartExecutionCommand)[0];
    expect(receivedCommand.args[0].input).toBeDefined();
    const receivedInput = JSON.parse(receivedCommand.args[0].input?.input as string);

    expect(receivedCommand.args[0].input?.stateMachineArn).toBe(process.env.TRANSLATION_STATE_MACHINE_ARN);
    expect(receivedInput).toMatchObject({
      bucket: bucket,
      key: key,
      contentType: 'text/plain',
      documentId: 'test',
      timestamp: expect.any(String)
    });
  });

  test('throws error for unsupported file type', async () => {
    // Arrange: Mock S3 HeadObjectCommand response with unsupported type
    s3Mock.on(HeadObjectCommand).resolves({
      ContentType: 'image/jpeg'
    });

    const bucket = 'test-bucket';
    const key = 'documents/image.jpg';
    const mockEvent = createMockS3Event(bucket, key);

    // Act & Assert
    await expect(handler(mockEvent)).rejects.toThrow('Unsupported file type: image/jpeg');

    // Assert: Verify S3Client was called
    expect(s3Mock).toHaveReceivedCommandWith(HeadObjectCommand, { Bucket: bucket, Key: key });
    // Assert: Verify SFNClient was NOT called
    expect(sfnMock).not.toHaveReceivedCommand(StartExecutionCommand);
  });

  test('handles S3 error', async () => {
    // Arrange: Mock S3 HeadObjectCommand to throw an error
    const s3Error = new Error('S3 Bucket Not Found');
    s3Mock.on(HeadObjectCommand).rejects(s3Error);

    const bucket = 'test-bucket';
    const key = 'documents/error.txt';
    const mockEvent = createMockS3Event(bucket, key);

    // Act & Assert
    await expect(handler(mockEvent)).rejects.toThrow(s3Error);

    // Assert: Verify S3Client was called
    expect(s3Mock).toHaveReceivedCommandWith(HeadObjectCommand, { Bucket: bucket, Key: key });
    // Assert: Verify SFNClient was NOT called
    expect(sfnMock).not.toHaveReceivedCommand(StartExecutionCommand);
  });

  test('handles Step Functions error', async () => {
    // Arrange: Mock S3 HeadObjectCommand response
    s3Mock.on(HeadObjectCommand).resolves({
      ContentType: 'text/plain'
    });

    // Arrange: Mock SFN StartExecutionCommand to throw an error
    const sfnError = new Error('StateMachine Does Not Exist');
    sfnMock.on(StartExecutionCommand).rejects(sfnError);

    const bucket = 'test-bucket';
    const key = 'documents/sfn-error.txt';
    const mockEvent = createMockS3Event(bucket, key);

    // Act & Assert
    await expect(handler(mockEvent)).rejects.toThrow(sfnError);

    // Assert: Verify S3Client was called
    expect(s3Mock).toHaveReceivedCommandWith(HeadObjectCommand, { Bucket: bucket, Key: key });
    // Assert: Verify SFNClient was called
    expect(sfnMock).toHaveReceivedCommand(StartExecutionCommand);
  });

  test('handles multiple records in event', async () => {
    // Arrange: Mock S3 HeadObjectCommand response
    s3Mock.on(HeadObjectCommand).resolves({
      ContentType: 'text/plain'
    });

    // Arrange: Mock SFN StartExecutionCommand response
    sfnMock.on(StartExecutionCommand).resolves({});

    const mockMultiEvent: S3Event = {
      Records: [
        createMockS3Event('test-bucket', 'documents/test1.txt').Records[0],
        createMockS3Event('test-bucket', 'documents/test2.txt').Records[0]
      ]
    };

    // Act
    await handler(mockMultiEvent);

    // Assert: Verify S3Client was called twice
    expect(s3Mock).toHaveReceivedCommandTimes(HeadObjectCommand, 2);
    expect(s3Mock).toHaveReceivedNthCommandWith(1, HeadObjectCommand, { Bucket: 'test-bucket', Key: 'documents/test1.txt' });
    expect(s3Mock).toHaveReceivedNthCommandWith(2, HeadObjectCommand, { Bucket: 'test-bucket', Key: 'documents/test2.txt' });

    // Assert: Verify SFNClient was called twice
    expect(sfnMock).toHaveReceivedCommandTimes(StartExecutionCommand, 2);
  });
});