import {
  CreateRoleCommand,
  GetRoleCommand,
  IAMClient,
  PutRolePolicyCommand,
  SimulatePrincipalPolicyCommand,
} from "@aws-sdk/client-iam";
import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { awsRoleSelectionSchema, awsTaskRoleArnSchema } from "@gitterm/schema";
import type { z } from "zod";

export const ROLE_DISCOVERY_ACTIONS = [
  "iam:GetRole",
  "iam:ListRolePolicies",
  "iam:GetRolePolicy",
  "iam:ListAttachedRolePolicies",
];
export const POLICY_DISCOVERY_ACTIONS = ["iam:GetPolicy", "iam:GetPolicyVersion"];

export function buildRoleDiscoveryPolicy(roleArn: string) {
  const [, partition, , , accountId] = roleArn.split(":");
  return {
    Version: "2012-10-17",
    Statement: [
      { Effect: "Allow", Action: ROLE_DISCOVERY_ACTIONS, Resource: roleArn },
      {
        Effect: "Allow",
        Action: POLICY_DISCOVERY_ACTIONS,
        Resource: [
          `arn:${partition}:iam::${accountId}:policy/*`,
          `arn:${partition}:iam::aws:policy/*`,
        ],
      },
    ],
  };
}

export function parseTrustPolicy(document: string): { Statement?: any[] | any } {
  try {
    return JSON.parse(document);
  } catch {
    return JSON.parse(decodeURIComponent(document));
  }
}

export function trustsEcsTasks(document: string): boolean {
  const policy = parseTrustPolicy(document);
  const statements = Array.isArray(policy.Statement) ? policy.Statement : [policy.Statement];
  return statements.some((statement) => {
    const services = [statement?.Principal?.Service].flat();
    const actions = [statement?.Action].flat();
    return (
      statement?.Effect === "Allow" &&
      services.includes("ecs-tasks.amazonaws.com") &&
      actions.includes("sts:AssumeRole")
    );
  });
}

type Credentials = { accessKeyId: string; secretAccessKey: string; defaultRegion: string };
export interface AwsRoleCheck {
  roleArn: string;
  discovery: "available" | "missing" | "unverified";
  missingActions: string[];
  warnings: string[];
  recommendedPolicy: ReturnType<typeof buildRoleDiscoveryPolicy>;
}

