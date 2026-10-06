export interface AsciiConfig {
  apiKey: string;
  /** Signing secret of the boat webhook endpoint (`whsec_…`); webhooks are rejected without it. */
  webhookSecret?: string;
}
