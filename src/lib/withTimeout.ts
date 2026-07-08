/**
 * Race a promise against a timeout.
 *
 * Resolves to the promise's value if it settles first, or to `null` if the
 * promise REJECTS or does not settle within `ms`. Never rejects itself, so
 * callers can treat `null` uniformly as "did not succeed in time".
 *
 * Motivation: an offline Supabase write can stay pending indefinitely (the
 * fetch neither resolves nor rejects) rather than failing. Awaiting it
 * directly hangs everything downstream — including a project switch that
 * awaits the pre-switch flush. Wrapping the write lets the flush report
 * failure quickly instead of freezing the UI.
 */
export function withTimeout<T>(promise: PromiseLike<T>, ms: number): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    let settled = false;
    const done = (value: T | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => done(null), ms);
    Promise.resolve(promise).then(
      (value) => done(value),
      () => done(null),
    );
  });
}