export async function inspectAwsTaskRole(
  config: Credentials,
  roleArn: string,
): Promise<AwsRoleCheck> {
  roleArn = awsTaskRoleArnSchema.parse(roleArn);
  const credentials = { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey };
  const iam = new IAMClient({ credentials, region: config.defaultRegion });
  const identity = await new STSClient({ credentials, region: config.defaultRegion }).send(
    new GetCallerIdentityCommand({}),
  );
  if (!identity.Account || roleArn.split(":")[4] !== identity.Account)
    throw new Error("Task role must belong to this provider's AWS account");
  const role = (await iam.send(new GetRoleCommand({ RoleName: roleArn.split("/").at(-1)! }))).Role;
  if (role?.Arn !== roleArn)
    throw new Error("AWS returned a different role ARN; check the account and IAM path");
  if (!role.AssumeRolePolicyDocument || !trustsEcsTasks(role.AssumeRolePolicyDocument))
    throw new Error("Task role must explicitly trust ecs-tasks.amazonaws.com for sts:AssumeRole");
  const result: AwsRoleCheck = {
    roleArn,
    discovery: "unverified",
    missingActions: [],
    warnings: [
      "IAM simulation is advisory, not proof of effective access. Trust conditions, SCPs, resource policies and runtime context can restrict access. Control-plane iam:PassRole is also required.",
    ],
    recommendedPolicy: buildRoleDiscoveryPolicy(roleArn),
  };
  try {
    const partition = roleArn.split(":")[1];
    // GetPolicy/GetPolicyVersion support policy ARNs. Use a policy-shaped resource
    // to test the broad discovery baseline rather than simulating against a role ARN.
    const checks = await Promise.all([
      iam.send(
        new SimulatePrincipalPolicyCommand({
          PolicySourceArn: roleArn,
          ActionNames: ROLE_DISCOVERY_ACTIONS,
          ResourceArns: [roleArn],
        }),
      ),
      iam.send(
        new SimulatePrincipalPolicyCommand({
          PolicySourceArn: roleArn,
          ActionNames: POLICY_DISCOVERY_ACTIONS,
          ResourceArns: [
            `arn:${partition}:iam::${identity.Account}:policy/gitterm-discovery-check`,
            `arn:${partition}:iam::aws:policy/ReadOnlyAccess`,
          ],
        }),
      ),
    ]);
    const evaluations = checks.flatMap((check) => check.EvaluationResults ?? []);
    const expected = [...ROLE_DISCOVERY_ACTIONS, ...POLICY_DISCOVERY_ACTIONS];
    result.missingActions = expected.filter((action) => {
      const matching = evaluations.filter((evaluation) => evaluation.EvalActionName === action);
      return (
        !matching.length ||
        matching.some(
          (evaluation) =>
            evaluation.EvalDecision !== "allowed" ||
            (evaluation.MissingContextValues?.length ?? 0) > 0,
        )
      );
    });
    result.discovery = result.missingActions.length ? "missing" : "available";
    if (result.missingActions.length)
      result.warnings.push(
        "The recommended discovery baseline was not fully allowed in simulation. Narrow policy-specific grants may still work. Review the suggested policy in AWS; GitTerm will not modify imported roles.",
      );
  } catch {
    result.warnings.push(
      "Could not simulate discovery permissions. Allow iam:SimulatePrincipalPolicy on this role for the control-plane identity, or review the suggested policy manually in AWS.",
    );
  }
  return result;
}

export async function prepareAwsTaskRole(
  config: Credentials,
  selection: z.infer<typeof awsRoleSelectionSchema>,
): Promise<AwsRoleCheck> {
  const parsed = awsRoleSelectionSchema.parse(selection);
  if (parsed.mode === "existing") return inspectAwsTaskRole(config, parsed.arn);
  const iam = new IAMClient({
    region: config.defaultRegion,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
  // Deliberately CreateRole, not create-or-reuse: an existing role is never silently modified.
  const role = (
    await iam.send(
      new CreateRoleCommand({
        RoleName: parsed.name,
        AssumeRolePolicyDocument: JSON.stringify({
          Version: "2012-10-17",
          Statement: [
            {
              Effect: "Allow",
              Principal: { Service: "ecs-tasks.amazonaws.com" },
              Action: "sts:AssumeRole",
            },
          ],
        }),
        Tags: [
          { Key: "ManagedBy", Value: "gitterm" },
          { Key: "Purpose", Value: "workspace-task-role" },
        ],
      }),
    )
  ).Role;
  if (!role?.Arn) throw new Error("AWS did not return the created task role ARN");
  try {
    await iam.send(
      new PutRolePolicyCommand({
        RoleName: parsed.name,
        PolicyName: "gitterm-runtime-context-introspection",
        PolicyDocument: JSON.stringify(buildRoleDiscoveryPolicy(role.Arn)),
      }),
    );
  } catch (error) {
    throw new Error(
      `Role ${role.Arn} was created, but attaching discovery permissions failed. Configure it in AWS and import it as an existing role. ${error instanceof Error ? error.message : ""}`,
      { cause: error },
    );
  }
  return {
    roleArn: role.Arn,
    discovery: "unverified",
    missingActions: [],
    warnings: [
      "Discovery policy attached. Effective access is not verified; IAM propagation can take time. Add application permissions in AWS and allow control-plane iam:PassRole for this role.",
    ],
    recommendedPolicy: buildRoleDiscoveryPolicy(role.Arn),
  };
}
