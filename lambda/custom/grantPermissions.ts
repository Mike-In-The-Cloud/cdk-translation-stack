import { IAMClient, PutRolePolicyCommand, GetRolePolicyCommand, DeleteRolePolicyCommand } from "@aws-sdk/client-iam";
import { CloudFormationCustomResourceEvent, Context } from 'aws-lambda';

// Use require for CommonJS module cfn-response.js
const cfnResponse = require('./cfn-response');

const iamClient = new IAMClient({});

interface GrantPermissionsProps {
  ServiceToken?: string; // Provided by CDK, might be missing on failed delete
  LambdaRoleArn: string;
  StateMachineRoleArn: string;
  StateMachineArn: string;
  TargetLambdaArns: string[]; // Arns of lambdas the state machine needs to invoke
}

// Define policy names to manage them consistently
const LAMBDA_START_EXECUTION_POLICY_NAME = 'LambdaStartExecutionPolicy';
const STATEMACHINE_INVOKE_LAMBDA_POLICY_NAME = 'StateMachineInvokeLambdaPolicy';

export const handler = async (event: CloudFormationCustomResourceEvent, context: Context): Promise<void> => {
    console.log("Request:", JSON.stringify(event, undefined, 2));
    const responseData: { [key: string]: any } = {};
    let physicalResourceId = event.RequestType === 'Create' ? context.logStreamName : event.PhysicalResourceId;

    try {
        const props = event.ResourceProperties as GrantPermissionsProps;
        const lambdaRoleName = props.LambdaRoleArn?.split('/')?.pop();
        const smRoleName = props.StateMachineRoleArn?.split('/')?.pop();

        if (event.RequestType === 'Create' || event.RequestType === 'Update') {
            if (!lambdaRoleName || !smRoleName || !props.StateMachineArn || !props.TargetLambdaArns) {
                throw new Error('Missing required properties for Create/Update event');
            }
            console.log('Applying policies...');
            physicalResourceId = `${props.LambdaRoleArn}-${props.StateMachineRoleArn}-perms`;

            // Policy for Lambda to start State Machine
            const startExecutionPolicy = {
                Version: '2012-10-17',
                Statement: [
                    {
                        Effect: 'Allow',
                        Action: 'states:StartExecution',
                        Resource: props.StateMachineArn,
                    },
                ],
            };
            await iamClient.send(new PutRolePolicyCommand({
                RoleName: lambdaRoleName,
                PolicyName: LAMBDA_START_EXECUTION_POLICY_NAME,
                PolicyDocument: JSON.stringify(startExecutionPolicy),
            }));
            console.log(`Applied ${LAMBDA_START_EXECUTION_POLICY_NAME} to ${lambdaRoleName}`);

            // Policy for State Machine to invoke Lambdas
            const invokeLambdaPolicy = {
                Version: '2012-10-17',
                Statement: [
                    {
                        Effect: 'Allow',
                        Action: 'lambda:InvokeFunction',
                        Resource: props.TargetLambdaArns,
                    },
                ],
            };
            await iamClient.send(new PutRolePolicyCommand({
                RoleName: smRoleName,
                PolicyName: STATEMACHINE_INVOKE_LAMBDA_POLICY_NAME,
                PolicyDocument: JSON.stringify(invokeLambdaPolicy),
            }));
            console.log(`Applied ${STATEMACHINE_INVOKE_LAMBDA_POLICY_NAME} to ${smRoleName}`);

            responseData['Message'] = 'Permissions granted successfully.';
            await cfnResponse.send(event, context, cfnResponse.SUCCESS, responseData, physicalResourceId);

        } else if (event.RequestType === 'Delete') {
            if (!lambdaRoleName || !smRoleName) {
                console.warn("Role names not found, cannot delete policies. This might happen if create failed.");
                await cfnResponse.send(event, context, cfnResponse.SUCCESS, { Message: "Skipping delete as role names are missing." }, physicalResourceId);
                return;
            }
            console.log('Deleting policies...');
            try {
                await iamClient.send(new DeleteRolePolicyCommand({
                    RoleName: lambdaRoleName,
                    PolicyName: LAMBDA_START_EXECUTION_POLICY_NAME
                }));
                console.log(`Deleted ${LAMBDA_START_EXECUTION_POLICY_NAME} from ${lambdaRoleName}`);
            } catch (error: any) {
                if (error.name === 'NoSuchEntityException') {
                    console.log(`Policy ${LAMBDA_START_EXECUTION_POLICY_NAME} not found on ${lambdaRoleName}, skipping deletion.`);
                } else {
                    console.error(`Error deleting ${LAMBDA_START_EXECUTION_POLICY_NAME}:`, error);
                }
            }
            try {
                await iamClient.send(new DeleteRolePolicyCommand({
                    RoleName: smRoleName,
                    PolicyName: STATEMACHINE_INVOKE_LAMBDA_POLICY_NAME
                }));
                console.log(`Deleted ${STATEMACHINE_INVOKE_LAMBDA_POLICY_NAME} from ${smRoleName}`);
            } catch (error: any) {
                if (error.name === 'NoSuchEntityException') {
                    console.log(`Policy ${STATEMACHINE_INVOKE_LAMBDA_POLICY_NAME} not found on ${smRoleName}, skipping deletion.`);
                } else {
                    console.error(`Error deleting ${STATEMACHINE_INVOKE_LAMBDA_POLICY_NAME}:`, error);
                }
            }
            responseData['Message'] = 'Delete policies attempted.';
            await cfnResponse.send(event, context, cfnResponse.SUCCESS, responseData, physicalResourceId);
        }

        console.log("CFN Response: Completed - Status: SUCCESS (potentially, check logs)");

    } catch (error: any) {
        console.error("Error:", error);
        const pid = physicalResourceId ?? context.logStreamName;
        responseData['Error'] = error.message || 'Failed to process event';
        await cfnResponse.send(event, context, cfnResponse.FAILED, responseData, pid);
        console.log("CFN Response: Completed - Status: FAILED");
    }
};

// cfn-response.js (needs to be created/copied into the lambda/custom directory)
// This is a standard module for sending responses back to CloudFormation for custom resources.
// You can find versions online or use the one potentially generated by CDK custom resource constructs previously.
// Example content:
/*
exports.SUCCESS = "SUCCESS";
exports.FAILED = "FAILED";

exports.send = function(event, context, responseStatus, responseData, physicalResourceId, noEcho) {

  var responseBody = JSON.stringify({
    Status: responseStatus,
    Reason: "See the details in CloudWatch Log Stream: " + context.logStreamName,
    PhysicalResourceId: physicalResourceId || context.logStreamName,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    NoEcho: noEcho || false,
    Data: responseData
  });

  console.log("Response body:\\n", responseBody);

  var https = require("https");
  var url = require("url");

  var parsedUrl = url.parse(event.ResponseURL);
  var options = {
    hostname: parsedUrl.hostname,
    port: 443,
    path: parsedUrl.path,
    method: "PUT",
    headers: {
      "content-type": "",
      "content-length": responseBody.length
    }
  };

  var request = https.request(options, function(response) {
    console.log("Status code: " + response.statusCode);
    console.log("Status message: " + response.statusMessage);
    context.done();
  });

  request.on("error", function(error) {
    console.log("send(..) failed executing https.request(..): " + error);
    context.done();
  });

  request.write(responseBody);
  request.end();
};
*/