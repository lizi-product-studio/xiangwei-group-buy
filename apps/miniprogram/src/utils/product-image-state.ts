import { resolveProductImageUrl } from './product-image';

export interface ProductImageState {
  resolvedSrc: string;
  loaded: boolean;
  failed: boolean;
  sourceVersion: number;
}

/** Reset image rendering state for every binding, including the same URL. */
export function resetProductImageState(value: unknown, apiBaseUrl: string, previousVersion: number): ProductImageState {
  return {
    resolvedSrc: resolveProductImageUrl(value, apiBaseUrl),
    loaded: false,
    failed: false,
    sourceVersion: previousVersion + 1,
  };
}
