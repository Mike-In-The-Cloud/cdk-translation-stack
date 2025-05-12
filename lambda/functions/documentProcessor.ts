import { S3Event } from 'aws-lambda';
// import { S3, StepFunctions } from 'aws-sdk'; // REMOVED v2
import { S3Client, HeadObjectCommand } from '@aws-sdk/client-s3';
import { SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';

// const s3 = new S3(); // REMOVED v2
// const stepFunctions = new StepFunctions(); // REMOVED v2

const s3Client = new S3Client({});
const sfnClient = new SFNClient({});

const stateMachineArn = process.env.TRANSLATION_STATE_MACHINE_ARN;
if (!stateMachineArn) {
  throw new Error('TRANSLATION_STATE_MACHINE_ARN environment variable not set.');
}

export const handler = async (event: S3Event): Promise<void> => {
  try {
    for (const record of event.Records) {
      const bucket = record.s3.bucket.name;
      const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));

      // Get the document metadata using S3 v3
      const headObjectCmd = new HeadObjectCommand({ Bucket: bucket, Key: key });
      const documentMetadata = await s3Client.send(headObjectCmd);
      // const documentMetadata = await s3.headObject({ Bucket: bucket, Key: key }).promise(); // REMOVED v2

      const contentType = documentMetadata.ContentType;

      // Basic validation
      if (!contentType?.includes('text') &&
          !contentType?.includes('application/pdf') &&
          !contentType?.includes('application/msword') &&
          !contentType?.includes('application/vnd.openxmlformats-officedocument')) {
        throw new Error(`Unsupported file type: ${contentType}`);
      }

      // Start Step Functions execution using SFN v3
      const startExecutionCmd = new StartExecutionCommand({
        stateMachineArn: stateMachineArn,
        input: JSON.stringify({
          bucket,
          key,
          contentType: contentType,
          documentId: key.split('/').pop()?.split('.')[0] || 'unknown',
          timestamp: new Date().toISOString()
        })
      });
      await sfnClient.send(startExecutionCmd);
      // await stepFunctions.startExecution({ ... }).promise(); // REMOVED v2

      console.log('Started translation workflow for:', {
        bucket,
        key,
        contentType: contentType
      });
    }
  } catch (error) {
    console.error('Error processing document:', error);
    // Re-throw the error to indicate failure to Lambda
    throw error;
  }
};