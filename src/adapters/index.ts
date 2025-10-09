export {
  adapterRegistry,
  registerAdapterConfig,
  getAdapterConfig,
  getAdapterSelectors,
  getAdapterMetadata,
  listAdapterNames,
} from './registry';

export { createGenitAdapter } from './genit';

export type { AdapterRegistry, GenitAdapter } from '../types';
