export type PDFProgressCallback = (progress: number) => void;

export const preloadWithConcurrency = async <T>(
  items: T[],
  worker: (item: T) => Promise<unknown>,
  onItemComplete?: (completed: number, total: number) => void,
  concurrency = 8
) => {
  if (items.length === 0) return;

  let nextIndex = 0;
  let completed = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);

  const runWorker = async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      await worker(items[currentIndex]);
      completed += 1;
      onItemComplete?.(completed, items.length);
    }
  };

  await Promise.all(
    Array.from({ length: workerCount }, () => runWorker())
  );
};

export const getOrCreateBoundedCacheEntry = <T>(
  cache: Map<string, Promise<T>>,
  key: string,
  factory: () => Promise<T>,
  maximumEntries = 300
) => {
  const cached = cache.get(key);
  if (cached) {
    cache.delete(key);
    cache.set(key, cached);
    return cached;
  }

  while (cache.size >= maximumEntries) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
  }

  const pendingValue = factory().catch((error) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, pendingValue);
  return pendingValue;
};

export const imageLoadProgress = (
  completed: number,
  total: number
) => 10 + Math.round((completed / Math.max(1, total)) * 70);

export const pdfDrawProgress = (
  completed: number,
  total: number
) => 80 + Math.round((completed / Math.max(1, total)) * 18);
