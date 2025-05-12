import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { Construct } from 'constructs';
import { StateMachineConstruct } from '../../lib/constructs/state-machine';
import * as lambda from 'aws-cdk-lib/aws-lambda';

describe('StateMachineConstruct', () => {
    let stack: cdk.Stack;
    let template: Template;
    // Use real lambda functions
    let docProcessorLambda: lambda.Function;
    let translationProcessorLambda: lambda.Function;
    let docCombinerLambda: lambda.Function;
    let notifierLambda: lambda.Function | undefined;

    const setup = (withNotifier: boolean) => {
        stack = new cdk.Stack();
        // Create real lambda functions
        docProcessorLambda = new lambda.Function(stack, 'TestDocProcessor', {
            runtime: lambda.Runtime.NODEJS_LATEST,
            handler: 'index.handler',
            code: lambda.Code.fromInline('exports.handler = async () => {};'),
        });
        translationProcessorLambda = new lambda.Function(stack, 'TestTranslateProcessor', {
            runtime: lambda.Runtime.NODEJS_LATEST,
            handler: 'index.handler',
            code: lambda.Code.fromInline('exports.handler = async () => {};'),
        });
        docCombinerLambda = new lambda.Function(stack, 'TestDocCombiner', {
            runtime: lambda.Runtime.NODEJS_LATEST,
            handler: 'index.handler',
            code: lambda.Code.fromInline('exports.handler = async () => {};'),
        });
        notifierLambda = withNotifier ? new lambda.Function(stack, 'TestNotifier', {
            runtime: lambda.Runtime.NODEJS_LATEST,
            handler: 'index.handler',
            code: lambda.Code.fromInline('exports.handler = async () => {};'),
        }) : undefined;

        new StateMachineConstruct(stack, 'MyTestStateMachine', {
            // Pass real lambda functions
            documentProcessorLambda: docProcessorLambda,
            translationProcessorLambda: translationProcessorLambda,
            documentCombinerLambda: docCombinerLambda,
            notificationSenderLambda: notifierLambda,
        });
        template = Template.fromStack(stack);
    };

    // Test case with Notification Sender enabled
    describe('With Notification Sender', () => {
        beforeAll(() => {
            setup(true);
        });

        test('Snapshot Test', () => {
            // Snapshot will change
            expect(template.toJSON()).toMatchSnapshot();
        });

        test('Creates State Machine', () => {
            template.resourceCountIs('AWS::StepFunctions::StateMachine', 1);
            template.hasResourceProperties('AWS::StepFunctions::StateMachine', {
                RoleArn: Match.objectLike({ 'Fn::GetAtt': [Match.stringLikeRegexp('MyTestStateMachineTranslationStateMachineRole.*'), 'Arn'] })
            });
        });

        test('References Correct Lambda Functions', () => {
            const docProcessorLogicalId = stack.getLogicalId(docProcessorLambda.node.defaultChild as cdk.CfnElement);
            const translatorLogicalId = stack.getLogicalId(translationProcessorLambda.node.defaultChild as cdk.CfnElement);
            const combinerLogicalId = stack.getLogicalId(docCombinerLambda.node.defaultChild as cdk.CfnElement);
            const notifierLogicalId = notifierLambda ? stack.getLogicalId(notifierLambda.node.defaultChild as cdk.CfnElement) : null;

            template.hasResourceProperties('AWS::StepFunctions::StateMachine', {
                 DefinitionString: Match.objectLike({
                     'Fn::Join': [
                        "", // Separator
                        // Check that the array part contains the Fn::GetAtt for each expected Lambda ARN
                        Match.arrayWith([
                            Match.objectLike({ "Fn::GetAtt": [ docProcessorLogicalId, "Arn" ] }),
                            Match.objectLike({ "Fn::GetAtt": [ translatorLogicalId, "Arn" ] }),
                            Match.objectLike({ "Fn::GetAtt": [ combinerLogicalId, "Arn" ] }),
                            // Conditionally check for the notifier ARN object
                            ...(notifierLogicalId ?
                                [Match.objectLike({ "Fn::GetAtt": [ notifierLogicalId, "Arn" ] })]
                                : [] // If no notifier, don't require this object
                            )
                        ])
                    ]
                 })
            });
        });
    });

    // Test case with Notification Sender disabled
    describe('Without Notification Sender', () => {
        beforeAll(() => {
            setup(false);
        });

        test('Snapshot Test', () => {
            // Snapshot will change
            expect(template.toJSON()).toMatchSnapshot();
        });

        test('Creates State Machine', () => {
            template.resourceCountIs('AWS::StepFunctions::StateMachine', 1);
            template.hasResourceProperties('AWS::StepFunctions::StateMachine', {
                RoleArn: Match.objectLike({ 'Fn::GetAtt': [Match.stringLikeRegexp('MyTestStateMachineTranslationStateMachineRole.*'), 'Arn'] })
            });
        });

        test('Does NOT Reference Notifier Lambda Function (when disabled)', () => {
            const stateMachineResource = template.findResources('AWS::StepFunctions::StateMachine');
            const definitionString = stateMachineResource[Object.keys(stateMachineResource)[0]].Properties.DefinitionString['Fn::Join'][1].join('');
            // Get the logical ID of the Doc Processor to ensure we don't accidentally match part of it
            const docProcessorLogicalId = stack.getLogicalId(docProcessorLambda.node.defaultChild as cdk.CfnElement);

            // Check that the definition string does NOT contain the ARN structure for a function named TestNotifier
            // (using the ID we gave it in setup)
            expect(definitionString).not.toMatch(new RegExp(`.*:function:TestNotifier.*`));
        });
    });
});