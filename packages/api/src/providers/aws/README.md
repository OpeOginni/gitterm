# AWS Provider Implementation

The AWS provider runs GitTerm workspaces on AWS using `ECS` with `Fargate`, a shared `ALB`, and optional `EFS` for persistent workspaces.

This README is implementation-focused. It explains:

- which AWS services are used
- what GitTerm stores in its own database
- the exact flow for infra setup, workspace creation, pause/stop, restart, and termination

## High-Level Model

GitTerm uses two layers of resources for AWS:

- shared provider infrastructure created once per region
- per-workspace resources created and deleted for each workspace

Shared infrastructure is either:

- entered manually in the provider config
- created by GitTerm simple setup through CloudFormation

Per-workspace resources are created directly by the AWS provider implementation in `packages/api/src/providers/aws/index.ts`.

## Services And Responsibilities

### GitTerm services

- Admin AWS router: `packages/api/src/routers/aws/index.ts`
  Handles AWS simple setup and shared-infra deletion.
- Workspace management router: `packages/api/src/routers/workspace/managment.ts`
  Handles create, stop, restart, terminate, and exposed-port operations.
- AWS provider: `packages/api/src/providers/aws/index.ts`
  Talks to AWS APIs and manages per-workspace ECS, ALB, and EFS resources.
- AWS setup helper: `packages/api/src/providers/aws/setup.ts`
  Builds and applies the CloudFormation stack used by simple setup.
- AWS reconcile job: `packages/api/src/providers/aws/reconcile.ts`
  Retries unfinished cleanup and removes orphaned AWS resources.
- Workspace route access service: `packages/api/src/service/workspace-route-access.ts`
  Stores encrypted upstream headers GitTerm must inject when proxying traffic to the shared ALB.

### AWS services

- `STS`
  Resolves the AWS account ID during simple setup.
- `CloudFormation`
  Creates and deletes the shared AWS infrastructure stack for simple setup.
- `EC2`
  Finds the default VPC and public subnets during simple setup, and resolves task ENI IPs for exposed ports.
- `ECS`
  Runs each workspace as a Fargate service and task definition.
- `Elastic Load Balancing v2 (ALB)`
  Provides one shared listener and per-workspace listener rules and target groups.
- `EFS`
  Provides persistent workspace storage through per-workspace access points.
- `CloudWatch Logs`
  Receives ECS container logs when `logGroupName` is configured.
- `IAM`
  Provides the ECS task execution role and task role. The GitTerm control plane also needs an IAM user or credentials with AWS API access.

## Setup Modes

The provider supports two modes:

- manual setup, where every AWS resource is entered in the provider config
- simple setup, where GitTerm creates the shared infrastructure for you

## What Simple Setup Actually Creates

Simple setup lives in `packages/api/src/providers/aws/setup.ts` and creates one CloudFormation stack named like `gitterm-<region>`.

It requires:

- a default VPC in the selected region
- at least two public subnets in different availability zones in that VPC

The stack creates:

- one ECS cluster
- one internet-facing ALB
- one HTTP listener on port `80`
- one ALB security group
- one workspace security group
- one EFS security group
- one ECS task execution role named `gitterm-task-execution`
- one ECS task role named `gitterm-task`
- one CloudWatch log group at `/gitterm/workspaces`
- one EFS filesystem
- one EFS mount target per selected subnet

Simple setup then saves the resolved values back into the GitTerm provider config and:

- enables the provider config
- disables user region selection for AWS
- enables only the selected default region in the GitTerm `region` table

Important implementation details:

- simple setup sets `assignPublicIp=true`
- simple setup stores `albBaseUrl` as `http://<alb-dns-name>`
- the shared ALB is plain HTTP in the current implementation

## Provider Config Fields

The AWS provider config is defined in:

- `packages/schema/src/provider-registry.ts`
- `packages/api/src/providers/aws/types.ts`

Current fields:

- `accessKeyId`
- `secretAccessKey`
- `defaultRegion`
- `clusterArn`
- `vpcId`
- `subnetIds`
- `securityGroupIds`
- `albListenerArn`
- `albBaseUrl`
- `taskExecutionRoleArn`
- `taskRoleArn`
- `assignPublicIp` optional
- `efsFileSystemId` optional
- `logGroupName` optional

