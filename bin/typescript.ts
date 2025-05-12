#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { TypescriptStack } from '../lib/typescript-stack';
import { TranslationStackConfig } from '../lib/config';

const app = new cdk.App();

// Filter out undefined values from the configuration
const config: Partial<TranslationStackConfig> = {
  ...(process.env.SENDER_EMAIL && { senderEmail: process.env.SENDER_EMAIL }),
  ...(process.env.TMX_BUCKET_NAME && { tmxBucketName: process.env.TMX_BUCKET_NAME }),
  ...(process.env.DOCUMENTS_BUCKET_NAME && { documentsBucketName: process.env.DOCUMENTS_BUCKET_NAME }),
  ...(process.env.BEDROCK_EMBEDDING_MODEL && process.env.BEDROCK_TRANSLATION_MODEL && {
    bedrockConfig: {
      embeddingModel: process.env.BEDROCK_EMBEDDING_MODEL,
      translationModel: process.env.BEDROCK_TRANSLATION_MODEL
    }
  }),
  ...(process.env.OPENSEARCH_COLLECTION_NAME && {
    openSearchConfig: {
      collectionName: process.env.OPENSEARCH_COLLECTION_NAME
    }
  })
};

new TypescriptStack(app, 'TypescriptStack', {
  /* If you don't specify 'env', this stack will be environment-agnostic.
   * Account/Region-dependent features and context lookups will not work,
   * but a single synthesized template can be deployed anywhere. */

  /* Uncomment the next line to specialize this stack for the AWS Account
   * and Region that are implied by the current CLI configuration. */
  // env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },

  /* Uncomment the next line if you know exactly what Account and Region you
   * want to deploy the stack to. */
  // env: { account: '123456789012', region: 'us-east-1' },

  /* For more information, see https://docs.aws.amazon.com/cdk/latest/guide/environments.html */
  config: config
});