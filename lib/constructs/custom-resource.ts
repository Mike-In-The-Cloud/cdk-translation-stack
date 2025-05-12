import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as custom_resources from 'aws-cdk-lib/custom-resources';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import { Construct } from 'constructs';

export interface CustomResourceConstructProps {
  readonly targetLambdaFunction: lambda.IFunction;
  readonly stateMachine: stepfunctions.IStateMachine;
  readonly customResourceProviderLambda: lambda.IFunction; // The lambda that implements the CR logic
}

export class CustomResourceConstruct extends Construct {
  constructor(scope: Construct, id: string, props: CustomResourceConstructProps) {
    super(scope, id);

    // Policy for the CR Provider Lambda to update the target Lambda's configuration
    const updateLambdaConfigPolicy = new iam.PolicyStatement({
      actions: ['lambda:UpdateFunctionConfiguration'],
      resources: [props.targetLambdaFunction.functionArn],
    });

    if (props.customResourceProviderLambda.role) {
        props.customResourceProviderLambda.role.addToPrincipalPolicy(updateLambdaConfigPolicy);
    } else {
        // If the role is not available on the IFunction (e.g. imported function),
        // this might indicate a need for a different approach or more specific role handling.
        // For now, we proceed assuming the role is typically available for functions created in the stack.
        console.warn(`CustomResourceProviderLambda (${props.customResourceProviderLambda.functionName}) has no role attached. Cannot add updateLambdaConfigPolicy.`);
    }

    // Custom Resource properties
    const customResourceProps = {
      FunctionName: props.targetLambdaFunction.functionName,
      EnvironmentVariables: {
        TRANSLATION_STATE_MACHINE_ARN: props.stateMachine.stateMachineArn,
      },
    };

    // Custom Resource Provider
    const provider = new custom_resources.Provider(this, 'SetEnvVarCrProvider', {
      onEventHandler: props.customResourceProviderLambda,
    });

    // Custom Resource
    const setEnvVarCustomResource = new cdk.CustomResource(this, 'SetLambdaEnvVarCr', {
      serviceToken: provider.serviceToken,
      properties: customResourceProps,
    });

    // Dependencies for the Custom Resource
    // Ensures the target lambda exists before attempting to update it.
    setEnvVarCustomResource.node.addDependency(props.targetLambdaFunction);
    // Ensures the state machine exists, so its ARN is available.
    setEnvVarCustomResource.node.addDependency(props.stateMachine);
    // Ensures the CR provider lambda and its role (if applicable) are created before the CR tries to use it.
    setEnvVarCustomResource.node.addDependency(props.customResourceProviderLambda);
    if (props.customResourceProviderLambda.role) {
        setEnvVarCustomResource.node.addDependency(props.customResourceProviderLambda.role);
    }
    setEnvVarCustomResource.node.addDependency(provider); // Dependency on the provider itself
  }
}