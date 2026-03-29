import { promises as fs } from 'fs';
import path from 'path';
export const DEVELOPER_MODE = false;
export const KEEP_DOWNLOADS_ON_FAILURE = false;
export async function retryAsync(fn, retries = 3, delayMs = 1000, onRetryAttempt) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (onRetryAttempt) onRetryAttempt(i + 1, retries, err);
      if (i < retries - 1) await new Promise(resolve => setTimeout(resolve, delayMs));
      else {
        const enrichedError = new Error(`After ${retries} attempts: ${err.message}`);
        enrichedError.cause = err;
        throw enrichedError;
      }
    }
  }
}
export async function clearDownloadsDirectory(directoryPath, skipIfEnabled = KEEP_DOWNLOADS_ON_FAILURE) {
  if (skipIfEnabled) {
    if (DEVELOPER_MODE) console.log(`(Dev) Skipping directory clear: KEEP_DOWNLOADS_ON_FAILURE is enabled`);
    return true;
  }
  try {
    if (await fs.stat(directoryPath).catch(() => null)) {
      if (DEVELOPER_MODE) console.log(`(Dev) Clearing directory: ${directoryPath}`);
      const files = await fs.readdir(directoryPath);
      for (const file of files) {
        await fs.unlink(path.join(directoryPath, file));
      }
      if (DEVELOPER_MODE) console.log(`(Dev) Directory ${directoryPath} cleared successfully.`);
      return true;
    } else {
      if (DEVELOPER_MODE) console.log(`(Dev) Directory ${directoryPath} does not exist. No need to clear.`);
      return true;
    }
  } catch (err) {
    console.error(`Error clearing directory ${directoryPath}:`, err);
    return false;
  }
}
export function sanitizeFilename(filename) {
  return filename.replace(/[<>:"/\\|?*]/g, '_');
}
export async function concurrentMap(items, concurrency, fn) {
  const results = new Array(items.length);
  let currentIndex = 0;
  const workers = Array.from({ length: Math.min(items.length, concurrency) }, async () => {
    while (currentIndex < items.length) {
      const index = currentIndex++;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}
export class RateLimiter {
  constructor(delayMs) {
    this.delayMs = delayMs;
    this.lastRequestTime = 0;
  }
  async throttle() {
    if (this.delayMs <= 0) return;
    const now = Date.now();
    const timeSinceLast = now - this.lastRequestTime;
    if (timeSinceLast < this.delayMs) {
      await new Promise(resolve => setTimeout(resolve, this.delayMs - timeSinceLast));
    }
    this.lastRequestTime = Date.now();
  }
}