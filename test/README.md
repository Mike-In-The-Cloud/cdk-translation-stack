# Testing AWS CDK Translation System

This directory contains tests for the AWS CDK Translation System. Our testing strategy includes unit tests for individual components (Constructs, Lambda handlers, configuration) and integration tests for the assembled CloudFormation stack.

## Test Structure

The tests are organized into the following directories:

-   **`test/constructs/`**: Unit tests for individual CDK Constructs (e.g., `LambdaConstruct`, `StateMachineConstruct`). These tests focus on validating the AWS resources defined within each construct and their configurations (IAM roles, permissions, environment variables, etc.) using CDK's testing utilities.
-   **`test/lambda/`**: Unit tests for the internal logic of individual Lambda function handlers (e.g., `documentProcessor.handler`). These tests focus on the function's behavior given specific inputs, mocking interactions with AWS services using Jest mocks or libraries like `aws-sdk-client-mock`.
-   **`test/infrastructure/`**: Integration tests for the main CDK Stack (`TypescriptStack`). These tests synthesize the entire stack into a CloudFormation template and validate the overall structure, resource counts, interactions between constructs, configuration rules, and perform snapshot testing.
-   **`test/unit/`**: Unit tests for non-construct, non-lambda utility modules, such as configuration loading (`config.test.ts`).

*(The `test/mocks/` directory has been removed as the strategy shifted away from extensive CDK object mocking).*

## Running Tests

To run all tests:

```bash
npm test
```

To run tests for a specific construct (e.g., `LambdaConstruct`):

```bash
npm test -- test/constructs/lambda.test.ts
```

To run tests for a specific Lambda handler (e.g., `tmxProcessor`):

```bash
npm test -- test/lambda/tmxProcessor.test.ts
```

To run the stack integration tests:

```bash
npm test -- test/infrastructure/typescript-stack.test.ts
```

To update integration test snapshots:

```bash
npm test -- test/infrastructure/typescript-stack.test.ts -u
```

To run tests with code coverage analysis:

```bash
npm test -- --coverage
```

## Testing Strategies

### 1. CDK Construct Testing (`test/constructs/`)

-   **Goal:** Verify that each CDK Construct synthesizes the correct AWS resources with the expected properties and permissions *as defined in CloudFormation*.
-   **Method:**
    -   Instantiate the construct within a minimal test `cdk.Stack`.
    -   Use **minimal real CDK resources** (e.g., `new lambda.Function(...)`, `new sfn.StateMachine(...)`) as inputs (props) when testing interactions between constructs, rather than deep mocking CDK object interfaces. This helps avoid brittle mocks and tests the actual integration points more effectively.
    -   Generate a CloudFormation template from the test stack using `Template.fromStack()`.
    -   Use assertions from `aws-cdk-lib/assertions` (`template.resourceCountIs`, `template.hasResourceProperties`, `Match` objects) to validate the synthesized resources, their properties, IAM policies, environment variables, etc.
-   **Scope:** Tests the *infrastructure definition*, not the runtime behavior of the resources (e.g., it doesn't invoke the actual Lambda code).

### 2. Lambda Handler Unit Testing (`test/lambda/`)

-   **Goal:** Verify the internal logic of the code running inside each Lambda function handler, isolated from actual AWS services.
-   **Method:**
    -   Import the handler function directly into the test file.
    -   Use **mocking** to simulate interactions with AWS SDKs (v2 and v3) and other external dependencies.
        -   **AWS SDK v2:** Often uses `jest.mock('aws-sdk', ...)`. Remember to mock the `.promise()` pattern commonly used (see v2 example below).
        -   **AWS SDK v3:** Use `jest.mock('@aws-sdk/client-xxx', ...)` to mock specific clients and their `send` methods, or use libraries like `aws-sdk-client-mock` for potentially simpler v3 mocking.
    -   Invoke the handler with mock `event` and `context` objects.
    -   Assert the handler's return value, error handling, and calls made to mocked services.
-   **Scope:** Tests the *runtime logic* of the handler code in isolation. Does not test the surrounding infrastructure.

**Example (SDK v2 Mocking):**

```typescript
// Mock AWS SDK v2 before imports
jest.mock('aws-sdk', () => {
  const getObjectPromiseMock = jest.fn();
  const s3GetObjectMock = jest.fn(()=> ({ promise: getObjectPromiseMock }));
  return {
    S3: jest.fn(() => ({ getObject: s3GetObjectMock }))
  };
});
// Import S3 and handler after mocks
import { S3 } from 'aws-sdk';
import { handler } from '../../lambda/functions/someHandler'; // Your handler

// In test setup:
const s3Mock = new S3() as jest.Mocked<S3>; // Cast for type safety if needed
const getObjectMock = s3Mock.getObject as jest.Mock;
const getObjectPromise = getObjectMock().promise as jest.Mock;

// In the test case:
getObjectPromise.mockResolvedValue({ Body: 'mock data' });
await handler(mockEvent, mockContext);
expect(getObjectMock).toHaveBeenCalledWith(/* expected params */);
```

*(Note: The previous module-level mocking for `translationProcessor.test.ts` mentioned in older versions of this README was a temporary workaround and is not the recommended approach. These tests should ideally be refactored to use standard v3 client mocking techniques to test internal logic.)*

### 3. Stack Integration Testing (`test/infrastructure/`)

-   **Goal:** Verify that the complete `TypescriptStack` synthesizes correctly, including the integration between different constructs, configuration validation, and overall resource structure.
-   **Method:**
    -   Instantiate the `TypescriptStack`.
    -   Generate a CloudFormation template using `Template.fromStack()`.
    -   Use assertions (`template.resourceCountIs`, `template.hasResourceProperties`) to check high-level resource creation and key configurations.
    -   Use snapshot testing (`expect(template.toJSON()).toMatchSnapshot()`) to detect unexpected changes in the synthesized template.
    -   Test configuration validation logic by providing invalid configurations and expecting errors.
-   **Scope:** Tests the final CloudFormation template generated by CDK. Does not test deployed resources or runtime behavior.

## Adding New Tests

1.  **New CDK Construct:** Add a corresponding test file in `test/constructs/`. Follow the "CDK Construct Testing" strategy.
2.  **New Lambda Function:**
    -   Add a handler unit test file in `test/lambda/`. Follow the "Lambda Handler Unit Testing" strategy, choosing appropriate SDK mocking.
    -   Ensure the Lambda is included in the relevant Construct test in `test/constructs/` to verify its infrastructure definition (role, env vars, permissions).
    -   Update integration tests in `test/infrastructure/` if the Lambda significantly changes the stack structure or resource counts.
3.  **New Configuration/Utility:** Add a test file in `test/unit/`.