export type PDFProgressCallback = (progress: number) => void;

export const loadWithImageFallback = async <T>(
  primaryUrl: string,
  fallbackUrl: string,
  loader: (url: string) => Promise<T | null>
) => {
  const candidates = [primaryUrl, fallbackUrl].filter(
    (url, index, values) => Boolean(url) && values.indexOf(url) === index
  );

  for (const candidate of candidates) {
    try {
      const loaded = await loader(candidate);
      if (loaded !== null) return loaded;
    } catch (error) {
      console.error("PDF image candidate failed", error);
    }
  }

  return null;
};

export const fetchImageBlob = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) return null;
  const contentType = response.headers.get("content-type")?.toLowerCase() || "";
  if (contentType && !contentType.startsWith("image/")) return null;
  const blob = await response.blob();
  if (!blob.size || (blob.type && !blob.type.toLowerCase().startsWith("image/"))) {
    return null;
  }
  return blob;
};

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
