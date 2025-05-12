import { S3Event } from 'aws-lambda';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';
import { sdkStreamMixin } from '@smithy/util-stream';
import { TextEncoder } from 'util';

// Import the handler AFTER mocks are set up
import { handler } from '../../lambda/functions/tmxProcessor';

// Set up environment variables
process.env.AWS_REGION = 'us-east-1';
process.env.BEDROCK_EMBEDDING_MODEL = 'amazon.titan-embed-text-v1';

// Create mocks for the SDK v3 clients
const s3Mock = mockClient(S3Client);
const bedrockMock = mockClient(BedrockRuntimeClient);

// Helper to create valid S3 event structure (remains the same)
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

describe('TMX Processor Lambda (SDK v3)', () => {
  beforeEach(() => {
    // Reset mocks before each test
    s3Mock.reset();
    bedrockMock.reset();
  });

  test('processes TMX file successfully', async () => {
    // Arrange: Mock S3 GetObjectCommand response
    const mockTmxContent = `<?xml version="1.0" encoding="UTF-8"?>
    <tmx version="1.4">
      <header creationtool="XYZ Tool" creationtoolversion="1.0" datatype="plaintext" segtype="sentence" adminlang="en-us" srclang="en-us" o-tmf="abc">
      </header>
      <body>
        <tu>
          <tuv xml:lang="en-us">
            <seg>Hello world</seg>
          </tuv>
          <tuv xml:lang="es-es">
            <seg>Hola mundo</seg>
          </tuv>
        </tu>
        <tu>
          <tuv xml:lang="en-us">
            <seg>How are you?</seg>
          </tuv>
          <tuv xml:lang="es-es">
            <seg>¿Cómo estás?</seg>
          </tuv>
        </tu>
      </body>
    </tmx>`;

    // Create a mock readable stream for the S3 response body
    const stream = require('stream').Readable.from([mockTmxContent]);
    const sdkStream = sdkStreamMixin(stream); // Wrap in SDK stream mixin

    s3Mock.on(GetObjectCommand).resolves({
      Body: sdkStream,
      ContentType: 'application/xml'
    });

    // Arrange: Mock Bedrock InvokeModelCommand response
    const mockEmbedding = [0.1, 0.2, 0.3, 0.4, 0.5];
    const bedrockResponseBody = JSON.stringify({ embedding: mockEmbedding });
    const bedrockResponseUint8 = new TextEncoder().encode(bedrockResponseBody);

    bedrockMock.on(InvokeModelCommand).resolves({
      body: bedrockResponseUint8,
      contentType: 'application/json'
    });

    const mockEvent = createMockS3Event('test-bucket', 'test-file.tmx');
    const consoleSpy = jest.spyOn(console, 'log');

    // Act
    await handler(mockEvent);

    // Assert: Verify S3 GetObjectCommand was called correctly
    expect(s3Mock).toHaveReceivedCommandWith(GetObjectCommand, {
      Bucket: 'test-bucket',
      Key: 'test-file.tmx'
    });

    // Assert: Verify Bedrock InvokeModelCommand was called (twice for 2 TUs)
    expect(bedrockMock).toHaveReceivedCommandTimes(InvokeModelCommand, 2);
    expect(bedrockMock).toHaveReceivedNthCommandWith(1, InvokeModelCommand, {
       modelId: process.env.BEDROCK_EMBEDDING_MODEL,
       contentType: 'application/json',
       accept: 'application/json',
       body: JSON.stringify({ inputText: 'Hello world' })
    });
     expect(bedrockMock).toHaveReceivedNthCommandWith(2, InvokeModelCommand, {
       modelId: process.env.BEDROCK_EMBEDDING_MODEL,
       contentType: 'application/json',
       accept: 'application/json',
       body: JSON.stringify({ inputText: 'How are you?' })
    });

    // Assert: Verify console logs
    expect(consoleSpy).toHaveBeenCalledWith(
      'Created embedding for:',
      expect.objectContaining({
        sourceText: 'Hello world',
        targetText: 'Hola mundo',
        embedding: mockEmbedding
      })
    );
     expect(consoleSpy).toHaveBeenCalledWith(
      'Created embedding for:',
      expect.objectContaining({
        sourceText: 'How are you?',
        targetText: '¿Cómo estás?',
        embedding: mockEmbedding
      })
    );

    consoleSpy.mockRestore();
  });

  test('handles empty TMX file error', async () => {
    // Arrange: Mock S3 GetObjectCommand with empty stream
    const stream = require('stream').Readable.from(['']);
    const sdkStream = sdkStreamMixin(stream);
    s3Mock.on(GetObjectCommand).resolves({
      Body: sdkStream,
      ContentType: 'application/xml'
    });

    const mockEvent = createMockS3Event('test-bucket', 'empty-file.tmx');

    // Act & Assert
    await expect(handler(mockEvent)).rejects.toThrow('TMX file is empty or could not be read');

    expect(s3Mock).toHaveReceivedCommandWith(GetObjectCommand, {
      Bucket: 'test-bucket',
      Key: 'empty-file.tmx'
    });
    expect(bedrockMock).not.toHaveReceivedCommand(InvokeModelCommand);
  });

  test('handles S3 GetObject error', async () => {
    // Arrange: Mock S3 GetObjectCommand to reject
    const s3Error = new Error('S3 GetObject Failed');
    s3Mock.on(GetObjectCommand).rejects(s3Error);

    const mockEvent = createMockS3Event('test-bucket', 's3-error-file.tmx');

    // Act & Assert
    await expect(handler(mockEvent)).rejects.toThrow(s3Error);

    expect(s3Mock).toHaveReceivedCommandWith(GetObjectCommand, {
        Bucket: 'test-bucket',
        Key: 's3-error-file.tmx'
    });
    expect(bedrockMock).not.toHaveReceivedCommand(InvokeModelCommand);
  });

  test('handles Bedrock InvokeModel error', async () => {
    // Arrange: Mock S3 GetObjectCommand response (valid)
    const mockTmxContent = `<?xml version="1.0" encoding="UTF-8"?>
    <tmx version="1.4"><body><tu><tuv xml:lang="en-us"><seg>One</seg></tuv><tuv xml:lang="es-es"><seg>Uno</seg></tuv></tu></body></tmx>`;
    const stream = require('stream').Readable.from([mockTmxContent]);
    const sdkStream = sdkStreamMixin(stream);
    s3Mock.on(GetObjectCommand).resolves({ Body: sdkStream });

    // Arrange: Mock Bedrock InvokeModelCommand to reject
    const bedrockError = new Error('Bedrock Invoke Failed');
    bedrockMock.on(InvokeModelCommand).rejects(bedrockError);

    const mockEvent = createMockS3Event('test-bucket', 'bedrock-error-file.tmx');

    // Act & Assert
    await expect(handler(mockEvent)).rejects.toThrow(bedrockError);

    expect(s3Mock).toHaveReceivedCommand(GetObjectCommand);
    expect(bedrockMock).toHaveReceivedCommand(InvokeModelCommand); // It was called, but failed
  });

  test('handles invalid TMX parsing error', async () => {
    // Arrange: Mock S3 GetObjectCommand response with invalid XML
    const mockTmxContent = `<invalid></xml>`;
    const stream = require('stream').Readable.from([mockTmxContent]);
    const sdkStream = sdkStreamMixin(stream);
    s3Mock.on(GetObjectCommand).resolves({
        Body: sdkStream,
        ContentType: 'application/xml'
    });

    const mockEvent = createMockS3Event('test-bucket', 'bad-xml.tmx');

    // Act & Assert
    await expect(handler(mockEvent)).rejects.toThrow(); // xml2js throws generic Error
    // Could add more specific error check if xml2js provides typed errors

    expect(s3Mock).toHaveReceivedCommand(GetObjectCommand);
    expect(bedrockMock).not.toHaveReceivedCommand(InvokeModelCommand);
  });
});