import { clone } from '../core/utils.ts';

const configs = new Map();

export const registerAdapterConfig = (name, config = {}) => {
  if (!name) return;
  configs.set(name, {
    selectors: config.selectors || {},
    metadata: config.metadata || {},
  });
};

export const getAdapterConfig = (name) => configs.get(name) || { selectors: {}, metadata: {} };

export const getAdapterSelectors = (name) => clone(getAdapterConfig(name).selectors || {});

export const getAdapterMetadata = (name) => clone(getAdapterConfig(name).metadata || {});

export const listAdapterNames = () => Array.from(configs.keys());

export const adapterRegistry = {
  register: registerAdapterConfig,
  get: getAdapterConfig,
  list: listAdapterNames,
};

export default adapterRegistry;
