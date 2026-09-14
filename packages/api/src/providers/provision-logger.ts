import { redactSecrets } from "../utils/redact-secrets";

type AsyncStepResult<T> = Promise<T> | T;

export function createProvisionLogger(
  providerName: string,
  workspaceId: string,
  secrets: readonly string[] = [],
) {
  const redactions = new Set(secrets.filter(Boolean));
  const startedAt = Date.now();
  const prefix = `[workspace-provision][${providerName}][${workspaceId}]`;

  return {
    addSecrets(values: readonly string[]) {
      for (const value of values) if (value) redactions.add(value);
    },
    log(message: string) {
      console.info(`${prefix} ${message} totalMs=${Date.now() - startedAt}`);
    },
    redact<T>(value: T): T {
      return redactSecrets(value, [...redactions]) as T;
    },
    async step<T>(name: string, operation: () => AsyncStepResult<T>): Promise<T> {
      const stepStartedAt = Date.now();
      console.info(`${prefix} ${name} start totalMs=${stepStartedAt - startedAt}`);

      try {
        const result = await operation();
        console.info(
          `${prefix} ${name} done stepMs=${Date.now() - stepStartedAt} totalMs=${Date.now() - startedAt}`,
        );
        return result;
      } catch (error) {
        console.error(
          `${prefix} ${name} failed stepMs=${Date.now() - stepStartedAt} totalMs=${Date.now() - startedAt}`,
          redactSecrets(error, [...redactions]),
        );
        throw error;
      }
    },
  };
}
