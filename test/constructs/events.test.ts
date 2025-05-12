import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { Construct } from 'constructs';
import { EventsConstruct } from '../../lib/constructs/events';
import { LambdaConstruct } from '../../lib/constructs/lambda';
import { StorageConstruct } from '../../lib/constructs/storage';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as fs from 'fs';

// Reusable helper for dummy NodejsFunction
function createDummyNodejsFunction(scope: Construct, id: string): nodejs.NodejsFunction {
    // Ensure dummy entry file exists
    if (!fs.existsSync('dummy-entry.ts')) {
        fs.writeFileSync('dummy-entry.ts', 'exports.handler = () => {};');
    }
    return new nodejs.NodejsFunction(scope, id, {
        runtime: cdk.aws_lambda.Runtime.NODEJS_18_X,
        handler: 'index.handler',
        entry: 'dummy-entry.ts',
        functionName: `dummy-${id}-func`
    });
}

// Mock LambdaConstruct
class MockLambdaConstruct extends Construct implements Pick<LambdaConstruct, 'tmxProcessor' | 'documentProcessor'> {
    public readonly tmxProcessor: nodejs.NodejsFunction;
    public readonly documentProcessor: nodejs.NodejsFunction;

    constructor(scope: Construct, id: string) {
        super(scope, id);
        this.tmxProcessor = createDummyNodejsFunction(this, 'TmxProcessor');
        this.documentProcessor = createDummyNodejsFunction(this, 'DocProcessor');
    }
}

// Mock StorageConstruct
class MockStorageConstruct extends Construct implements Pick<StorageConstruct, 'tmxBucket' | 'documentsBucket'> {
    public readonly tmxBucket: s3.Bucket;
    public readonly documentsBucket: s3.Bucket;

    constructor(scope: Construct, id: string) {
        super(scope, id);
        this.tmxBucket = new s3.Bucket(this, 'TmxBucket', { bucketName: 'mock-tmx-bucket-events' });
        this.documentsBucket = new s3.Bucket(this, 'DocsBucket', { bucketName: 'mock-docs-bucket-events' });
    }
}

describe('EventsConstruct', () => {
    let stack: cdk.Stack;
    let template: Template;

    beforeAll(() => {
        stack = new cdk.Stack();
        const lambdaConstruct = new MockLambdaConstruct(stack, 'MockLambda');
        const storageConstruct = new MockStorageConstruct(stack, 'MockStorage');

        new EventsConstruct(stack, 'MyTestEvents', {
            lambdaFunctions: lambdaConstruct as unknown as LambdaConstruct,
            storage: storageConstruct as unknown as StorageConstruct
        });
        template = Template.fromStack(stack);
    });

    test('Snapshot Test', () => {
        expect(template.toJSON()).toMatchSnapshot();
    });

    test('Creates Two EventBridge Rules', () => {
        template.resourceCountIs('AWS::Events::Rule', 2);
    });

    test('TMX Rule Configured Correctly', () => {
        template.hasResourceProperties('AWS::Events::Rule', {
            Description: 'Rule to trigger TMX processing lambda on S3 TMX bucket uploads',
            EventPattern: {
                source: ['aws.s3'],
                'detail-type': ['AWS API Call via CloudTrail'],
                detail: {
                    eventSource: ['s3.amazonaws.com'],
                    eventName: ['PutObject', 'CompleteMultipartUpload'],
                    requestParameters: {
                        bucketName: [{
                            Ref: Match.stringLikeRegexp('MockStorageTmxBucket.*')
                        }]
                    }
                }
            },
            State: 'ENABLED',
            Targets: Match.arrayWith([
                Match.objectLike({
                    Arn: { 'Fn::GetAtt': [Match.stringLikeRegexp('MockLambdaTmxProcessor.*'), 'Arn'] }
                })
            ])
        });
    });

    test('Document Rule Configured Correctly', () => {
        template.hasResourceProperties('AWS::Events::Rule', {
            Description: 'Rule to trigger document processing lambda on S3 documents bucket uploads',
            EventPattern: {
                source: ['aws.s3'],
                'detail-type': ['AWS API Call via CloudTrail'],
                detail: {
                    eventSource: ['s3.amazonaws.com'],
                    eventName: ['PutObject', 'CompleteMultipartUpload'],
                    requestParameters: {
                        bucketName: [{
                            Ref: Match.stringLikeRegexp('MockStorageDocsBucket.*')
                        }]
                    }
                }
            },
            State: 'ENABLED',
            Targets: Match.arrayWith([
                Match.objectLike({
                    Arn: { 'Fn::GetAtt': [Match.stringLikeRegexp('MockLambdaDocProcessor.*'), 'Arn'] }
                })
            ])
        });
    });
});