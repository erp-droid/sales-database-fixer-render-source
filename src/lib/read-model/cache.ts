type CacheClearer = () => void;

let cacheVersion = 0;
const clearers = new Set<CacheClearer>();

export function getReadModelCacheVersion(): number {
  return cacheVersion;
}

export function registerReadModelCacheClearer(clearer: CacheClearer): () => void {
  clearers.add(clearer);
  return () => {
    clearers.delete(clearer);
  };
}

export function invalidateReadModelCaches(): void {
  cacheVersion += 1;
  for (const clearer of clearers) {
    clearer();
  }
}
