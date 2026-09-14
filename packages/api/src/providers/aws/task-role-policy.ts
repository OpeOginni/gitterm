/**
 * Pure policy builders for workspace task roles.
 *
 * No AWS SDK imports: the admin UI imports this file directly so the JSON it
 * shows is exactly what the provider attaches to roles it creates.
 */

interface PolicyStatement {
  Sid?: string;
  Effect: "Allow";
  Action: string | string[];
  Resource: string | string[];
}

export const ROLE_DISCOVERY_ACTIONS = [
  "iam:GetRole",
  "iam:ListRolePolicies",
  "iam:GetRolePolicy",
  "iam:ListAttachedRolePolicies",
];
export const POLICY_DISCOVERY_ACTIONS = ["iam:GetPolicy", "iam:GetPolicyVersion"];

function parseRoleArn(roleArn: string) {
  const [, partition = "aws", , , accountId = ""] = roleArn.split(":");
  return { partition, accountId };
}

/** Baseline every workspace role needs: read-only discovery of itself and of managed policies. */
export function buildRoleDiscoveryPolicy(roleArn: string) {
  const { partition, accountId } = parseRoleArn(roleArn);
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
    ] as PolicyStatement[],
  };
}

/**
 * Optional application permissions an admin can copy onto a workspace role.
 * GitTerm never attaches these itself; they are offered so the JSON is ready to paste.
 */
export const TASK_ROLE_ADDONS = {
  bedrock: {
    label: "Amazon Bedrock",
    description:
      "Invoke foundation models and inference profiles, including GPT through the Responses API.",
    statements: ({ partition, accountId }: ReturnType<typeof parseRoleArn>): PolicyStatement[] => [
      {
        Sid: "GitTermBedrockInvoke",
        Effect: "Allow",
        // Converse and ConverseStream are authorized by these two actions; they have no IAM actions of their own.
        Action: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
        Resource: [
          `arn:${partition}:bedrock:*::foundation-model/*`,
          `arn:${partition}:bedrock:*:${accountId}:inference-profile/*`,
        ],
      },
      {
        Sid: "GitTermBedrockMantleInference",
        Effect: "Allow",
        Action: "bedrock-mantle:CreateInference",
        Resource: `arn:${partition}:bedrock-mantle:*:${accountId}:project/default`,
      },
      {
        Sid: "GitTermBedrockDiscovery",
        Effect: "Allow",
        Action: [
          "bedrock:ListFoundationModels",
          "bedrock:GetFoundationModel",
          "bedrock:ListInferenceProfiles",
          "bedrock:GetInferenceProfile",
        ],
        Resource: "*",
      },
    ],
  },
} as const;

export type TaskRoleAddon = keyof typeof TASK_ROLE_ADDONS;

export function buildTaskRolePolicy(roleArn: string, addons: readonly TaskRoleAddon[] = []) {
  const base = buildRoleDiscoveryPolicy(roleArn);
  const context = parseRoleArn(roleArn);
  return {
    Version: base.Version,
    Statement: [
      ...base.Statement,
      ...addons.flatMap((addon) => TASK_ROLE_ADDONS[addon].statements(context)),
    ],
  };
}
