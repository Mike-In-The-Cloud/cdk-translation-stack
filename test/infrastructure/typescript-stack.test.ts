import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as TypescriptStack from '../../lib/typescript-stack';
import { getDefaultConfig, TranslationStackConfig } from '../../lib/config';

describe('TypescriptStack Infrastructure Tests', () => {
  let template: Template;
  let app: cdk.App;
  let stack: TypescriptStack.TypescriptStack;
  let config: TranslationStackConfig;

  // Synthesize stack once with default (email enabled) config before tests
  beforeAll(() => {
    app = new cdk.App();
    // Use getDefaultConfig
    config = getDefaultConfig();
    // Ensure email is enabled for the default tests unless specifically testing omission
    config.features = { ...config.features, emailNotifications: true };
    if (!config.senderEmail) {
        config.senderEmail = 'test@example.com'; // Provide a default for tests
    }
    stack = new TypescriptStack.TypescriptStack(app, 'TestStack', { config });
    template = Template.fromStack(stack);
  });

  test('Snapshot Test', () => {
    expect(template.toJSON()).toMatchSnapshot();
  });

  test('creates S3 buckets', () => {
    template.resourceCountIs('AWS::S3::Bucket', 2);
  });

  test('creates Lambda functions with correct runtime', () => {
    // Base (4) + SetEnvVar CR Func (1) + SetEnvVar CR Prov (1) + GrantPerms CR Func (1) + GrantPerms CR Prov (1) + Notification Sender (1) = 9
    template.resourceCountIs('AWS::Lambda::Function', 9);

    // Check that *our* defined Lambda functions have the correct runtime and handler name
    // Exclude the CDK provider functions which we don't directly control
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs18.x',
      Handler: 'index.handler',
      // Match specific function names/patterns if needed, e.g., check TMXProcessor
      // Environment: Match.objectLike({ ... }) // Check specific env vars if needed
    });
    // Check a specific function example
    template.hasResourceProperties('AWS::Lambda::Function', Match.objectLike({
        Runtime: 'nodejs18.x',
        Handler: 'index.handler',
        Environment: Match.objectLike({
          Variables: Match.objectLike({
             BEDROCK_EMBEDDING_MODEL: Match.anyValue(), // Check existence
             OPENSEARCH_ENDPOINT: Match.anyValue()
          })
        })
      // Add condition or tag check if necessary to be more specific than just properties
    }));
  });

  test('creates OpenSearch Collection', () => {
    template.resourceCountIs('AWS::OpenSearchServerless::Collection', 1);
    template.hasResourceProperties('AWS::OpenSearchServerless::Collection', {
      Name: 'translation-memory',
      Type: 'VECTORSEARCH'
    });
  });

  test('creates Step Functions state machine', () => {
    template.resourceCountIs('AWS::StepFunctions::StateMachine', 1);
    // Check for specific states or structure if needed
  });

  test('omits notification sender when disabled', () => {
    const localApp = new cdk.App();
    // Use getDefaultConfig
    let localConfig = getDefaultConfig();
    localConfig.features = { ...localConfig.features, emailNotifications: false }; // Disable email
    // Ensure a sender email is present, even if notifications are off, to avoid unrelated validation errors
    if (!localConfig.senderEmail) {
        localConfig.senderEmail = 'disabled-test@example.com';
    }
    const localStack = new TypescriptStack.TypescriptStack(localApp, 'NoEmailStack', { config: localConfig });
    const localTemplate = Template.fromStack(localStack);

    // Total Expected with email disabled: 4 (Core) + 2 (SetEnvVar CR) + 2 (GrantPerms CR) = 8
    localTemplate.resourceCountIs('AWS::Lambda::Function', 8);
  });

  test('includes notification sender when enabled', () => {
    // Uses the template from beforeAll (notifications enabled)
    // Total Expected with email enabled: 4 (Core) + 2 (SetEnvVar CR) + 2 (GrantPerms CR) + 1 (Notifications) = 9
    template.resourceCountIs('AWS::Lambda::Function', 9);
    // Optionally check for the specific notification sender function by its logical ID pattern or properties
    template.hasResourceProperties('AWS::Lambda::Function', Match.objectLike({
        Environment: Match.objectLike({
            Variables: Match.objectLike({
                SENDER_EMAIL: 'test@example.com' // Or config.senderEmail
            })
        })
        // Use more specific matching if needed, e.g., matching part of the logical ID
        // or checking the policy for SES permissions.
    }));
  });

  test('DocumentProcessor has correct environment and permissions', () => {
      // Check Environment Variable set by Custom Resource 'SetStateMachineArnEnvVar'
      template.hasResourceProperties("AWS::CloudFormation::CustomResource", Match.objectLike({
            ServiceToken: Match.anyValue(), // Provider ARN
            FunctionName: { Ref: Match.stringLikeRegexp('LambdaFunctionsDocumentProcessor') },
            EnvironmentVariables: {
                TRANSLATION_STATE_MACHINE_ARN: { Ref: Match.stringLikeRegexp('TranslationStateMachineResource') } // Updated resource name
            }
      }));

      // REMOVED: Check for StartExecution policy directly on the role.
      // This policy is now applied dynamically by the GrantPermissions custom resource
      // and cannot be verified via static template analysis.

      // Check S3 Permissions (example, adapt as needed)
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
            Statement: Match.arrayWith([
                Match.objectLike({
                    Action: Match.arrayWith([
                        's3:GetObject*',          // For grantReadWrite
                        's3:GetBucket*',          // For grantReadWrite
                        's3:List*',             // For grantReadWrite
                        's3:DeleteObject*',       // For grantReadWrite
                        's3:PutObject',           // For grantReadWrite
                        's3:PutObjectLegalHold',  // For grantReadWrite
                        's3:PutObjectRetention', // For grantReadWrite
                        's3:PutObjectTagging',    // For grantReadWrite
                        's3:PutObjectVersionTagging', // For grantReadWrite
                        's3:Abort*',            // For grantReadWrite
                    ]),
                    Effect: "Allow",
                    Resource: Match.arrayWith([
                        { "Fn::GetAtt": [ Match.stringLikeRegexp('StorageDocumentsBucket'), "Arn" ] },
                        { "Fn::Join": ["", [{ "Fn::GetAtt": [ Match.stringLikeRegexp('StorageDocumentsBucket'), "Arn" ] }, "/*"]]}
                    ])
                })
            ]),
        },
        Roles: Match.arrayWith([
             { Ref: Match.stringLikeRegexp('LambdaFunctionsDocumentProcessorServiceRole') } // Match the role logical ID
        ])
      });
  });

  test('TranslationProcessor does NOT have S3 permissions', () => {
    // Find the policy attached to the TranslationProcessor role
    const policies = template.findResources('AWS::IAM::Policy', {
        Properties: {
            Roles: Match.arrayWith([{ Ref: Match.stringLikeRegexp('LambdaFunctionsTranslationProcessorServiceRole') }])
        }
    });

    // Check that *none* of the statements in the relevant policy grant S3 access
    for (const policyId in policies) {
        const policy = policies[policyId];
        policy.Properties.PolicyDocument.Statement.forEach((statement: any) => {
            // Allow bedrock:InvokeModel, deny others implicitly for this test focus
            if (statement.Action === 'bedrock:InvokeModel' || (Array.isArray(statement.Action) && statement.Action.includes('bedrock:InvokeModel'))) {
                // This is expected, ignore
            } else if (statement.Action === 'logs:CreateLogGroup' || (Array.isArray(statement.Action) && statement.Action.includes('logs:CreateLogGroup'))){
                // This is basic execution role, ignore
            } else if (statement.Action === 'logs:CreateLogStream' || (Array.isArray(statement.Action) && statement.Action.includes('logs:CreateLogStream'))){
                 // This is basic execution role, ignore
            } else if (statement.Action === 'logs:PutLogEvents' || (Array.isArray(statement.Action) && statement.Action.includes('logs:PutLogEvents'))){
                 // This is basic execution role, ignore
            } else if (statement.Action?.includes('aoss:APIAccessAll') || statement.Action === 'aoss:APIAccessAll') {
                 // This is OpenSearch access granted by CfnAccessPolicy, ignore for this test
                 // Note: Checking statement.Action?.includes... to handle potential array/string variance
            }
             else {
                // Ensure no statement grants s3 permissions
                expect(statement.Action).not.toContain('s3:');
                // Optionally check resource too, though action is usually sufficient here
                // expect(statement.Resource).not.toContain('s3:');
            }
        });
    }
  });

  test('validates required configuration', () => {
    const originalEnv = process.env.SENDER_EMAIL;
    try {
      // Unset the environment variable
      delete process.env.SENDER_EMAIL;

      const localApp = new cdk.App();
      // Use getDefaultConfig
      let localConfig = getDefaultConfig();
      // Critically: *Enable* the feature that requires the email
      localConfig.features = { ...localConfig.features, emailNotifications: true };
      // Explicitly remove senderEmail from the config object itself AFTER getting defaults
      // and after potentially having it set via env vars (which we deleted above)
      delete localConfig.senderEmail;

      // Expect the stack synthesis to throw because email is enabled but sender is missing
      expect(() => {
        new TypescriptStack.TypescriptStack(localApp, 'ValidationStack', {
          config: localConfig
        });
      }).toThrow(/SENDER_EMAIL must be provided/);
    } finally {
      // Restore environment variable
      process.env.SENDER_EMAIL = originalEnv;
    }
  });
});