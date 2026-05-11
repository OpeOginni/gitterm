export interface ProviderRow {
  id: string;
  name: string;
  providerKey: string;
  isEnabled: boolean;
  supportsRegions: boolean;
  providerConfig: { isEnabled: boolean } | null;
  regions: Array<{
    id: string;
    name: string;
    location: string;
    externalRegionIdentifier: string;
    isEnabled: boolean;
  }>;
}
