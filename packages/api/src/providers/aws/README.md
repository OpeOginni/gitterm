# AWS Provider Setup

This provider runs GitTerm workspaces on AWS using `ECS` with `Fargate`, a shared `ALB`, and optional `EFS` for persistent workspaces.

It supports two setup modes:

- manual setup with every AWS resource entered explicitly
- simple setup from IAM credentials, where GitTerm creates the shared ECS, ALB, security group, logging, and EFS resources for you inside the default VPC

## What The Provider Expects

The AWS provider config is defined in:

- `packages/schema/src/provider-registry.ts`
- `packages/api/src/providers/aws/types.ts`

Current config fields:

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

## Required AWS Resources

Before enabling the provider, create these AWS resources:

- An `ECS Cluster`
- A shared `Application Load Balancer`
- At least one `ALB Listener`
- A `VPC`
- One or more subnets for ECS tasks
- One or more security groups for ECS tasks
- An ECS `Task Execution Role`
- An ECS `Task Role`

Optional:

- An `EFS File System` if you want persistent workspaces
- A `CloudWatch Log Group` if you want task logs grouped explicitly

## Field-By-Field Explanation

### `accessKeyId`

The access key for the IAM user GitTerm uses to create and manage AWS resources.

This IAM user is used by the GitTerm server, not by the workspace container.

### `secretAccessKey`

The secret key paired with `accessKeyId`.

### `defaultRegion`

The AWS region GitTerm uses when a workspace does not explicitly specify a region.

Examples:

- `us-east-1`
- `us-west-2`
- `eu-west-1`

This should match the region where your ECS cluster, ALB, subnets, and related resources exist.

### `clusterArn`

The full ARN of the ECS cluster where GitTerm will create services.

Example:

```text
arn:aws:ecs:us-east-1:123456789012:cluster/gitterm
```

### `vpcId`

The VPC ID used by the target groups created for workspace routing.

Example:

```text
vpc-0123456789abcdef0
```

### `subnetIds`

A comma-separated list of subnet IDs used in the ECS `awsvpc` network configuration.

Example:

```text
subnet-aaa111,subnet-bbb222,subnet-ccc333
```

These subnets should be compatible with your ALB and ECS networking design.

### `securityGroupIds`

A comma-separated list of security groups attached to workspace tasks.

Example:

```text
sg-aaa111,sg-bbb222
```

These security groups should allow traffic from the ALB to the workspace container ports you intend to expose.

### `albListenerArn`

The ARN of the shared ALB listener GitTerm will add host-header rules to.

Example:

```text
arn:aws:elasticloadbalancing:us-east-1:123456789012:listener/app/gitterm-alb/abc123/def456
```

GitTerm creates one listener rule per workspace and one additional rule per exposed port.

### `albBaseUrl`

The base URL GitTerm uses as the upstream target for AWS workspaces.

Example:

```text
https://gitterm-alb-123456.us-east-1.elb.amazonaws.com
```

This should point to the same ALB that owns `albListenerArn`.

GitTerm sends traffic to this URL and injects a synthetic `Host` header so the ALB can route to the correct workspace.

### `taskExecutionRoleArn`

The ECS task execution role ARN.

This role is used by ECS to:

- pull images if needed
- write logs to CloudWatch

Example:

```text
arn:aws:iam::123456789012:role/gitterm-task-execution
```

### `taskRoleArn`

The task role attached to the workspace container.

For many setups this can be a minimal role with no additional permissions.

Example:

```text
arn:aws:iam::123456789012:role/gitterm-task
```

### `assignPublicIp`

Optional boolean.

When enabled, ECS tasks are launched with a public IP in supported subnets.

Use this only if your network design requires it. For most ALB-fronted private-subnet setups, this should remain disabled.

### `efsFileSystemId`

Optional.

Required only for persistent workspaces.

Example:

```text
fs-0123456789abcdef0
```

When this is set, GitTerm creates a per-workspace `EFS Access Point` and mounts it into the container at `/workspace`.

### `logGroupName`

Optional CloudWatch log group name for ECS task logs.

Example:

```text
/gitterm/workspaces
```

If omitted, the provider does not attach AWS logs configuration to the container definition.

## Networking Notes

The provider currently uses a shared ALB and synthetic host-header routing.

That means GitTerm does not need:

- Route53 records per workspace
- wildcard DNS for workspace containers

Instead, GitTerm:

- sends traffic to `albBaseUrl`
- injects a synthetic `Host` header
- relies on ALB host-header rules to reach the correct workspace service

## IAM Notes

The IAM user behind `accessKeyId` and `secretAccessKey` must be able to manage:

- ECS services and task definitions
- ALB target groups and listener rules
- EFS access points if persistence is enabled
- EC2 describe calls for networking lookup
- `iam:PassRole` for the exact task execution and task roles

Keep the IAM user separate from the task execution role and task role.

A sample IAM user policy lives beside this README:

- `packages/api/src/providers/aws/iam-user-policy.json`

## IAM User Policy

Use `iam-user-policy.json` as the single policy for the IAM user whose credentials are entered into the GitTerm AWS provider config.

This one policy covers both:

- simple setup (discovering the VPC, creating the cluster, ALB, security groups, roles, log group, EFS)
- runtime workspace lifecycle (creating, stopping, restarting, deleting workspaces and exposed ports)

Replace these placeholders before attaching it:

- `<REGION>` -- the AWS region you selected during setup
- `<ACCOUNT_ID>` -- your 12-digit AWS account ID

Important notes:

- Some AWS control-plane APIs do not scope cleanly to specific ARNs at create-time, so those statements use `"Resource": "*"` and are limited by action set and region condition.
- IAM role operations are scoped to the exact `gitterm-task-execution` and `gitterm-task` role names.
- The ECS service-linked role creation is included in the policy. If your account already has the ECS service-linked role, that action is a no-op.

## Minimal Setup Checklist

1. Create an ECS cluster.
2. Create an ALB and listener.
3. Create subnets and security groups for ECS tasks.
4. Create a task execution role.
5. Create a task role.
6. Optionally create EFS for persistent workspaces.
7. Create an IAM user for GitTerm control-plane access.
8. Fill the AWS provider config in the admin UI with the values above.

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
albBaseUrl=https://gitterm-alb-123456.us-east-1.elb.amazonaws.com
taskExecutionRoleArn=arn:aws:iam::123456789012:role/gitterm-task-execution
taskRoleArn=arn:aws:iam::123456789012:role/gitterm-task
assignPublicIp=false
efsFileSystemId=fs-0123456789abcdef0
logGroupName=/gitterm/workspaces
```
