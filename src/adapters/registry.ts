import { clone } from '../core/utils';
import type { AdapterConfig, AdapterMetadata, AdapterRegistry, AdapterSelectors } from '../types';

const configs = new Map<string, AdapterConfig>();

const createNormalizedConfig = (config?: AdapterConfig | null): AdapterConfig => ({
  selectors: config?.selectors ? { ...config.selectors } : {},
  metadata: config?.metadata ? { ...config.metadata } : {},
});

export const registerAdapterConfig = (name: string, config: AdapterConfig = {}): void => {
  if (!name) return;
  configs.set(name, createNormalizedConfig(config));
};

export const getAdapterConfig = (name: string): AdapterConfig =>
  configs.get(name) ?? { selectors: {}, metadata: {} };

export const getAdapterSelectors = (name: string): AdapterSelectors =>
  clone(getAdapterConfig(name).selectors ?? {});

export const getAdapterMetadata = (name: string): AdapterMetadata =>
  clone(getAdapterConfig(name).metadata ?? {});

export const listAdapterNames = (): string[] => Array.from(configs.keys());

export const adapterRegistry: AdapterRegistry = {
  register: registerAdapterConfig,
  get: getAdapterConfig,
  list: listAdapterNames,
};

export default adapterRegistry;
