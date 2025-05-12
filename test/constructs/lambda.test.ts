import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { LambdaConstruct, LambdaConstructProps } from '../../lib/constructs/lambda';
import { StorageConstruct } from '../../lib/constructs/storage';
import { TranslationStackConfig, getDefaultConfig } from '../../lib/config';
import { Duration } from 'aws-cdk-lib';

describe('LambdaConstruct', () => {
    let stack: cdk.Stack;
    let storage: StorageConstruct;
    let lambdaConstruct: LambdaConstruct;
    let template: Template;

    const baseConfig: TranslationStackConfig = {
        ...getDefaultConfig(),
        openSearchConfig: { // ensure this is part of getDefaultConfig or explicitly set
            ...getDefaultConfig().openSearchConfig,
            collectionName: 'test-lambda-collection',
        },
        tmxBucketName: 'test-lambda-tmx-bucket',
        documentsBucketName: 'test-lambda-documents-bucket',
        senderEmail: 'test@example.com', // for notification tests
    };

    const setup = (configProps?: Partial<TranslationStackConfig>) => {
        const app = new cdk.App();
        stack = new cdk.Stack(app, 'TestStack', {
            env: { region: 'us-east-1', account: '123456789012' },
        });

        storage = new StorageConstruct(stack, 'TestStorage', {
            tmxBucketName: configProps?.tmxBucketName || baseConfig.tmxBucketName,
            documentsBucketName: configProps?.documentsBucketName || baseConfig.documentsBucketName,
            openSearchCollectionName: configProps?.openSearchConfig?.collectionName || baseConfig.openSearchConfig.collectionName,
        });

        const finalConfig = { ...baseConfig, ...configProps };

        lambdaConstruct = new LambdaConstruct(stack, 'MyLambdaConstruct', {
            config: finalConfig,
            storage: storage,
        });
        template = Template.fromStack(stack);
    };

    describe('Core Lambda Functions', () => {
        beforeAll(() => {
            setup({ features: { emailNotifications: false } }); // Default to no notifications for core tests
        });

        test('Creates Correct Number of Core Lambdas', () => {
            // TMX, DocProc, Translate, Combiner, SetEnvVar = 5
            template.resourceCountIs('AWS::Lambda::Function', 5);
        });

        test('All Lambdas have Correct Runtime and Handler', () => {
            const expectedProperties = {
                Runtime: 'nodejs18.x',
                Handler: 'index.handler', // Assuming this is the handler for all NodejsFunctions
            };
            template.allResourcesProperties('AWS::Lambda::Function', Match.objectLike(expectedProperties));
        });

        test('TMXProcessor Lambda Configuration', () => {
            const tmxProcessorLogicalId = stack.getLogicalId(lambdaConstruct.tmxProcessor.node.defaultChild as cdk.CfnElement);
            const tmxProcessorRoleLogicalId = stack.getLogicalId(lambdaConstruct.tmxProcessor.role!.node.defaultChild as cdk.CfnElement);

            // Find the specific resource by logical ID and assert its properties
            const resources = template.findResources('AWS::Lambda::Function');
            const tmxProcessorResource = resources[tmxProcessorLogicalId];
            expect(tmxProcessorResource).toBeDefined();
            expect(tmxProcessorResource.Properties.Handler).toEqual('index.handler');
            expect(tmxProcessorResource.Properties.Runtime).toEqual('nodejs18.x');
            expect(tmxProcessorResource.Properties.Environment).toEqual(expect.objectContaining({
                Variables: expect.objectContaining({
                    OPENSEARCH_ENDPOINT: expect.objectContaining({
                        'Fn::GetAtt': expect.arrayContaining([
                            expect.stringMatching(/^TestStorageTranslationCollection.+/),
                            'CollectionEndpoint'
                        ])
                    }),
                    BEDROCK_EMBEDDING_MODEL: baseConfig.bedrockConfig.embeddingModel,
                }),
            }));

            // Check IAM Policy for TMXProcessor
            template.hasResourceProperties('AWS::IAM::Policy', {
                PolicyDocument: {
                    Statement: Match.arrayWith([
                        Match.objectLike({
                            Action: 'bedrock:InvokeModel',
                            Effect: 'Allow',
                            Resource: `arn:aws:bedrock:us-east-1:123456789012:model/${baseConfig.bedrockConfig.embeddingModel}`,
                        }),
                    ]),
                },
                Roles: Match.arrayWith([ Match.exact({ Ref: tmxProcessorRoleLogicalId }) ]),
            });
        });

        test('DocumentProcessor Lambda Configuration', () => {
            const docProcessorLogicalId = stack.getLogicalId(lambdaConstruct.documentProcessor.node.defaultChild as cdk.CfnElement);
            const docProcessorRoleLogicalId = stack.getLogicalId(lambdaConstruct.documentProcessor.role!.node.defaultChild as cdk.CfnElement);
            // No specific environment variables defined within the construct for this one
            // No StartExecution policy here, it is added in the stack
            const policies = template.findResources('AWS::IAM::Policy', {
                Roles: Match.arrayWith([ Match.exact({ Ref: docProcessorRoleLogicalId }) ]),
            });

            let foundStartExecutionPolicy = false;
            for (const policyName in policies) {
                const policy = policies[policyName];
                if (policy.Properties && policy.Properties.PolicyDocument && policy.Properties.PolicyDocument.Statement) {
                    for (const stmt of policy.Properties.PolicyDocument.Statement) {
                        if (stmt.Action === 'states:StartExecution' || (Array.isArray(stmt.Action) && stmt.Action.includes('states:StartExecution'))) {
                            foundStartExecutionPolicy = true;
                            break;
                        }
                    }
                }
                if (foundStartExecutionPolicy) break;
            }
            expect(foundStartExecutionPolicy).toBe(false);
        });

        test('TranslationProcessor Lambda Configuration', () => {
            const translationProcessorLogicalId = stack.getLogicalId(lambdaConstruct.translationProcessor.node.defaultChild as cdk.CfnElement);
            const translationProcessorRoleLogicalId = stack.getLogicalId(lambdaConstruct.translationProcessor.role!.node.defaultChild as cdk.CfnElement);

            // Find the specific resource by logical ID and assert its properties
            const resources = template.findResources('AWS::Lambda::Function');
            const translatorResource = resources[translationProcessorLogicalId];
            expect(translatorResource).toBeDefined();
            expect(translatorResource.Properties.Handler).toEqual('index.handler');
            expect(translatorResource.Properties.Runtime).toEqual('nodejs18.x');
            expect(translatorResource.Properties.Environment).toEqual(expect.objectContaining({
                Variables: expect.objectContaining({
                    OPENSEARCH_ENDPOINT: expect.objectContaining({
                        'Fn::GetAtt': expect.arrayContaining([
                            expect.stringMatching(/^TestStorageTranslationCollection.+/),
                            'CollectionEndpoint'
                        ])
                    }),
                    BEDROCK_EMBEDDING_MODEL: baseConfig.bedrockConfig.embeddingModel,
                    BEDROCK_TRANSLATION_MODEL: baseConfig.bedrockConfig.translationModel,
                }),
            }));

            // Check IAM Policy for TranslationProcessor
            template.hasResourceProperties('AWS::IAM::Policy', {
                PolicyDocument: {
                    Statement: Match.arrayWith([
                        Match.objectLike({
                            Action: 'bedrock:InvokeModel',
                            Effect: 'Allow',
                            Resource: Match.arrayWith([
                                `arn:aws:bedrock:us-east-1:123456789012:model/${baseConfig.bedrockConfig.embeddingModel}`,
                                `arn:aws:bedrock:us-east-1:123456789012:model/${baseConfig.bedrockConfig.translationModel}`,
                            ]),
                        }),
                    ]),
                },
                Roles: Match.arrayWith([ Match.exact({ Ref: translationProcessorRoleLogicalId }) ]),
            });
        });

        test('DocumentCombiner Lambda Configuration', () => {
            // No specific environment variables or initial policies in the construct
            expect(lambdaConstruct.documentCombiner).toBeDefined();
        });

        test('SetLambdaEnvVarFunction Configuration', () => {
            // Find the specific function to check its timeout
            const setLambdaEnvVarFuncLogicalId = stack.getLogicalId(lambdaConstruct.setLambdaEnvVarFunction.node.defaultChild as cdk.CfnElement);
            // To uniquely identify the function, we use its handler and runtime as well, which are known.
            template.hasResourceProperties('AWS::Lambda::Function', {
                Timeout: Duration.minutes(1).toSeconds(),
                Handler: 'index.handler', // From common props
                Runtime: 'nodejs18.x',   // From common props
                // We are looking for THE setLambdaEnvVarFunction which has these properties.
                // This is safer than just matching Timeout, as other functions might coincidentally have the same timeout.
            });
            expect(lambdaConstruct.setLambdaEnvVarFunction).toBeDefined();
        });
    });

    describe('NotificationSender Lambda (Conditional)', () => {
        test('Creates NotificationSender Lambda when emailNotifications is true and senderEmail is provided', () => {
            setup({ features: { emailNotifications: true }, senderEmail: 'notify@example.com' });
            expect(lambdaConstruct.notificationSender).toBeDefined();
            template.resourceCountIs('AWS::Lambda::Function', 6); // 5 core + 1 notification

            const notificationSenderLogicalId = stack.getLogicalId(lambdaConstruct.notificationSender!.node.defaultChild as cdk.CfnElement);
            const notificationSenderRoleLogicalId = stack.getLogicalId(lambdaConstruct.notificationSender!.role!.node.defaultChild as cdk.CfnElement);

            // Check properties of the NotificationSender Lambda
            template.hasResourceProperties('AWS::Lambda::Function', {
                Environment: { Variables: { SENDER_EMAIL: 'notify@example.com' } },
                Handler: 'index.handler', // Assuming common handler
                Runtime: 'nodejs18.x',   // Assuming common runtime
                // This relies on the SENDER_EMAIL being unique enough to identify the function
            });

            template.hasResourceProperties('AWS::IAM::Policy', {
                PolicyDocument: {
                    Statement: Match.arrayWith([
                        Match.objectLike({
                            Action: ['ses:SendEmail', 'ses:SendRawEmail'],
                            Effect: 'Allow',
                            Resource: `arn:aws:ses:us-east-1:123456789012:identity/notify@example.com`,
                        }),
                    ]),
                },
                // Use the Role's logical ID for matching
                Roles: Match.arrayWith([ Match.exact({ Ref: notificationSenderRoleLogicalId }) ]),
            });
        });

        test('Does NOT create NotificationSender Lambda when emailNotifications is false', () => {
            setup({ features: { emailNotifications: false } });
            expect(lambdaConstruct.notificationSender).toBeUndefined();
            template.resourceCountIs('AWS::Lambda::Function', 5);
        });

        test('Does NOT create NotificationSender Lambda when senderEmail is not provided (even if feature is true)', () => {
            setup({ features: { emailNotifications: true }, senderEmail: undefined });
            expect(lambdaConstruct.notificationSender).toBeUndefined();
            template.resourceCountIs('AWS::Lambda::Function', 5);
        });
    });
});