## Shared Versus Per-Workspace Resources

Shared resources are reused by all AWS workspaces:

- ECS cluster
- ALB listener
- VPC
- subnets
- security groups
- task roles
- optional shared EFS filesystem
- optional CloudWatch log group

Per-workspace resources are created dynamically:

- one ECS task definition
- one ECS service
- one main ALB target group
- one main ALB listener rule
- one EFS access point for persistent workspaces
- one extra target group and listener rule per exposed port

GitTerm tags these AWS resources with `ManagedBy=gitterm`, `WorkspaceId=<id>`, and a resource kind so cleanup can find them later.

## Routing Model

AWS workspaces do not get their own DNS records inside AWS.

Instead, GitTerm:

- sends traffic to the shared `albBaseUrl`
- injects `X-GitTerm-Aws-Routing-Key`
- uses that header to match an ALB listener rule
- forwards traffic from the matched rule to the workspace target group

The AWS provider creates internal routing values like:

- `<workspaceId>.workspace.aws.gitterm.internal` for the main workspace route
- `<port>-<workspaceId>.workspace.aws.gitterm.internal` for exposed ports

GitTerm stores these required upstream headers encrypted in `workspace_route_access` so the proxy layer can forward requests correctly.

## Current Runtime Behavior

AWS is configured as an `immediate` settlement provider in `packages/db/src/seed.ts` for:

- creation
- stop
- restart
- termination

That means GitTerm does not wait for provider webhooks to mark state changes. The AWS provider call itself is treated as the source of truth.

Important caveat:

- creation and restart still wait internally for ALB target health before returning success
- termination is marked complete in the GitTerm database immediately, but AWS cleanup runs in the background for this provider
- editor SSH access is not currently supported for AWS

## Lifecycle Walkthrough

### 1. Infra Setup Flow

This is the flow when an admin uses AWS simple setup:

1. The admin submits AWS credentials and a default region through the admin UI.
2. `packages/api/src/routers/aws/index.ts` calls `bootstrapAwsProvider(...)`.
3. `setup.ts` uses `STS` to resolve the AWS account ID.
4. `setup.ts` uses `EC2` to find the default VPC.
5. `setup.ts` uses `EC2` again to find at least two public subnets across AZs.
6. `setup.ts` builds a CloudFormation template and creates or updates the regional stack.
7. `CloudFormation` creates the shared ECS, ALB, IAM, logging, and EFS resources.
8. GitTerm waits for stack completion and reads the stack outputs.
9. GitTerm saves those outputs into the AWS provider config in its database.
10. GitTerm enables only the chosen AWS region for that provider.

Result:

- GitTerm now has enough shared infrastructure to create AWS workspaces on demand.

### 2. Workspace Creation Flow

This is the flow when a user creates an AWS-backed workspace:

1. `workspace/managment.ts` validates the request, image, provider, region, and quota.
2. GitTerm builds the workspace environment variables, including repo details, auth tokens, and agent config.
3. GitTerm resolves the compute provider and calls `AwsProvider.createWorkspace(...)` or `createPersistentWorkspace(...)`.
4. The AWS provider creates the main ALB target group for the workspace.
5. If the workspace is persistent, the AWS provider creates an EFS access point under `/gitterm/<workspaceId>`.
6. The AWS provider registers an ECS task definition for the selected image.
7. The AWS provider creates an ALB listener rule that matches `X-GitTerm-Aws-Routing-Key` for that workspace.
8. The AWS provider creates an ECS Fargate service with desired count `1`.
9. The AWS provider waits for the target group to become healthy.
10. The provider returns:
   - a serialized external service handle with AWS resource identifiers
   - the shared ALB URL as `upstreamUrl`
   - the routing header GitTerm must inject
   - the public GitTerm workspace domain
11. GitTerm inserts the workspace row in its own database.
12. GitTerm stores encrypted route-access headers in `workspace_route_access`.
13. If the workspace is persistent, GitTerm inserts a `volume` row containing the EFS access point ID.
14. GitTerm creates a usage session for billing/tracking.
15. GitTerm emits a workspace status event and returns success.

What is created in AWS for one workspace:

- ECS task definition
- ECS service
- ALB target group
- ALB listener rule
- optional EFS access point

