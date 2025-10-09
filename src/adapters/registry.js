import { clone } from '../core/utils.ts';

/**
 * @typedef {import('../types').AdapterConfig} AdapterConfig
 * @typedef {import('../types').AdapterSelectors} AdapterSelectors
 * @typedef {import('../types').AdapterMetadata} AdapterMetadata
 * @typedef {import('../types').AdapterRegistry} AdapterRegistry
 */

/** @type {Map<string, AdapterConfig>} */
const configs = new Map();

/**
 * Stores adapter selectors/metadata for a named adapter.
 * @param {string} name - Adapter identifier.
 * @param {AdapterConfig} [config] - Selectors and metadata to persist.
 */
export const registerAdapterConfig = (name, config = {}) => {
  if (!name) return;
  configs.set(name, {
    selectors: config.selectors || {},
    metadata: config.metadata || {},
  });
};

/**
 * Reads an adapter configuration, providing empty defaults when missing.
 * @param {string} name - Adapter identifier.
 * @returns {AdapterConfig}
 */
export const getAdapterConfig = (name) => configs.get(name) || { selectors: {}, metadata: {} };

/**
 * Returns a defensive copy of selector strings for the named adapter.
 * @param {string} name - Adapter identifier.
 * @returns {AdapterSelectors}
 */
export const getAdapterSelectors = (name) =>
  /** @type {AdapterSelectors} */ (clone(getAdapterConfig(name).selectors || {}));

/**
 * Returns adapter metadata as a shallow clone.
 * @param {string} name - Adapter identifier.
 * @returns {AdapterMetadata}
 */
export const getAdapterMetadata = (name) =>
  /** @type {AdapterMetadata} */ (clone(getAdapterConfig(name).metadata || {}));

/**
 * Lists registered adapter names in insertion order.
 * @returns {string[]}
 */
export const listAdapterNames = () => Array.from(configs.keys());

/** @type {AdapterRegistry} */
export const adapterRegistry = {
  register: registerAdapterConfig,
  get: getAdapterConfig,
  list: listAdapterNames,
};

export default adapterRegistry;
