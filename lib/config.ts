export interface TranslationStackConfig {
  senderEmail?: string;  // Optional: only needed if email notifications are enabled
  tmxBucketName: string;
  documentsBucketName: string;
  bedrockConfig: {
    embeddingModel: string;  // e.g., 'amazon.titan-embed-text-v1'
    translationModel: string;  // e.g., 'anthropic.claude-v2'
  };
  openSearchConfig: {
    collectionName: string;
  };
  features?: {
    emailNotifications: boolean;  // Whether to enable email notifications
  };
}

// Default configuration that can be overridden
export const getDefaultConfig = (): TranslationStackConfig => ({
  tmxBucketName: process.env.TMX_BUCKET_NAME || 'translation-memory-tmx',
  documentsBucketName: process.env.DOCUMENTS_BUCKET_NAME || 'translation-memory-docs',
  bedrockConfig: {
    embeddingModel: process.env.BEDROCK_EMBEDDING_MODEL || 'amazon.titan-embed-text-v1',
    translationModel: process.env.BEDROCK_TRANSLATION_MODEL || 'anthropic.claude-v2'
  },
  openSearchConfig: {
    collectionName: process.env.OPENSEARCH_COLLECTION_NAME || 'translation-memory'
  },
  features: {
    emailNotifications: process.env.ENABLE_EMAIL_NOTIFICATIONS === 'true'
  },
  ...(process.env.SENDER_EMAIL && { senderEmail: process.env.SENDER_EMAIL })
});