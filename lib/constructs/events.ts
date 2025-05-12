import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import { LambdaConstruct } from './lambda';
import { StorageConstruct } from './storage';

export interface EventsConstructProps {
  lambdaFunctions: LambdaConstruct;
  storage: StorageConstruct;
}

export class EventsConstruct extends Construct {
  constructor(scope: Construct, id: string, props: EventsConstructProps) {
    super(scope, id);

    const { lambdaFunctions, storage } = props;

    // --- EventBridge Rules ---
    const tmxRule = new events.Rule(this, 'TMXUploadRule', {
      // ruleName: `${cdk.Aws.STACK_NAME}-TMXUploadRule`, // Optional: Define a specific name
      description: 'Rule to trigger TMX processing lambda on S3 TMX bucket uploads',
      eventPattern: {
        source: ['aws.s3'],
        detailType: ['AWS API Call via CloudTrail'], // Using CloudTrail events for more reliable PutObject/CompleteMultipartUpload
        detail: {
          eventSource: ['s3.amazonaws.com'],
          eventName: ['PutObject', 'CompleteMultipartUpload'],
          requestParameters: {
            bucketName: [storage.tmxBucket.bucketName]
          }
        }
      }
    });

    const documentRule = new events.Rule(this, 'DocumentUploadRule', {
      // ruleName: `${cdk.Aws.STACK_NAME}-DocumentUploadRule`, // Optional: Define a specific name
      description: 'Rule to trigger document processing lambda on S3 documents bucket uploads',
      eventPattern: {
        source: ['aws.s3'],
        detailType: ['AWS API Call via CloudTrail'],
        detail: {
          eventSource: ['s3.amazonaws.com'],
          eventName: ['PutObject', 'CompleteMultipartUpload'],
          requestParameters: {
            bucketName: [storage.documentsBucket.bucketName]
          }
        }
      }
    });

    // Add EventBridge targets
    tmxRule.addTarget(new targets.LambdaFunction(lambdaFunctions.tmxProcessor));
    documentRule.addTarget(new targets.LambdaFunction(lambdaFunctions.documentProcessor));

    // Add permissions if needed (Lambda construct should ideally grant invoke permission, but double-check)
    // lambdaFunctions.tmxProcessor.addPermission(...)
    // lambdaFunctions.documentProcessor.addPermission(...)
  }
}