import { TranslationStackConfig, getDefaultConfig } from '../../lib/config';

describe('Configuration Module', () => {
  // Save original environment
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment variables before each test
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.TMX_BUCKET_NAME;
    delete process.env.DOCUMENTS_BUCKET_NAME;
    delete process.env.BEDROCK_EMBEDDING_MODEL;
    delete process.env.BEDROCK_TRANSLATION_MODEL;
    delete process.env.OPENSEARCH_COLLECTION_NAME;
    delete process.env.ENABLE_EMAIL_NOTIFICATIONS;
    delete process.env.SENDER_EMAIL;
  });

  afterAll(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  test('getDefaultConfig returns expected defaults', () => {
    const config = getDefaultConfig();

    // Check default values
    expect(config.tmxBucketName).toBe('translation-memory-tmx');
    expect(config.documentsBucketName).toBe('translation-memory-docs');
    expect(config.bedrockConfig.embeddingModel).toBe('amazon.titan-embed-text-v1');
    expect(config.bedrockConfig.translationModel).toBe('anthropic.claude-v2');
    expect(config.openSearchConfig.collectionName).toBe('translation-memory');
    expect(config.features?.emailNotifications).toBe(false);
    expect(config.senderEmail).toBeUndefined();
  });

  test('getDefaultConfig uses environment variables when available', () => {
    // Set environment variables
    process.env.TMX_BUCKET_NAME = 'custom-tmx-bucket';
    process.env.DOCUMENTS_BUCKET_NAME = 'custom-docs-bucket';
    process.env.BEDROCK_EMBEDDING_MODEL = 'custom-embedding-model';
    process.env.BEDROCK_TRANSLATION_MODEL = 'custom-translation-model';
    process.env.OPENSEARCH_COLLECTION_NAME = 'custom-opensearch-collection';
    process.env.ENABLE_EMAIL_NOTIFICATIONS = 'true';
    process.env.SENDER_EMAIL = 'custom@example.com';

    const config = getDefaultConfig();

    // Check that environment variables are used
    expect(config.tmxBucketName).toBe('custom-tmx-bucket');
    expect(config.documentsBucketName).toBe('custom-docs-bucket');
    expect(config.bedrockConfig.embeddingModel).toBe('custom-embedding-model');
    expect(config.bedrockConfig.translationModel).toBe('custom-translation-model');
    expect(config.openSearchConfig.collectionName).toBe('custom-opensearch-collection');
    expect(config.features?.emailNotifications).toBe(true);
    expect(config.senderEmail).toBe('custom@example.com');
  });

  test('getDefaultConfig enables email notifications only when set to true', () => {
    // Set environment variable to false
    process.env.ENABLE_EMAIL_NOTIFICATIONS = 'false';

    const config = getDefaultConfig();

    // Email notifications should be disabled
    expect(config.features?.emailNotifications).toBe(false);

    // Set environment variable to true
    process.env.ENABLE_EMAIL_NOTIFICATIONS = 'true';

    const configWithNotifications = getDefaultConfig();

    // Email notifications should be enabled
    expect(configWithNotifications.features?.emailNotifications).toBe(true);
  });

  test('getDefaultConfig treats invalid ENABLE_EMAIL_NOTIFICATIONS as false', () => {
    // Set environment variable to an invalid value
    process.env.ENABLE_EMAIL_NOTIFICATIONS = 'not-a-boolean';

    const config = getDefaultConfig();

    // Email notifications should be disabled
    expect(config.features?.emailNotifications).toBe(false);
  });

  test('getDefaultConfig handles missing SENDER_EMAIL', () => {
    // No SENDER_EMAIL environment variable
    const config = getDefaultConfig();

    // senderEmail should be undefined
    expect(config.senderEmail).toBeUndefined();
  });

  test('getDefaultConfig sets senderEmail when provided', () => {
    // Set SENDER_EMAIL environment variable
    process.env.SENDER_EMAIL = 'test@example.com';

    const config = getDefaultConfig();

    // senderEmail should be set
    expect(config.senderEmail).toBe('test@example.com');
  });
});