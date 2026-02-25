export interface AwsConfig {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  accountId?: string;
  publicIngress?: boolean;
}