What is stored in GitTerm for one workspace:

- workspace row with `externalInstanceId`, `upstreamUrl`, status, domain, and region
- optional volume row with `externalVolumeId`
- encrypted route-access headers needed to reach the shared ALB correctly

### 3. Request Flow After Creation

Once the workspace is running, request flow looks like this:

1. The user opens the GitTerm workspace domain.
2. GitTerm resolves the workspace and reads any stored route-access headers.
3. GitTerm proxies the request to `upstreamUrl`, which is the shared ALB URL.
4. GitTerm injects `X-GitTerm-Aws-Routing-Key` for that workspace.
5. The shared ALB listener matches the workspace-specific rule.
6. The ALB forwards to the workspace target group.
7. The target group sends traffic to the ECS task ENI IP.
8. The workspace container receives the request.

Exposed ports follow the same pattern, but each open port gets its own target group and listener rule.

### 4. Pause / Stop Flow

In the current AWS implementation, pause is effectively stop.

Flow:

1. `workspace/managment.ts` loads the workspace and provider.
2. GitTerm attempts to revoke editor access first, but AWS currently has no editor-access implementation.
3. GitTerm calls `AwsProvider.stopWorkspace(...)`.
4. The AWS provider sends `UpdateService` to ECS with `desiredCount=0`.
5. GitTerm closes the usage session.
6. GitTerm updates the workspace row to `status=stopped`.
7. GitTerm emits the stopped status event.

What does not get deleted on stop:

- ECS service
- task definition
- ALB listener rule
- ALB target group
- EFS access point

Only the running task is scaled down. This makes restart faster because the service wiring is still present.

### 5. Restart Flow

Flow:

1. `workspace/managment.ts` checks quota and verifies the workspace is currently stopped.
2. GitTerm calls `AwsProvider.restartWorkspace(...)`.
3. The AWS provider sends `UpdateService` to ECS with `desiredCount=1`.
4. ECS starts a new Fargate task for the existing service.
5. The AWS provider waits for the existing target group to become healthy again.
6. GitTerm updates the workspace row to `status=running` because AWS restart settlement is immediate.
7. GitTerm emits the running status event.

What is reused on restart:

- existing ECS service
- existing task definition
- existing ALB target group
- existing ALB listener rule
- existing EFS access point for persistent workspaces

### 6. Termination Flow

Termination has two layers:

- GitTerm marks the workspace terminated in its database immediately
- AWS-specific resource cleanup continues in the background

Flow:

1. `workspace/managment.ts` loads the workspace, provider, and optional volume.
2. If the workspace is running or pending, GitTerm closes the usage session.
3. GitTerm marks the workspace row as `terminated` immediately.
4. GitTerm clears exposed ports and editor connection in the database.
5. GitTerm deletes all stored route-access records.
6. If persistent, GitTerm deletes the `volume` database row.
7. GitTerm emits the terminated status event.
8. In the background, GitTerm runs AWS cleanup:
   - remove exposed-port listener rules and target groups
   - delete the main workspace listener rule
   - delete the ECS service with `force=true`
   - wait for the ECS service to become inactive
   - delete the main target group
   - deregister the task definition
   - delete the EFS access point if one exists
9. After background cleanup finishes, GitTerm clears `externalInstanceId`, `externalRunningDeploymentId`, and `upstreamUrl` from the workspace row.

This background cleanup behavior is AWS-specific in the workspace router.

### 7. Reconcile / Orphan Cleanup Flow

`packages/api/src/providers/aws/reconcile.ts` exists because background termination can fail or get interrupted.

The sweep does two things:

1. It finds terminated AWS workspaces in the database that still have an `externalInstanceId` and retries `terminateWorkspace(...)`.
2. It scans AWS directly for tagged GitTerm resources that no longer belong to active workspaces and deletes them.

The sweep can remove orphaned:

- ECS services
- ECS task definitions
- ALB listener rules
- ALB target groups
- EFS access points

This is the safety net that keeps leaked AWS resources from accumulating.

### 8. Shared Infra Deletion Flow

When an admin deletes AWS shared infrastructure:

