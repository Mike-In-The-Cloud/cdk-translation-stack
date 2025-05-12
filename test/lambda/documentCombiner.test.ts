import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { mockClient } from 'aws-sdk-client-mock';
import 'aws-sdk-client-mock-jest';
import { handler } from '../../lambda/functions/documentCombiner';
import { Context } from 'aws-lambda';

// Create mock for S3Client
const s3Mock = mockClient(S3Client);

// Mock Lambda context (can be simplified or made more generic)
const mockContext: Context = {
  callbackWaitsForEmptyEventLoop: false,
  functionName: 'documentCombiner',
  functionVersion: '1.0.0',
  invokedFunctionArn: 'arn:aws:lambda:us-east-1:123456789012:function:documentCombiner',
  memoryLimitInMB: '128',
  awsRequestId: '123456789012',
  logGroupName: '/aws/lambda/documentCombiner',
  logStreamName: '2023/01/01/[$LATEST]123456789012',
  getRemainingTimeInMillis: () => 3000,
  done: () => {},
  fail: () => {},
  succeed: () => {},
};

describe('Document Combiner Lambda (SDK v3)', () => {
  beforeEach(() => {
    // Reset mock before each test
    s3Mock.reset();
  });

  test('combines document sections successfully and saves to S3', async () => {
    // Arrange: Mock S3 PutObjectCommand to resolve successfully
    s3Mock.on(PutObjectCommand).resolves({});

    const mockEvent = {
      bucket: 'test-bucket',
      originalKey: 'original/document.txt',
      translatedSections: [
        { sectionId: 2, translatedText: 'Section 2 text.', confidence: 0.90 },
        { sectionId: 1, translatedText: 'Section 1 text.', confidence: 0.95 },
      ],
      metadata: {
        sourceLanguage: 'en',
        targetLanguage: 'es',
        documentId: 'doc123'
      }
    };

    // Act
    const result = await handler(mockEvent, mockContext);

    // Assert: Verify S3 PutObjectCommand was called with correct parameters
    expect(s3Mock).toHaveReceivedCommandWith(PutObjectCommand, {
      Bucket: 'test-bucket',
      Key: 'translated/doc123_es.txt',
      Body: 'Section 1 text.\n\nSection 2 text.',
      ContentType: 'text/plain',
      Metadata: {
        'source-language': 'en',
        'target-language': 'es',
        'confidence-score': '0.925', // (0.90 + 0.95) / 2
        'original-document': 'original/document.txt'
      }
    });

    // Assert: Verify result structure and content
    expect(result).toEqual({
      bucket: 'test-bucket',
      key: 'translated/doc123_es.txt',
      confidence: 0.925,
      metadata: {
        sourceLanguage: 'en',
        targetLanguage: 'es',
        documentId: 'doc123',
        sections: 2
      }
    });
  });

  test('handles empty section list gracefully', async () => {
    // Arrange: Mock S3 PutObjectCommand
    s3Mock.on(PutObjectCommand).resolves({});

    const mockEvent = {
      bucket: 'test-bucket',
      originalKey: 'original/document.txt',
      translatedSections: [],
      metadata: {
        sourceLanguage: 'en',
        targetLanguage: 'es',
        documentId: 'docEmpty123'
      }
    };

    // Act
    const result = await handler(mockEvent, mockContext);

    // Assert: S3 call
    expect(s3Mock).toHaveReceivedCommandWith(PutObjectCommand, {
      Bucket: 'test-bucket',
      Key: 'translated/docEmpty123_es.txt',
      Body: '',
      ContentType: 'text/plain',
      Metadata: {
        'source-language': 'en',
        'target-language': 'es',
        'confidence-score': 'NaN', // Average of empty list is NaN
        'original-document': 'original/document.txt'
      }
    });

    // Assert: Result content
    expect(result.confidence).toBeNaN();
    expect(result.metadata.sections).toBe(0);
    expect(result.key).toBe('translated/docEmpty123_es.txt');
  });

  test('handles S3 error when saving document and throws', async () => {
    // Arrange: Mock S3 PutObjectCommand to reject
    const s3Error = new Error('S3 PutObject Failed');
    s3Mock.on(PutObjectCommand).rejects(s3Error);

    const mockEvent = {
      bucket: 'test-bucket',
      originalKey: 'original/document.txt',
      translatedSections: [
        { sectionId: 1, translatedText: 'Some text', confidence: 0.8 }
      ],
      metadata: {
        sourceLanguage: 'en',
        targetLanguage: 'es',
        documentId: 'docError456'
      }
    };

    // Act & Assert
    await expect(handler(mockEvent, mockContext)).rejects.toThrow(s3Error);

    // Assert: Verify S3 PutObjectCommand was called (even though it failed)
    expect(s3Mock).toHaveReceivedCommand(PutObjectCommand);
  });
});