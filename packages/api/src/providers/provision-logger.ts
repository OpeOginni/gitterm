type AsyncStepResult<T> = Promise<T> | T;

export function createProvisionLogger(providerName: string, workspaceId: string) {
  const startedAt = Date.now();
  const prefix = `[workspace-provision][${providerName}][${workspaceId}]`;

  return {
    log(message: string) {
      console.info(`${prefix} ${message} totalMs=${Date.now() - startedAt}`);
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
          error,
        );
        throw error;
      }
    },
  };
}
