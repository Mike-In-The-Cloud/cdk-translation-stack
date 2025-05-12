import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { Context } from 'aws-lambda';
import { Client } from '@opensearch-project/opensearch';
import { AwsSigv4Signer } from '@opensearch-project/opensearch/aws';
import { defaultProvider } from '@aws-sdk/credential-provider-node';

// Factory function for Bedrock
export const createBedrockClient = () => {
  return new BedrockRuntimeClient({ region: process.env.AWS_REGION });
};

// Factory function for OpenSearch
export const createOpenSearchClient = () => {
  return new Client({
    ...AwsSigv4Signer({
      region: process.env.AWS_REGION!,
      service: 'aoss',
      getCredentials: () => defaultProvider()(),
    }),
    node: process.env.OPENSEARCH_ENDPOINT!
  });
}

// const s3 = new S3(); // REMOVED v2 S3 Client
// Clients are now created via factories inside the handler

interface TranslationRequest {
  bucket: string;
  key: string;
  section: string;
  sourceLanguage: string;
  targetLanguage: string;
}

interface SearchHit {
  _source: {
    translation: string;
    score: number;
  };
}

export const handler = async (event: TranslationRequest, context: Context): Promise<any> => {
  // Initialize clients inside the handler using factories
  const bedrockClient = createBedrockClient();
  const opensearchClient = createOpenSearchClient(); // Use factory

  try {
    // Create embedding for the section to translate
    const embeddingCommand = new InvokeModelCommand({
      modelId: process.env.BEDROCK_EMBEDDING_MODEL || 'amazon.titan-embed-text-v1',
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        inputText: event.section
      })
    });

    const embeddingResponse = await bedrockClient.send(embeddingCommand);
    const embedding = JSON.parse(new TextDecoder().decode(embeddingResponse.body)).embedding;

    // Search for similar translations in OpenSearch
    const searchResponse = await opensearchClient.search({
      index: 'translations',
      body: {
        query: {
          script_score: {
            query: { match_all: {} },
            script: {
              source: "cosineSimilarity(params.query_vector, 'embedding') + 1.0",
              params: { query_vector: embedding }
            }
          }
        },
        size: 5
      }
    });

    // Extract relevant context from similar translations
    const hits = searchResponse.body.hits.hits as unknown as SearchHit[];
    const context = hits
      .filter(hit => hit._source && hit._source.score > 0.8 && hit._source.translation)
      .map(hit => hit._source.translation)
      .join('\n');

    // Prepare prompt for Bedrock with context
    const prompt = `
      Context from similar translations:
      ${context}

      Translate the following text from ${event.sourceLanguage} to ${event.targetLanguage},
      maintaining consistency with the context provided above:

      Text: ${event.section}
    `;

    // Call Bedrock for translation
    const translationCommand = new InvokeModelCommand({
      modelId: process.env.BEDROCK_TRANSLATION_MODEL || 'anthropic.claude-v2',
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify({
        prompt,
        max_tokens: 2000,
        temperature: 0.7
      })
    });

    const translationResponse = await bedrockClient.send(translationCommand);
    const translation = JSON.parse(new TextDecoder().decode(translationResponse.body)).completion;

    return {
      originalText: event.section,
      translatedText: translation,
      confidence: 0.95,  // You might want to calculate this based on context matches
      metadata: {
        model: process.env.BEDROCK_TRANSLATION_MODEL || 'anthropic.claude-v2',
        contextSize: context.split('\n').length
      }
    };

  } catch (error) {
    console.error('Error in translation process:', error);
    throw error;
  }
};