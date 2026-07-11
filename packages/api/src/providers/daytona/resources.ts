export const DAYTONA_DEFAULT_RESOURCES = {
  server: { cpu: 2, memory: 4 },
  editor: { cpu: 4, memory: 8 },
} as const;

export type DaytonaResourceTier = keyof typeof DAYTONA_DEFAULT_RESOURCES;
