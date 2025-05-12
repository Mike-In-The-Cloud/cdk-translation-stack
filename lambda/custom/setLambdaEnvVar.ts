import { CloudFormationCustomResourceEvent, CloudFormationCustomResourceResponse } from 'aws-lambda';
import { LambdaClient, UpdateFunctionConfigurationCommand } from '@aws-sdk/client-lambda';

const lambdaClient = new LambdaClient({});

export const handler = async (event: CloudFormationCustomResourceEvent): Promise<CloudFormationCustomResourceResponse> => {
    console.log('Event: ', JSON.stringify(event));
    const { RequestType, ResourceProperties } = event;
    const { FunctionName, EnvironmentVariables } = ResourceProperties;

    const physicalResourceId = `${FunctionName}-env-updater`;
    let responseStatus: CloudFormationCustomResourceResponse['Status'] = 'SUCCESS';
    let responseData: CloudFormationCustomResourceResponse['Data'] = {};

    try {
        if (RequestType === 'Create' || RequestType === 'Update') {
            console.log(`Updating environment variables for ${FunctionName}`);
            const command = new UpdateFunctionConfigurationCommand({
                FunctionName: FunctionName,
                Environment: {
                    Variables: EnvironmentVariables
                }
            });
            const updateResponse = await lambdaClient.send(command);
            console.log('Update Response:', updateResponse);
            responseData = {
                Result: `Successfully updated environment for ${FunctionName}`
            };
        } else if (RequestType === 'Delete') {
            // No action needed on delete, environment variables are part of the function
            console.log(`Delete request for ${FunctionName}, no action taken.`);
            responseData = {
                Result: `Delete request processed for ${FunctionName}, no action taken.`
            };
        }
    } catch (error) {
        console.error('Error processing custom resource:', error);
        responseStatus = 'FAILED';
        responseData = {
            Error: error instanceof Error ? error.message : String(error)
        };
    }

    return {
        Status: responseStatus,
        Reason: responseData.Error ? `See CloudWatch Log Stream: ${process.env.AWS_LAMBDA_LOG_STREAM_NAME}` : 'Success',
        PhysicalResourceId: physicalResourceId,
        StackId: event.StackId,
        RequestId: event.RequestId,
        LogicalResourceId: event.LogicalResourceId,
        Data: responseData
    };
};