// import { S3 } from 'aws-sdk'; // REMOVED v2
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { Context } from 'aws-lambda';

// const s3 = new S3(); // REMOVED v2
const s3Client = new S3Client({});

interface TranslatedSection {
  sectionId: number;
  translatedText: string;
  confidence: number;
}

interface CombinerRequest {
  bucket: string;
  originalKey: string;
  translatedSections: TranslatedSection[];
  metadata: {
    sourceLanguage: string;
    targetLanguage: string;
    documentId: string;
  };
}

export const handler = async (event: CombinerRequest, context: Context): Promise<any> => {
  try {
    // Sort sections by their ID to maintain document order
    const sortedSections = event.translatedSections.sort((a, b) => a.sectionId - b.sectionId);

    // Combine all translated sections
    const combinedText = sortedSections
      .map(section => section.translatedText)
      .join('\n\n');

    // Calculate overall confidence score
    const averageConfidence = sortedSections.reduce((sum, section) => sum + section.confidence, 0) / sortedSections.length;

    // Generate the output key
    const outputKey = `translated/${event.metadata.documentId}_${event.metadata.targetLanguage}.txt`;

    // Store the combined document using S3 v3
    const putObjectCmd = new PutObjectCommand({
      Bucket: event.bucket,
      Key: outputKey,
      Body: combinedText,
      ContentType: 'text/plain',
      Metadata: {
        'source-language': event.metadata.sourceLanguage,
        'target-language': event.metadata.targetLanguage,
        'confidence-score': averageConfidence.toString(),
        'original-document': event.originalKey
      }
    });
    await s3Client.send(putObjectCmd);
    // await s3.putObject({ ... }).promise(); // REMOVED v2

    return {
      bucket: event.bucket,
      key: outputKey,
      confidence: averageConfidence,
      metadata: {
        sourceLanguage: event.metadata.sourceLanguage,
        targetLanguage: event.metadata.targetLanguage,
        documentId: event.metadata.documentId,
        sections: sortedSections.length
      }
    };

  } catch (error) {
    console.error('Error combining document sections:', error);
    throw error;
  }
};