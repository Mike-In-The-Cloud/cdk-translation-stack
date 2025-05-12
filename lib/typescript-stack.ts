import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import * as opensearch from 'aws-cdk-lib/aws-opensearchserverless';
import { Construct } from 'constructs';
import * as path from 'path';
import { TranslationStackConfig, getDefaultConfig } from './config';
import { StorageConstruct } from './constructs/storage';
import { LambdaConstruct } from './constructs/lambda';
import { StateMachineConstruct } from './constructs/state-machine';
import { EventsConstruct } from './constructs/events';
import { CustomResourceConstruct } from './constructs/custom-resource';
import { GrantPermissionsCustomResource } from './constructs/grant-permissions-custom-resource';

interface TypescriptStackProps extends cdk.StackProps {
  config?: Partial<TranslationStackConfig>;
}

export class TypescriptStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: TypescriptStackProps) {
    super(scope, id, props);

    // Merge default config with provided config
    const config: TranslationStackConfig = {
      ...getDefaultConfig(),
      ...props?.config
    };

    // Validate required configuration
    if (!config.senderEmail && config.features?.emailNotifications) {
      throw new Error('SENDER_EMAIL must be provided if emailNotifications feature is enabled');
    }

    // --- Instantiate Storage Construct ---
    const storage = new StorageConstruct(this, 'Storage', {
        tmxBucketName: config.tmxBucketName,
        documentsBucketName: config.documentsBucketName,
        openSearchCollectionName: config.openSearchConfig.collectionName
    });

    // --- Instantiate Lambda Construct ---
    const lambdaFunctions = new LambdaConstruct(this, 'LambdaFunctions', {
        config: config,
        storage: storage,
    });

    // --- Instantiate State Machine DEFINITION Construct ---
    const stateMachineDefinitionConstruct = new StateMachineConstruct(this, 'StateMachineDefinition', {
        documentProcessorLambda: lambdaFunctions.documentProcessor,
        translationProcessorLambda: lambdaFunctions.translationProcessor,
        documentCombinerLambda: lambdaFunctions.documentCombiner,
        notificationSenderLambda: lambdaFunctions.notificationSender,
    });
    const workflowDefinition = stateMachineDefinitionConstruct.definition;

    // --- Create State Machine Role Explicitly ---
    const stateMachineRole = new iam.Role(this, 'StateMachineRole', {
      assumedBy: new iam.ServicePrincipal('states.amazonaws.com'),
    });

    // --- Create State Machine Resource Explicitly ---
    const stateMachineName = `${cdk.Aws.STACK_NAME}-TranslationWorkflow`;
    const translationStateMachine = new stepfunctions.StateMachine(this, 'TranslationStateMachineResource', {
        stateMachineName: stateMachineName,
        definitionBody: stepfunctions.DefinitionBody.fromChainable(workflowDefinition),
        role: stateMachineRole,
    });

    // --- Instantiate Events Construct ---
    new EventsConstruct(this, 'Events', {
        lambdaFunctions: lambdaFunctions,
        storage: storage
    });

    // --- Grant Basic Permissions ---
    storage.tmxBucket.grantRead(lambdaFunctions.tmxProcessor);
    storage.documentsBucket.grantReadWrite(lambdaFunctions.documentProcessor);
    storage.documentsBucket.grantReadWrite(lambdaFunctions.documentCombiner);
    if (lambdaFunctions.notificationSender) {
        storage.documentsBucket.grantRead(lambdaFunctions.notificationSender);
    }
    // Grant OpenSearch permissions
    new opensearch.CfnAccessPolicy(this, 'OpenSearchAccessPolicy', {
        name: 'translation-memory-access',
        type: 'collection',
        description: 'Allow Lambda functions to access OpenSearch collection',
        policy: JSON.stringify([{
            Description: 'Allow Lambda functions to access OpenSearch collection',
            Rules: [{
                ResourceType: 'collection',
                Resource: [storage.translationCollection.attrArn],
                Permission: ['aoss:APIAccessAll']
            }],
            Principal: [
                lambdaFunctions.tmxProcessor.role!.roleArn,
                lambdaFunctions.translationProcessor.role!.roleArn
            ]
        }])
    });

    // --- State Machine & Cross-Service Permission Grants (Handled by Custom Resources) ---

    // Gather Lambdas the State Machine needs to invoke
    const lambdasToInvokeByStateMachine = [
        lambdaFunctions.documentProcessor,
        lambdaFunctions.translationProcessor,
        lambdaFunctions.documentCombiner
    ];
    if (lambdaFunctions.notificationSender) {
        lambdasToInvokeByStateMachine.push(lambdaFunctions.notificationSender);
    }

    // Instantiate the GrantPermissions Custom Resource
    new GrantPermissionsCustomResource(this, 'GrantCrossServicePermissions', {
        lambdaToGrantStartExecution: lambdaFunctions.documentProcessor,
        stateMachineToGrantInvoke: translationStateMachine,
        stateMachineRoleToGrantInvoke: stateMachineRole,
        lambdasToInvokeByStateMachine: lambdasToInvokeByStateMachine,
        customResourceProviderLambda: lambdaFunctions.grantPermissionsFunction
    });

    // Instantiate the Set Environment Variable Custom Resource
    // Ensure this depends on the permissions being granted first, if necessary,
    // although the CR handler for Set Env Var doesn't depend on the *permissions*,
    // just the existence of the lambda and state machine.
    const setEnvVarCr = new CustomResourceConstruct(this, 'SetStateMachineArnEnvVar', {
        targetLambdaFunction: lambdaFunctions.documentProcessor,
        stateMachine: translationStateMachine,
        customResourceProviderLambda: lambdaFunctions.setLambdaEnvVarFunction
    });
     // Explicitly depend on the State Machine Role being ready (as its ARN is needed by the perm CR)
    setEnvVarCr.node.addDependency(stateMachineRole);

    // --- Stack Outputs ---
    new cdk.CfnOutput(this, 'StateMachineArn', {
      value: translationStateMachine.stateMachineArn,
      description: 'The ARN of the translation state machine'
    });

    new cdk.CfnOutput(this, 'TMXBucketName', {
      value: storage.tmxBucket.bucketName,
      description: 'The name of the bucket for TMX files'
    });

    new cdk.CfnOutput(this, 'DocumentsBucketName', {
      value: storage.documentsBucket.bucketName,
      description: 'The name of the bucket for documents to be translated'
    });

    new cdk.CfnOutput(this, 'OpenSearchEndpoint', {
      value: storage.translationCollection.attrCollectionEndpoint,
      description: 'The endpoint for the OpenSearch collection'
    });

    // The code that defines your stack goes here

    // example resource
    // const queue = new sqs.Queue(this, 'TypescriptQueue', {
    //   visibilityTimeout: cdk.Duration.seconds(300)
    // });
  }
}
