# AWS Provider

Runs GitTerm workspaces on AWS using `ECS` with `Fargate`, a shared `ALB`, and optional `EFS` for persistent workspaces.

## Quick Setup

The recommended path is simple setup. You only provide credentials and a region, and GitTerm provisions the shared infrastructure for you through CloudFormation.

Open the admin panel and set these values:

| Field               | Required | Notes                                                  |
| ------------------- | -------- | ------------------------------------------------------ |
| `Access Key ID`     | Yes      | Control-plane IAM credentials                          |
| `Secret Access Key` | Yes      | Control-plane IAM credentials                          |
| `Default Region`    | Yes      | Defaults to `us-east-1`                                |
| `Allow Public SSH`  | No       | Enable public SSH on tasks                             |
| `Task role`         | Yes      | Create a new role by name, or use an existing role ARN |

GitTerm then creates a CloudFormation stack named `gitterm-<region>` with the ECS cluster, ALB and listener, security groups, task execution role, CloudWatch log group, and EFS filesystem. The task role is created/reused separately. Resolved values are saved back into the provider config.

Requirements:

- a default VPC with at least two public subnets in the chosen region
- an IAM policy allowing CloudFormation, ECS, ALB, EFS, EC2 describe, and `iam:PassRole` for the GitTerm task roles. A sample lives at `iam-user-policy.json` (replace `<ACCOUNT_ID>` before attaching it).

