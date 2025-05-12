import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as stepfunctions from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as lambda from 'aws-cdk-lib/aws-lambda'; // Import lambda types
import * as iam from 'aws-cdk-lib/aws-iam'; // Import iam types

export interface StateMachineConstructProps {
  // Accept individual functions instead of the whole construct
  readonly documentProcessorLambda: lambda.IFunction;
  readonly translationProcessorLambda: lambda.IFunction;
  readonly documentCombinerLambda: lambda.IFunction;
  readonly notificationSenderLambda?: lambda.IFunction; // Optional
  // REMOVE: readonly role?: iam.IRole; // Role is now handled externally
}

export class StateMachineConstruct extends Construct {
  // Expose the definition, not the state machine resource
  public readonly definition: stepfunctions.IChainable;
  // REMOVE: public readonly stateMachine: stepfunctions.StateMachine;

  constructor(scope: Construct, id: string, props: StateMachineConstructProps) {
    super(scope, id);

    // Use the specific lambda props
    const {
      documentProcessorLambda,
      translationProcessorLambda,
      documentCombinerLambda,
      notificationSenderLambda
    } = props;

    // --- Step Functions workflow definition ---
    const validateDocument = new tasks.LambdaInvoke(this, 'ValidateDocument', {
      lambdaFunction: documentProcessorLambda, // Use prop
      outputPath: '$.Payload',
    });

    const translateSection = new tasks.LambdaInvoke(this, 'TranslateSection', {
      lambdaFunction: translationProcessorLambda, // Use prop
      inputPath: '$',
      outputPath: '$.Payload',
    });

    const combineDocuments = new tasks.LambdaInvoke(this, 'CombineDocuments', {
      lambdaFunction: documentCombinerLambda, // Use prop
      inputPath: '$',
      outputPath: '$.Payload',
    });

    // Map state to process sections in parallel
    const mapState = new stepfunctions.Map(this, 'MapState', {
        maxConcurrency: 5, // Example concurrency limit
        itemsPath: stepfunctions.JsonPath.stringAt('$.documentSections'), // Assumes validateDocument outputs { ..., documentSections: [...] }
        inputPath: '$', // Pass the full input to the Map state iterations
        parameters: { // Define input for each iteration (translateSection lambda)
            "bucket.$'": '$.bucket', // Pass bucket from original input
            "key.$'": '$.key', // Pass key from original input
            "sourceLanguage.$'": '$.sourceLanguage', // Pass sourceLanguage from original input
            "targetLanguage.$'": '$.targetLanguage', // Pass targetLanguage from original input
            "section.$'": stepfunctions.JsonPath.stringAt('$$.Map.Item.Value') // Pass the current item from itemsPath
        },
        resultPath: '$.translatedSections' // Collect results under this key
    });
    mapState.iterator(translateSection); // Define the task to run for each item


    let workflowDefinition = stepfunctions.Chain.start(validateDocument)
      .next(mapState) // Use Map state instead of Parallel
      .next(combineDocuments);

    // --- Handle Optional Notification Sender in Workflow ---
    if (notificationSenderLambda) { // Check the specific optional prop
      const sendNotification = new tasks.LambdaInvoke(this, 'SendNotification', {
        lambdaFunction: notificationSenderLambda, // Use prop
        inputPath: '$', // Pass the output of combineDocuments
      });
      // Chain notification after combineDocuments
      // Make sure combineDocuments returns necessary info for notification
      workflowDefinition = workflowDefinition.next(sendNotification);
    }

    // Assign the final definition chain to the public property
    this.definition = workflowDefinition;

    // REMOVE: State Machine creation logic
    // const stateMachineName = `${cdk.Aws.STACK_NAME}-TranslationWorkflow`;
    // this.stateMachine = new stepfunctions.StateMachine(this, 'TranslationStateMachine', {
    //   stateMachineName: stateMachineName,
    //   definitionBody: stepfunctions.DefinitionBody.fromChainable(workflowDefinition),
    //   role: props.role, // Use passed role or let it create one
    // });
  }
}