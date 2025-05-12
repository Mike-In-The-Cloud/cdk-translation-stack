import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as custom_resources from 'aws-cdk-lib/custom-resources';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import { Construct } from 'constructs';

export interface GrantPermissionsCustomResourceProps {
  readonly lambdaToGrantStartExecution: lambda.IFunction; // e.g., DocumentProcessor
  readonly stateMachineToGrantInvoke: stepfunctions.IStateMachine;
  readonly stateMachineRoleToGrantInvoke: iam.IRole;
  readonly lambdasToInvokeByStateMachine: lambda.IFunction[];
  readonly customResourceProviderLambda: lambda.IFunction; // The grantPermissions lambda
}

export class GrantPermissionsCustomResource extends Construct {
  constructor(scope: Construct, id: string, props: GrantPermissionsCustomResourceProps) {
    super(scope, id);

    // Custom Resource properties to pass to the grantPermissionsLambda
    const customResourceProps = {
      LambdaRoleArn: props.lambdaToGrantStartExecution.role!.roleArn, // Role of the Lambda needing StartExecution
      StateMachineRoleArn: props.stateMachineRoleToGrantInvoke.roleArn, // Role of the State Machine needing InvokeFunction
      StateMachineArn: props.stateMachineToGrantInvoke.stateMachineArn,
      TargetLambdaArns: props.lambdasToInvokeByStateMachine.map(fn => fn.functionArn),
    };

    // Custom Resource Provider
    const provider = new custom_resources.Provider(this, 'GrantPermsCrProvider', {
      onEventHandler: props.customResourceProviderLambda,
      // Ensure the log group for the provider lambda exists or can be created.
      // By default, CDK creates a log group. If managing manually, ensure it has a retention policy.
    });

    // Custom Resource
    const grantPermsCustomResource = new cdk.CustomResource(this, 'GrantPermsCr', {
      serviceToken: provider.serviceToken,
      properties: customResourceProps,
    });

    // Dependencies for the Custom Resource
    // Ensures the roles and functions exist before trying to update their policies.
    grantPermsCustomResource.node.addDependency(props.lambdaToGrantStartExecution.role!);
    grantPermsCustomResource.node.addDependency(props.stateMachineRoleToGrantInvoke);
    grantPermsCustomResource.node.addDependency(props.stateMachineToGrantInvoke);
    props.lambdasToInvokeByStateMachine.forEach(fn => grantPermsCustomResource.node.addDependency(fn));

    // Ensures the CR provider lambda and its role are created before the CR tries to use it.
    grantPermsCustomResource.node.addDependency(props.customResourceProviderLambda);
    if (props.customResourceProviderLambda.role) {
        grantPermsCustomResource.node.addDependency(props.customResourceProviderLambda.role);
    }
    grantPermsCustomResource.node.addDependency(provider);
  }
}