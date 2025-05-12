import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as opensearch from 'aws-cdk-lib/aws-opensearchserverless';
import { Construct } from 'constructs';

export interface StorageConstructProps {
  tmxBucketName: string;
  documentsBucketName: string;
  openSearchCollectionName: string;
  // Add other relevant config like removal policies if needed
}

export class StorageConstruct extends Construct {
  public readonly tmxBucket: s3.Bucket;
  public readonly documentsBucket: s3.Bucket;
  public readonly translationCollection: opensearch.CfnCollection;

  constructor(scope: Construct, id: string, props: StorageConstructProps) {
    super(scope, id);

    this.tmxBucket = new s3.Bucket(this, 'TMXBucket', {
      bucketName: props.tmxBucketName,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Consider making this configurable
    });

    this.documentsBucket = new s3.Bucket(this, 'DocumentsBucket', {
      bucketName: props.documentsBucketName,
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Consider making this configurable
    });

    this.translationCollection = new opensearch.CfnCollection(this, 'TranslationCollection', {
      name: props.openSearchCollectionName,
      description: 'Collection for storing translation embeddings',
      type: 'VECTORSEARCH'
    });
  }
}