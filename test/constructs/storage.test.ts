import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { StorageConstruct } from '../../lib/constructs/storage';

describe('StorageConstruct Tests', () => {
  let app: cdk.App;
  let stack: cdk.Stack;
  let template: Template;

  beforeAll(() => {
    app = new cdk.App();
    stack = new cdk.Stack(app, 'TestStack'); // Create a dummy stack to host the construct
    new StorageConstruct(stack, 'MyStorage', {
        tmxBucketName: 'test-tmx-bucket',
        documentsBucketName: 'test-docs-bucket',
        openSearchCollectionName: 'test-collection'
    });
    template = Template.fromStack(stack);
  });

  test('Creates S3 Buckets', () => {
    template.resourceCountIs('AWS::S3::Bucket', 2);

    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: 'test-tmx-bucket',
      VersioningConfiguration: { Status: 'Enabled' },
      BucketEncryption: { ServerSideEncryptionConfiguration: [{ ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' }}] }
    });

    template.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: 'test-docs-bucket',
      VersioningConfiguration: { Status: 'Enabled' },
      BucketEncryption: { ServerSideEncryptionConfiguration: [{ ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' }}] }
    });
  });

  test('Creates OpenSearch Collection', () => {
    template.resourceCountIs('AWS::OpenSearchServerless::Collection', 1);
    template.hasResourceProperties('AWS::OpenSearchServerless::Collection', {
      Name: 'test-collection',
      Type: 'VECTORSEARCH'
    });
  });
});