If you would rather wire up the cluster, networking, IAM roles, and ALB yourself, manual setup is also supported. See the field list under [Provider Config Fields](#provider-config-fields) and [Required AWS Resources For Manual Setup](#required-aws-resources-for-manual-setup).

AWS uses ECS task state, so it does not need an inbound webhook.

### Custom task roles

Select a task-role mode in the provider's admin configuration and choose **Provision** or **Apply**:

- **Create new role:** enter a name (up to 64 letters, numbers, or `_+=,.@-` characters).
  The initial suggestion is `gitterm-task-<region>`. GitTerm creates ECS trust and the read-only
  `gitterm-runtime-context-introspection` policy. Existing names are rejected, not silently reused.
- **Use existing role:** enter its full IAM ARN, including its path. GitTerm checks that the role
  belongs to the provider's AWS account and explicitly trusts `ecs-tasks.amazonaws.com`.
  It does **not** modify trust or permissions. Trust conditions still require admin review.

No policy JSON is entered into GitTerm. Use the AWS Console link to attach application permissions
or manage the role using your infrastructure tooling. GitTerm does not grant S3, Lambda, Bedrock,
or IAM write access by default.

- Add the custom role's exact ARN to **both** `GitTermRoleManagement` and `GitTermPassRole` in the
  control-plane policy samples. Keep the task execution role entry. Do not broaden either to all roles.
- IAM roles are account-global: use different names if regions need different permissions.
- New workspaces without an explicit access profile use the provider's default role. Existing task
  definitions and resumed workspaces retain their original role; create a new workspace to change identity.
- Generated `AGENTS.md` uses the selected workspace role's ARN and actual name, not a hardcoded demo identity.
  This is useful runtime guidance, not an authorization boundary: IAM enforces permissions.
- The task role is managed outside CloudFormation and is retained on Reset/Delete, including its
  attached policies. Changing roles does not delete the previous role.

Legacy admin API callers can still submit `taskRoleName` or omit role selection: names are resolved
using the previous create-or-reuse behavior, but existing roles are no longer modified. New clients
should send `taskRole: { mode: "create", name }` or `taskRole: { mode: "existing", arn }`.

### Access profiles: administrator-managed, available to all users

After configuring an AWS provider, its **AWS access profiles** section lets an admin:

1. Give a profile a display name and intended-capabilities description.
2. Create a minimal task role or import an existing ARN using the modes above.
3. Select **Add for all users**. No per-user or team access controls are applied.
4. Review the role-check result, open the role in AWS, and attach the permissions needed.
5. Use **Check permissions** to repeat the read-only checks after making changes in AWS.

All users who can use the provider can select any of its profiles. Only add roles whose permissions
you intend to share with those users. Profiles are provider-scoped, not arbitrary user-supplied ARNs.
They do not isolate resources between workspaces that use the same role.

On workspace creation, developers see **AWS access** with the provider default and every added
profile. The server resolves the selected profile ID against that provider's saved list and uses
the same ARN for ECS and the generated agent instructions. Changing region/provider resets an
inapplicable selection to the default. Removed/unknown profile IDs are rejected by the API.

Removing a profile only prevents new selections: it does not delete IAM roles, change existing
workspaces, or revoke temporary credentials. Emergency revocation must be handled explicitly in AWS
and/or by terminating affected workspaces. Profiles are stored in existing provider config metadata;
no database migration is required. Reset and normal provider updates preserve the list.

The SDK catalog exposes profile IDs through `client.catalog.workspaceOptions()`:

```ts
await client.workspaces.create({
  repo: "https://github.com/example/demo",
  provider: {
    type: "aws",
    providerId: "<provider UUID>",
    accessProfile: "<profile UUID from the catalog>",
  },
});
```

The dashboard/legacy create endpoint uses `awsAccessProfileId` for the same selection.

### Read-only capability discovery baseline

The recommended baseline contains exactly six IAM reads:

| Actions                                     | Scope                                     | Purpose                                                      |
| ------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------ |
| `iam:GetRole`                               | This task role                            | Identity metadata, trust, and permissions-boundary reference |
| `iam:ListRolePolicies`, `iam:GetRolePolicy` | This task role                            | Discover inline policies and read their documents            |
| `iam:ListAttachedRolePolicies`              | This task role                            | Discover attached managed policies                           |
| `iam:GetPolicy`, `iam:GetPolicyVersion`     | Account-owned and AWS-managed policy ARNs | Read managed policy versions and boundary documents          |

These reads are not needed merely to run a GitTerm workspace, but enable the agent to explain its
potential capabilities. `sts:GetCallerIdentity` needs no explicit IAM Allow. The baseline contains
no application access, role switching, or permission-editing actions. Managed-policy documents can
be read across the account, not only those attached to this role; inline policies on other roles
are not included. The task execution role remains separate (image pulls and log delivery).

Role checks validate account/ARN/ECS trust and attempt IAM simulation of the discovery baseline:

- **Allowed in simulation:** the tested actions/resources are allowed by the simulator.
- **Baseline not fully allowed:** one or more tests were denied, incomplete, or required missing context.
  Narrow grants to particular policy ARNs may still permit useful discovery.
- **Not verified:** simulation failed or was unavailable, or a new role has only just been created.

Missing/unverified discovery is a warning, not a blocker or an automatic grant on imported roles.
The UI provides the recommended policy for review in AWS. The control-plane samples include
`iam:SimulatePrincipalPolicy` on the allowed role ARNs; update deployed policies to enable the checks.
The task role itself does not need simulation permission. Simulation is advisory: SCPs, explicit
denies, resource policies, trust conditions, permissions boundaries and runtime context can restrict
effective access. The checks do not certify control-plane PassRole or application permissions.

Agent instructions explain how to inspect the policies, summarize capabilities with resource scopes
and conditions, and request the smallest additional action/resource permission if needed. If discovery
fails, the agent must say its access is unknown rather than claim the application action is forbidden.
Granting new permissions remains the user's/admin's choice; the agent must not broaden its own access
without explicit authorization.

## Implementation Notes

The rest of this document is implementation-focused. It explains:

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
- one ECS task execution role named `gitterm-task-execution-<region>`
- one CloudWatch log group at `/gitterm/workspaces`
- one EFS filesystem
- one EFS mount target per selected subnet

Before applying the stack, setup creates/reuses the selected task role outside CloudFormation
and passes its ARN as `ExistingTaskRoleArn`.

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
- `accessProfiles` optional; structured non-secret entries managed by the access-profile interface
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

## Generated AWS App Permissions Note

This section is a working note for future AWS app-generation docs.

For generated AWS apps, avoid requiring admins to manually create every Lambda execution role and then tell the agent which role ARN to use. The intended model is:

- no manual role creation per generated app
- no need to tell the agent a pre-created role name
- the agent creates Lambda execution roles named `gitterm-lambda-gen-*`
- the agent always creates those roles with the permissions boundary `gitterm-lambda-gen-boundary`

Why this is safer:

- without a boundary, allowing `iam:CreateRole` plus `iam:PutRolePolicy` is dangerous
- with a boundary, the agent can create roles, but only roles capped to the approved generated-app permissions such as S3, Bedrock, and CloudWatch Logs
- with a boundary, the agent cannot create a role with EC2 admin, IAM admin, organization access, or other out-of-scope permissions
- `iam:PassRole` remains narrow because the agent can only pass `gitterm-lambda-gen-*` roles to Lambda

One additional safety rule:

- do not let the agent edit the permissions boundary policy itself

Do not grant the generated-app agent role:

- `iam:CreatePolicyVersion`
- `iam:SetDefaultPolicyVersion`
- `iam:DeletePolicy`
- `iam:DeletePolicyVersion`
- `iam:AttachUserPolicy`
- broad `iam:*`

For production, use the same architecture with tighter scoping:

- per-workspace, per-account, or per-project resource prefixes
- per-project permissions boundaries
- session tags
- CloudTrail auditing
- automatic cleanup
- isolated AWS accounts per user or team where appropriate

The core principle stays the same:

- let the agent create app infrastructure
- keep IAM role creation bounded by permissions boundaries
- keep `iam:PassRole` narrow
- do not make humans pre-create every Lambda execution role

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
2. GitTerm attempts to revoke editor access first; AWS native SSH ends when the task stops.
3. GitTerm calls `AwsProvider.pauseWorkspace(...)`.
4. The AWS provider sends `UpdateService` to ECS with `desiredCount=0`.
5. GitTerm closes the usage session.
6. GitTerm updates the workspace row to `status=paused`.
7. GitTerm emits the paused status event.

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
2. GitTerm calls `AwsProvider.resumeWorkspace(...)`.
3. The AWS provider sends `UpdateService` to ECS with `desiredCount=1`.
4. ECS starts a new Fargate task for the existing service.
5. The AWS provider waits for the main target group to become healthy and re-registers existing exposed ports against the new task IP.
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
7. Delete removes the provider and saved config. Reset uses `preserveProvider=true`, retaining
   the provider, region, profiles and encrypted credentials and disabling the config until
   bootstrap succeeds. If rebuilding fails, use Apply to retry.

Reset/Delete removes the shared EFS filesystem and its data. Neither deletes the standalone task role.
AWS lookup failures (including AccessDenied) are surfaced, not treated as a missing/deleted stack.

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
- `packages/api/src/providers/aws/iam-user-policy.eu-central-1.json` example pinned to `eu-central-1`

Important notes about that sample policy:

- it is intentionally all-region by default so one GitTerm control-plane user can manage multiple AWS region-scoped providers
- replace `<ACCOUNT_ID>` before attaching it
- CloudFormation is scoped to `arn:aws:cloudformation:*:<ACCOUNT_ID>:stack/gitterm-*/*`, which allows GitTerm to create one regional stack per AWS provider such as `gitterm-eu-central-1` or `gitterm-us-east-1`
- IAM role permissions cover the default `gitterm-task-*` and `gitterm-task-execution-*` names; add a custom task role's exact ARN to both role-management and PassRole statements when using one

If you want to pin the sample policy to a single region later, tighten these places:

- in `GitTermCloudFormation`, replace the region wildcard in the stack ARN with a concrete region such as `eu-central-1`
- in `GitTermSetupResources`, add an `aws:RequestedRegion` condition for that region
- in `GitTermWorkspaceLifecycle`, add the same `aws:RequestedRegion` condition
- if you also want to pin IAM role access to one region-specific role set, replace `gitterm-task-*` and `gitterm-task-execution-*` with concrete role names like `gitterm-task-eu-central-1` and `gitterm-task-execution-eu-central-1`

If you want a concrete locked example instead of editing the wildcard sample yourself, start from:

- `packages/api/src/providers/aws/iam-user-policy.eu-central-1.json`

Keep `iam-user-policy.json` attached to the GitTerm control-plane IAM user only.
Attach a separate, least-privilege runtime policy to the ECS task role configured as
`taskRoleArn`, allowing only the actions and resources your workspaces need.
GitTerm does not attach application permissions automatically.

## Important Current Limitations

- Native editor SSH is supported when editor access, public task IPs, and SSH ingress are enabled.
- Simple setup currently expects a default VPC and public subnets.
- Simple setup creates an HTTP ALB listener, not HTTPS.
- The internet-facing ALB uses predictable routing headers, not origin authentication. Do not treat
  these headers as secrets or expose sensitive unauthenticated apps through this setup.
- Users select only administrator-added access profiles; there is currently no per-user/team restriction on those profiles.
- Only persistent workspaces retain `/workspace` data across task replacement. EFS access-point
  deletion does not erase its directory; shared-stack deletion removes the filesystem.
- Exposed-port IPs refresh on GitTerm resume; unexpected ECS task replacement still needs reconciliation.
- Termination is user-visible immediately in GitTerm, but AWS resource cleanup is asynchronous in the background.
- Some cleanup failures are currently swallowed and sweep counters can overstate successful deletion.
  Inspect AWS resources before claiming complete cleanup; ALB/EFS can keep incurring charges after tasks stop.
- Stack deletion currently retries `DELETE_FAILED` using CloudFormation force-delete, which can retain
  failed resources. Check for retained resources before rebuilding or declaring cleanup complete.

## Presentation preflight

Local tests use mocked AWS APIs; they do **not** certify account permissions, networking, images,
Bedrock model access, or live provisioning. Before presenting:

1. Provision/Apply in a dedicated demo account. Confirm the role ARN and attach only the permissions
   needed for the demo. For custom names, update both control-plane IAM statements described above.
2. Use a current GitTerm container image and a persistent workspace if demonstrating pause/resume.
   Wait for setup completion (`aws --version` should work); AWS CLI installation is an after-agent setup command.
3. Inside the workspace, run `aws sts get-caller-identity` and confirm the expected assumed role;
   verify `$AWS_REGION` and the role in `~/.config/opencode/AGENTS.md`. Do not display credential endpoints or keys.
4. Run a bounded task such as creating a demo-prefixed S3 object or deploying a small Lambda,
   checking the actual AWS result rather than just the agent's response.
5. Start an HTTP app, open its port with `gitterm ports open 3000 --name demo`, and visit the preview.
   Pause/resume; confirm a persistent marker file and the preview still work (restart the app if needed).
6. If showing editor access, test native SSH after resume too: the task public IP can change.
7. Terminate the workspace, inspect cleanup, and delete demo-created S3/Lambda resources separately.
   Do not Reset shared infrastructure with data you want to preserve.

The existing managed-provider smoke harness supports AWS (not the direct-provider harness):

```sh
# Set GITTERM_SERVER_URL, GITTERM_API_TOKEN and GITTERM_E2E_REPO in scripts/.env.
# Optionally set GITTERM_E2E_MODEL and model credentials for your configured agent.
# This creates billable resources and runs an agent; it terminates its test workspace.
bun run test:providers --provider aws
```

Recommended follow-ups: authenticated HTTPS/private ALB origin access, read-only AWS readiness
diagnostics (trust/PassRole, image access, networking, quotas), ECS stopped-task reason reporting,
truthful retryable cleanup, automatic port reconciliation on task replacement, and per-user/team
eligibility for access profiles. Prioritize origin security before multi-user production use.

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
