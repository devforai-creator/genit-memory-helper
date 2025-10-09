/**
 * @module adapters
 * Re-export registry helpers and adapter factories for consumers.
 */

/**
 * @typedef {import('../types').AdapterRegistry} AdapterRegistry
 * @typedef {import('../types').GenitAdapter} GenitAdapter
 */

export {
  adapterRegistry,
  registerAdapterConfig,
  getAdapterConfig,
  getAdapterSelectors,
  getAdapterMetadata,
  listAdapterNames,
} from './registry.js';

export { createGenitAdapter } from './genit.js';
