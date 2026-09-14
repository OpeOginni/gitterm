import template from "./iam-user-policy.json";

interface PolicyStatement {
  Sid: string;
  Effect: string;
  Action: string | string[];
  Resource: string | string[];
  Condition?: Record<string, Record<string, string | string[]>>;
}

/** Regional services are restricted separately from account-global IAM operations. */
export function buildAwsDeploymentPolicy(
  accountId: string,
  region: string,
  taskRoleArn?: string,
  mode: "create" | "existing" = "create",
) {
  const policy = JSON.parse(JSON.stringify(template).replaceAll("<ACCOUNT_ID>", accountId)) as {
    Version: string;
    Statement: PolicyStatement[];
  };
  for (const statement of policy.Statement) {
    if (
      [
        "GitTermCloudFormation",
        "GitTermDiscovery",
        "GitTermSetupResources",
        "GitTermWorkspaceLifecycle",
        "GitTermRuntimeSecrets",
        "GitTermListRuntimeSecrets",
      ].includes(statement.Sid)
    ) {
      statement.Condition = { StringEquals: { "aws:RequestedRegion": region } };
    }
    if (statement.Sid === "GitTermCloudFormation") {
      statement.Resource = `arn:aws:cloudformation:${region}:${accountId}:stack/gitterm-${region}/*`;
    }
    if (statement.Sid === "GitTermExecutionRolePolicy") {
      statement.Resource = `arn:aws:iam::${accountId}:role/gitterm-task-execution-${region}`;
    }
    if (["GitTermRoleManagement", "GitTermPassRole"].includes(statement.Sid)) {
      statement.Resource = [
        ...new Set([
          `arn:aws:iam::${accountId}:role/gitterm-task-execution-${region}`,
          taskRoleArn || `arn:aws:iam::${accountId}:role/gitterm-task-${region}`,
        ]),
      ];
    }
  }
  const management = policy.Statement.find(
    (statement) => statement.Sid === "GitTermRoleManagement",
  )!;
  management.Resource = `arn:aws:iam::${accountId}:role/gitterm-task-execution-${region}`;
  policy.Statement.push({
    Sid: "GitTermWorkspaceRole",
    Effect: "Allow",
    Action: [
      "iam:GetRole",
      "iam:SimulatePrincipalPolicy",
      "iam:ListAttachedRolePolicies",
      "iam:GetRolePolicy",
      "iam:ListRolePolicies",
      ...(mode === "create" ? ["iam:CreateRole", "iam:TagRole", "iam:PutRolePolicy"] : []),
    ],
    Resource: taskRoleArn || `arn:aws:iam::${accountId}:role/gitterm-task-${region}`,
  });
  return policy;
}
