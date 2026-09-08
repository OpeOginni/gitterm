import { awsAccessProfileSchema, type AwsAccessProfile } from "@gitterm/schema";

export function getAwsAccessProfiles(config: Record<string, unknown>): AwsAccessProfile[] {
  return awsAccessProfileSchema.array().parse(config.accessProfiles ?? []);
}

export function resolveAwsWorkspaceRole(
  config: Record<string, unknown>,
  profileId?: string,
): string {
  if (!profileId) return String(config.taskRoleArn ?? "");
  const profile = getAwsAccessProfiles(config).find((entry) => entry.id === profileId);
  if (!profile) throw new Error("Selected AWS access profile is not available for this provider");
  return profile.roleArn;
}
