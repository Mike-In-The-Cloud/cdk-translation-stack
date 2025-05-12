// import { SES, S3 } from 'aws-sdk'; // REMOVED v2
import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Context } from 'aws-lambda';

// const ses = new SES(); // REMOVED v2
// const s3 = new S3(); // REMOVED v2
const sesClient = new SESClient({});
const s3Client = new S3Client({}); // Need S3 client for presigner

const senderEmail = process.env.SENDER_EMAIL;
if (!senderEmail) {
  throw new Error('SENDER_EMAIL environment variable not set.');
}

interface NotificationRequest {
  bucket: string;
  key: string;
  metadata: {
    sourceLanguage: string;
    targetLanguage: string;
    documentId: string;
    confidence: number;
  };
  recipientEmail: string;
}

export const handler = async (event: NotificationRequest, context: Context): Promise<void> => {
  try {
    // Generate a pre-signed URL for the translated document using S3 v3 presigner
    const getCommand = new GetObjectCommand({
      Bucket: event.bucket,
      Key: event.key
    });
    const presignedUrl = await getSignedUrl(s3Client, getCommand, {
      expiresIn: 604800 // URL expires in 7 days (seconds)
    });
    // const presignedUrl = s3.getSignedUrl('getObject', { ... }); // REMOVED v2

    // Prepare email content
    const emailParams = {
      Destination: {
        ToAddresses: [event.recipientEmail]
      },
      Message: {
        Body: {
          Html: {
            Charset: 'UTF-8',
            Data: `
              <h2>Translation Complete</h2>
              <p>Your document has been translated successfully:</p>
              <ul>
                <li>Document ID: ${event.metadata.documentId}</li>
                <li>From: ${event.metadata.sourceLanguage}</li>
                <li>To: ${event.metadata.targetLanguage}</li>
                <li>Confidence Score: ${(event.metadata.confidence * 100).toFixed(2)}%</li>
              </ul>
              <p>You can download your translated document using this link:</p>
              <p><a href="${presignedUrl}">Download Translated Document</a></p>
              <p>This link will expire in 7 days.</p>
              <p>Note: This is an automated message. Please do not reply to this email.</p>
            `
          },
          Text: {
            Charset: 'UTF-8',
            Data: `
              Translation Complete

              Your document has been translated successfully:
              - Document ID: ${event.metadata.documentId}
              - From: ${event.metadata.sourceLanguage}
              - To: ${event.metadata.targetLanguage}
              - Confidence Score: ${(event.metadata.confidence * 100).toFixed(2)}%

              You can download your translated document using this link:
              ${presignedUrl}

              This link will expire in 7 days.

              Note: This is an automated message. Please do not reply to this email.
            `
          }
        },
        Subject: {
          Charset: 'UTF-8',
          Data: `Translation Complete - ${event.metadata.documentId}`
        }
      },
      Source: senderEmail // Use validated env var
      // Source: process.env.SENDER_EMAIL! // REMOVED old access
    };

    // Send the email using SES v3
    const sendCommand = new SendEmailCommand(emailParams);
    await sesClient.send(sendCommand);
    // await ses.sendEmail(emailParams).promise(); // REMOVED v2

    console.log('Notification sent successfully to:', event.recipientEmail);
  } catch (error) {
    console.error('Error sending notification:', error);
    throw error;
  }
};