1. `routers/aws/index.ts` verifies the provider is AWS and configured.
2. GitTerm refuses to continue if any non-terminated AWS workspaces still exist.
3. GitTerm runs the AWS cleanup sweep first.
4. GitTerm refuses to continue if any terminated workspaces still have unresolved external cleanup.
5. GitTerm calls `deleteAwsProviderInfrastructure(...)`.
6. `setup.ts` deletes the CloudFormation stack and waits for completion.
7. GitTerm disables the provider config and the cloud provider in its own database.

## Required AWS Resources For Manual Setup

If you do not use simple setup, you must provide values for the shared resources yourself.

Required:

- an ECS cluster
- a VPC
- one or more subnets usable by Fargate tasks
- one or more security groups for workspace tasks
- a shared ALB listener
- an ECS task execution role
- an ECS task role

Optional:

- an EFS filesystem for persistent workspaces
- a CloudWatch log group for ECS logs

## Field Notes

### `subnetIds`

These are used in the ECS `awsvpc` network configuration for every workspace service.

### `securityGroupIds`

These are attached to every workspace task ENI.

### `albListenerArn`

GitTerm adds one listener rule for the main workspace route and one more rule for each exposed port.

### `albBaseUrl`

This is the upstream URL GitTerm proxies to. The actual workspace selection happens through the injected routing header, not by unique AWS DNS.

### `efsFileSystemId`

If set, persistent workspaces get a dedicated EFS access point and mount it at `/workspace`.

### `logGroupName`

If set, the ECS task definition gets `awslogs` configuration.

## IAM Notes

The control-plane credentials configured in GitTerm must be able to manage:

- ECS services and task definitions
- ALB target groups and listener rules
- EFS access points when persistence is enabled
- EC2 describe calls for VPC, subnet, and ENI lookup
- CloudFormation for simple setup
- `iam:PassRole` for the configured task execution and task roles

Keep these credentials separate from the ECS task execution role and task role.

A sample policy for the control-plane IAM user lives here:

- `packages/api/src/providers/aws/iam-user-policy.json`

Sample runtime policies for a restricted demo environment live here:

- `packages/api/src/providers/aws/demo-task-role-policy.json`
- `packages/api/src/providers/aws/demo-lambda-execution-role-policy.json`
- `packages/api/src/providers/aws/demo-lambda-execution-role-trust-policy.json`

Use them like this:

- keep `iam-user-policy.json` attached to the GitTerm control-plane IAM user only
- attach `demo-task-role-policy.json` to the ECS task role used as `taskRoleArn`
- attach `demo-lambda-execution-role-policy.json` to pre-created Lambda execution roles such as `gtdemo-lambda-exec-basic`
- use `demo-lambda-execution-role-trust-policy.json` as the trust relationship for those Lambda execution roles

The demo task-role policy is intentionally scoped for a dedicated demo environment:

- Bedrock access is limited to the model ARNs you list
- S3 access is limited to buckets named `gtdemo-*`
- Lambda read, invoke, update-code, delete, and version actions are limited to functions named `gtdemo-*`
- Lambda create and update-configuration are limited by region, so use this in a dedicated demo account or further narrow it for your environment

## Important Current Limitations

- AWS editor SSH access is not implemented.
- Simple setup currently expects a default VPC and public subnets.
- Simple setup creates an HTTP ALB listener, not HTTPS.
- Termination is user-visible immediately in GitTerm, but AWS resource cleanup is asynchronous in the background.

## Example Config Values

```text
accessKeyId=AKIA...
secretAccessKey=...
defaultRegion=us-east-1
clusterArn=arn:aws:ecs:us-east-1:123456789012:cluster/gitterm
vpcId=vpc-0123456789abcdef0
subnetIds=subnet-aaa111,subnet-bbb222
securityGroupIds=sg-aaa111
albListenerArn=arn:aws:elasticloadbalancing:us-east-1:123456789012:listener/app/gitterm-alb/abc123/def456
albBaseUrl=http://gitterm-alb-123456.us-east-1.elb.amazonaws.com
taskExecutionRoleArn=arn:aws:iam::123456789012:role/gitterm-task-execution
taskRoleArn=arn:aws:iam::123456789012:role/gitterm-task
assignPublicIp=true
efsFileSystemId=fs-0123456789abcdef0
logGroupName=/gitterm/workspaces
```
