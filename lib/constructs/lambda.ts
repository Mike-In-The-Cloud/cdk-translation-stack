import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import * as path from 'path';
import { TranslationStackConfig } from '../config'; // Assuming config types are here
import { StorageConstruct } from './storage'; // Need storage outputs

export interface LambdaConstructProps {
    config: TranslationStackConfig;
    storage: StorageConstruct;
    // REMOVE: readonly stateMachineArn: string;
}

export class LambdaConstruct extends Construct {
    // Expose functions needed by other constructs/stack
    public readonly tmxProcessor: nodejs.NodejsFunction;
    public readonly documentProcessor: nodejs.NodejsFunction;
    public readonly translationProcessor: nodejs.NodejsFunction;
    public readonly documentCombiner: nodejs.NodejsFunction;
    public readonly setLambdaEnvVarFunction: nodejs.NodejsFunction;
    public readonly notificationSender?: nodejs.NodejsFunction; // Optional
    public readonly grantPermissionsFunction: nodejs.NodejsFunction; // Function for GrantPermissions CR

    constructor(scope: Construct, id: string, props: LambdaConstructProps) {
        super(scope, id);

        // REMOVE: const { config, storage, stateMachineArn } = props;
        const { config, storage } = props; // stateMachineArn is no longer a prop
        const region = cdk.Stack.of(this).region;
        const account = cdk.Stack.of(this).account;

        // Common NodejsFunction settings
        const nodeJsFunctionProps: Partial<nodejs.NodejsFunctionProps> = {
            runtime: lambda.Runtime.NODEJS_18_X,
            handler: 'handler',
            bundling: {
                externalModules: [ // Optimize bundling if needed
                    '@aws-sdk/*' // Exclude AWS SDK v3 clients if using Lambda Layer or system provided
                ],
                nodeModules: ['@aws-sdk/client-iam'],
            },
            timeout: cdk.Duration.minutes(1),
        };

        // --- Function Definitions ---

        this.tmxProcessor = new nodejs.NodejsFunction(this, 'TMXProcessor', {
            ...nodeJsFunctionProps,
            entry: path.join(__dirname, '../../lambda/functions/tmxProcessor.ts'),
            timeout: cdk.Duration.seconds(30),
            environment: {
                OPENSEARCH_ENDPOINT: storage.translationCollection.attrCollectionEndpoint,
                BEDROCK_EMBEDDING_MODEL: config.bedrockConfig.embeddingModel,
            },
            initialPolicy: [
                new iam.PolicyStatement({
                    actions: ['bedrock:InvokeModel'],
                    resources: [`arn:aws:bedrock:${region}:${account}:model/${config.bedrockConfig.embeddingModel}`],
                }),
            ],
        });

        this.documentProcessor = new nodejs.NodejsFunction(this, 'DocumentProcessor', {
            ...nodeJsFunctionProps,
            entry: path.join(__dirname, '../../lambda/functions/documentProcessor.ts'),
            timeout: cdk.Duration.seconds(30),
        });

        this.translationProcessor = new nodejs.NodejsFunction(this, 'TranslationProcessor', {
            ...nodeJsFunctionProps,
            entry: path.join(__dirname, '../../lambda/functions/translationProcessor.ts'),
            environment: {
                OPENSEARCH_ENDPOINT: storage.translationCollection.attrCollectionEndpoint,
                BEDROCK_EMBEDDING_MODEL: config.bedrockConfig.embeddingModel,
                BEDROCK_TRANSLATION_MODEL: config.bedrockConfig.translationModel,
            },
            initialPolicy: [
                new iam.PolicyStatement({
                    actions: ['bedrock:InvokeModel'],
                    resources: [
                        `arn:aws:bedrock:${region}:${account}:model/${config.bedrockConfig.embeddingModel}`,
                        `arn:aws:bedrock:${region}:${account}:model/${config.bedrockConfig.translationModel}`,
                    ],
                }),
                // OpenSearch permission is granted via CfnAccessPolicy in the main stack
            ],
            timeout: cdk.Duration.seconds(30),
        });

        this.documentCombiner = new nodejs.NodejsFunction(this, 'DocumentCombiner', {
            ...nodeJsFunctionProps,
            entry: path.join(__dirname, '../../lambda/functions/documentCombiner.ts'),
            timeout: cdk.Duration.seconds(30),
        });

        // Custom Resource Lambda
        this.setLambdaEnvVarFunction = new nodejs.NodejsFunction(this, 'SetLambdaEnvVarFunction', {
            ...nodeJsFunctionProps,
            entry: path.join(__dirname, '../../lambda/custom/setLambdaEnvVar.ts'),
        });

        // Optional Notification Sender
        if (config.features?.emailNotifications && config.senderEmail) {
            this.notificationSender = new nodejs.NodejsFunction(this, 'NotificationSender', {
                ...nodeJsFunctionProps,
                entry: path.join(__dirname, '../../lambda/functions/notificationSender.ts'),
                environment: {
                    SENDER_EMAIL: config.senderEmail,
                },
                initialPolicy: [
                    new iam.PolicyStatement({
                        actions: ['ses:SendEmail', 'ses:SendRawEmail'],
                        resources: [`arn:aws:ses:${region}:${account}:identity/${config.senderEmail}`],
                    }),
                ],
                timeout: cdk.Duration.seconds(30),
            });
        }

        // Custom Resource Lambda (Grant Permissions)
        this.grantPermissionsFunction = new nodejs.NodejsFunction(this, 'GrantPermissionsFunction', {
            ...nodeJsFunctionProps,
            entry: path.join(__dirname, '../../lambda/custom/grantPermissions.ts'),
            description: 'Custom Resource handler to grant IAM permissions post-creation',
            initialPolicy: [
                // This Lambda needs permission to modify the policies of the target roles
                new iam.PolicyStatement({
                    actions: ['iam:PutRolePolicy', 'iam:DeleteRolePolicy'],
                    // WARNING: Scoping this is crucial for security.
                    // Ideally, scope this ONLY to the specific roles being modified.
                    // However, the role ARNs aren't known here yet.
                    // Using a wildcard is less secure but might be necessary if exact ARNs
                    // cannot be easily passed or derived during synth.
                    // Consider passing Role Names via environment variables if possible for tighter scope.
                    resources: ["*"] // TODO: Refine this resource scope if possible!
                }),
            ],
        });
    }
}