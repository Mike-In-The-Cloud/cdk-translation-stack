import { S3Event } from 'aws-lambda';
// import { S3, BedrockRuntime } from 'aws-sdk'; // REMOVED v2
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import * as xml2js from 'xml2js';

// const s3 = new S3(); // REMOVED v2
// const bedrock = new BedrockRuntime(); // REMOVED v2
const s3Client = new S3Client({});
const bedrockClient = new BedrockRuntimeClient({});

// Validate required environment variables
const BEDROCK_EMBEDDING_MODEL = process.env.BEDROCK_EMBEDDING_MODEL;
if (!BEDROCK_EMBEDDING_MODEL) {
  throw new Error('BEDROCK_EMBEDDING_MODEL environment variable is required');
}

export const handler = async (event: S3Event): Promise<void> => {
  try {
    // Process each record in the S3 event
    for (const record of event.Records) {
      const bucket = record.s3.bucket.name;
      const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));

      // Get the TMX file from S3 using v3
      const getObjectCmd = new GetObjectCommand({ Bucket: bucket, Key: key });
      const tmxFileResponse = await s3Client.send(getObjectCmd);
      // const tmxFile = await s3.getObject({ Bucket: bucket, Key: key }).promise(); // REMOVED v2

      // The Body of GetObjectCommandOutput is a ReadableStream | Readable | Blob | undefined
      // We need to convert it to a string.
      const tmxContent = await tmxFileResponse.Body?.transformToString('utf-8');
      // const tmxContent = tmxFile.Body?.toString('utf-8'); // OLD v2 way

      if (!tmxContent) {
        throw new Error('TMX file is empty or could not be read');
      }

      // Parse TMX XML content
      const parser = new xml2js.Parser();
      const result = await parser.parseStringPromise(tmxContent);

      // Extract translation units
      const tuList = result.tmx.body[0].tu || [];

      // Process each translation unit and create embeddings
      for (const tu of tuList) {
        const sourceText = tu.tuv[0].seg[0];
        const targetText = tu.tuv[1].seg[0];

        // Create embedding using Bedrock v3
        const invokeModelCmd = new InvokeModelCommand({
          modelId: BEDROCK_EMBEDDING_MODEL,
          contentType: 'application/json',
          accept: 'application/json',
          body: JSON.stringify({
            inputText: sourceText
          })
        });
        const embeddingResponse = await bedrockClient.send(invokeModelCmd);
        // const embeddingResponse = await bedrock.invokeModel({ ... }).promise(); // REMOVED v2

        // The body from BedrockRuntimeClient.InvokeModelCommand is a Uint8Array
        const responseBodyString = new TextDecoder().decode(embeddingResponse.body);
        const parsedResponseBody = JSON.parse(responseBodyString);

        // TODO: Store the embedding and translation pair in OpenSearch
        console.log('Created embedding for:', {
          sourceText,
          targetText,
          embedding: parsedResponseBody.embedding
          // embedding: JSON.parse(embeddingResponse.body.toString()).embedding // OLD v2 way
        });
      }
    }
  } catch (error) {
    console.error('Error processing TMX file:', error);
    throw error;
  }
};