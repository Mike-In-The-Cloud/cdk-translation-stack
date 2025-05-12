import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as iam from 'aws-cdk-lib/aws-iam';
import { CustomResourceConstruct } from '../../lib/constructs/custom-resource';

describe('CustomResourceConstruct', () => {
    let app: cdk.App;
    let stack: cdk.Stack;
    let template: Template;
    let targetLambda: lambda.Function;
    let providerLambda: lambda.Function;
    let stateMachine: sfn.StateMachine;

    beforeEach(() => {
        app = new cdk.App();
        stack = new cdk.Stack(app, 'TestStack', {
            env: { account: '123456789012', region: 'us-east-1' },
        });

        targetLambda = new lambda.Function(stack, 'TargetLambda', {
            runtime: lambda.Runtime.NODEJS_LATEST,
            handler: 'index.handler',
            code: lambda.Code.fromInline('exports.handler = async () => {};'),
        });

        providerLambda = new lambda.Function(stack, 'ProviderLambda', {
            runtime: lambda.Runtime.NODEJS_LATEST,
            handler: 'index.handler',
            code: lambda.Code.fromInline('exports.handler = async () => {};'),
        });

        stateMachine = new sfn.StateMachine(stack, 'TestStateMachine', {
            definitionBody: sfn.DefinitionBody.fromChainable(new sfn.Pass(stack, 'StartState')),
        });

        new CustomResourceConstruct(stack, 'MyTestConstruct', {
            targetLambdaFunction: targetLambda,
            stateMachine: stateMachine,
            customResourceProviderLambda: providerLambda,
        });

        template = Template.fromStack(stack);
    });

    test('Snapshot Test', () => {
        expect(template.toJSON()).toMatchSnapshot();
    });

    test('Custom Resource Created with Correct Properties', () => {
        template.resourceCountIs('AWS::CloudFormation::CustomResource', 1);
        template.hasResourceProperties('AWS::CloudFormation::CustomResource', {
            ServiceToken: {
                'Fn::GetAtt': [ Match.stringLikeRegexp('^MyTestConstructSetEnvVarCrProviderframeworkonEvent*'), 'Arn' ]
            },
            FunctionName: { Ref: stack.getLogicalId(targetLambda.node.defaultChild as cdk.CfnElement) },
            EnvironmentVariables: {
                TRANSLATION_STATE_MACHINE_ARN: { Ref: stack.getLogicalId(stateMachine.node.defaultChild as cdk.CfnElement) }
            }
        });
    });

    test('Provider Lambda Role Has UpdateFunctionConfiguration Policy', () => {
        const inputProviderLambdaRoleLogicalId = stack.getLogicalId(providerLambda.role?.node.defaultChild as cdk.CfnElement);
        const targetLambdaLogicalId = stack.getLogicalId(targetLambda.node.defaultChild as cdk.CfnElement);

        template.hasResourceProperties('AWS::IAM::Policy', {
            PolicyDocument: {
                Statement: Match.arrayWith([
                    Match.objectLike({
                        Action: 'lambda:UpdateFunctionConfiguration',
                        Effect: 'Allow',
                        Resource: { 'Fn::GetAtt': [ targetLambdaLogicalId, 'Arn' ] }
                    })
                ])
            },
            Roles: [ { Ref: inputProviderLambdaRoleLogicalId } ]
        });
    });

    test('Custom Resource DependsOn Provider Function and Roles', () => {
        const crLogicalId = Object.keys(template.findResources('AWS::CloudFormation::CustomResource'))[0];
        const providerFunctionLogicalId = Object.keys(template.findResources('AWS::Lambda::Function')).find(id => id.includes('SetEnvVarCrProviderframeworkonEvent'));
        const providerFunctionRoleLogicalId = template.findResources('AWS::Lambda::Function')[providerFunctionLogicalId as string].Properties.Role['Fn::GetAtt'][0];

        expect(crLogicalId).toBeDefined();
        expect(providerFunctionLogicalId).toBeDefined();
        expect(providerFunctionRoleLogicalId).toBeDefined();

        template.hasResource('AWS::CloudFormation::CustomResource', {
            DependsOn: Match.arrayWith([
                providerFunctionLogicalId as string,
                providerFunctionRoleLogicalId as string,
            ]),
            Properties: Match.anyValue(),
        });
    });

});