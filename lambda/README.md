# Lambda Functions

This directory contains the source code for all AWS Lambda functions used in the CDK Translation System stack. It is organized into two main subdirectories: `custom` and `functions`.

## `custom/` Directory

This directory holds the code for Lambda functions that back **AWS CloudFormation Custom Resources**. Custom Resources are used to perform actions during CloudFormation stack deployment that are not natively supported by CloudFormation resource types, such as making specific API calls or managing resources in ways CloudFormation doesn't directly handle.

### Files in `custom/`:

-   **`cfn-response.js`**:
    -   **Purpose:** A standard, required utility module for CloudFormation Custom Resources.
    -   **Details:** This module provides a `send` function that formats and sends the mandatory SUCCESS or FAILED response back to the CloudFormation service URL provided in the Lambda event. This signal tells CloudFormation whether the custom resource operation completed successfully or encountered an error, allowing the stack deployment to proceed or roll back accordingly. It is used by the other custom resource handlers in this directory.
-   **`cfn-response.d.ts`**:
    -   **Purpose:** TypeScript declaration file for `cfn-response.js`.
    -   **Details:** Provides type definitions for the JavaScript module, allowing TypeScript code (like our handlers) to use it with type safety and autocompletion.
-   **`grantPermissions.ts`**:
    -   **Purpose:** Handler for a Custom Resource designed to break cyclic dependencies during CloudFormation synthesis.
    -   **Details:** This function is invoked during stack deployment. It uses the AWS SDK (`@aws-sdk/client-iam`) to attach specific IAM policies (`states:StartExecution`, `lambda:InvokeFunction`) to the roles of the `DocumentProcessor` Lambda and the Step Functions State Machine *after* those primary resources have been created. This avoids the synthesis-time circular dependency where each resource needs permission related to the other before the other exists in the template. It handles Create, Update, and Delete events from CloudFormation.
-   **`setLambdaEnvVar.ts`**:
    -   **Purpose:** Handler for a Custom Resource that sets an environment variable on a target Lambda function.
    -   **Details:** This function is invoked during stack deployment. It receives the ARN of the Step Functions State Machine and the name of the target Lambda function (`DocumentProcessor`). It uses the AWS SDK (`@aws-sdk/client-lambda`) to update the target Lambda's configuration, specifically setting the `TRANSLATION_STATE_MACHINE_ARN` environment variable. This allows the `DocumentProcessor` Lambda to know which State Machine to start at runtime. It handles Create, Update, and Delete events (though Delete might be a no-op).

## `functions/` Directory

This directory contains the source code for the core **application logic** Lambda functions. These functions perform the main tasks of the translation workflow.

### Files in `functions/`:

-   **`documentProcessor.ts`**:
    -   **Purpose:** Entry point for the workflow, triggered by S3 uploads to the documents bucket.
    -   **Details:** Validates the input document (e.g., checks format, size). Splits the document into processable sections (if necessary). Gathers required metadata. Starts the Step Functions State Machine execution, passing the document details (bucket, key, sections, languages) as input.
-   **`translationProcessor.ts`**:
    -   **Purpose:** Translates individual sections of a document.
    -   **Details:** Invoked by the State Machine's Map state. Receives a document section and language information. Uses Amazon Bedrock (via AWS SDK) to perform the translation. May also interact with Amazon OpenSearch Serverless to retrieve relevant embeddings from the translation memory (TMX) to potentially improve translation quality or consistency (RAG pattern). Returns the translated section.
-   **`tmxProcessor.ts`**:
    -   **Purpose:** Processes Translation Memory eXchange (TMX) files uploaded to the TMX bucket.
    -   **Details:** Triggered by S3 uploads to the TMX bucket. Parses the TMX file. Generates embeddings for the source/target text segments using Amazon Bedrock (via AWS SDK). Indexes these embeddings into the Amazon OpenSearch Serverless collection for later retrieval by the `translationProcessor`.
-   **`documentCombiner.ts`**:
    -   **Purpose:** Reassembles the translated document sections into a single output file.
    -   **Details:** Invoked by the State Machine after the Map state completes. Receives the results from all `translationProcessor` invocations (the translated sections). Combines these sections in the correct order. Writes the final translated document back to an S3 bucket (likely the documents bucket with a modified key/prefix).
-   **`notificationSender.ts`**:
    -   **Purpose:** Sends a notification (e.g., email) upon completion or failure of the translation workflow.
    -   **Details:** Invoked as the final step (or in error paths) of the State Machine. Receives context about the completed workflow (e.g., output document location, status). Uses Amazon Simple Email Service (SES) (via AWS SDK) to send a notification email (if configured).