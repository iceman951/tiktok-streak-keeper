import { AppError } from './errors.js';
import { sleep } from './time.js';

// Only pre-submission navigation can be retried. Never wrap a send in this function.
export async function retryNavigation<T>(
  action: () => Promise<T>,
  wait: (ms: number) => Promise<void> = sleep,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await action();
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== 'TRANSIENT_NAVIGATION' || attempt >= 2)
        throw error;
      await wait(1000 * 2 ** attempt);
    }
  }
}
