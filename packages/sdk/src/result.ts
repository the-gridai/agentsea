export type Result<T> =
  | {
      ok: true;
      data: T;
    }
  | {
      ok: false;
      error: Error;
    };

export const Ok = <T>(data: T): Result<T> => ({
  ok: true,
  data,
});

export const Err = <T>(error: Error): Result<T> => ({
  ok: false,
  error,
});

export function tryCatch<T>(fn: () => T): Result<T> {
  try {
    return Ok(fn());
  } catch (e) {
    return Err(e instanceof Error ? e : new Error(String(e)));
  }
}

export async function asyncTryCatch<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return Ok(await fn());
  } catch (e) {
    return Err(e instanceof Error ? e : new Error(String(e)));
  }
}

export function tryCatchIf<T>(guard: (err: Error) => boolean, fn: () => T): Result<T> {
  try {
    return Ok(fn());
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    if (guard(err)) {
      return Err(err);
    }
    throw err;
  }
}

export async function asyncTryCatchIf<T>(
  guard: (err: Error) => boolean,
  fn: () => Promise<T>,
): Promise<Result<T>> {
  try {
    return Ok(await fn());
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    if (guard(err)) {
      return Err(err);
    }
    throw err;
  }
}

export function unwrapOr<T>(result: Result<T>, fallback: T): T {
  return result.ok ? result.data : fallback;
}

export function mapResult<T, U>(result: Result<T>, fn: (data: T) => U): Result<U> {
  if (!result.ok) {
    return result as Result<U>;
  }
  return Ok(fn(result.data));
}

const FILE_ERROR_CODES = new Set([
  "ENOENT",
  "EACCES",
  "EISDIR",
  "ENOSPC",
  "EPERM",
  "ENOTDIR",
]);

export function isFileError(err: Error): boolean {
  const code = (err as NodeJS.ErrnoException).code;
  return typeof code === "string" && FILE_ERROR_CODES.has(code);
}

const NETWORK_ERROR_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EPIPE",
  "EAI_AGAIN",
]);

export function isNetworkError(err: Error): boolean {
  const code = (err as NodeJS.ErrnoException).code;
  if (typeof code === "string" && NETWORK_ERROR_CODES.has(code)) {
    return true;
  }
  if (err.name === "AbortError" || err.name === "TimeoutError") {
    return true;
  }
  if (err.name === "TypeError" && /fetch|network|socket/i.test(err.message)) {
    return true;
  }
  const msg = err.message.toLowerCase();
  return (
    msg.includes("fetch failed") ||
    msg.includes("network error") ||
    msg.includes("econnrefused") ||
    msg.includes("econnreset")
  );
}

export function isOperationalError(err: Error): boolean {
  return isFileError(err) || isNetworkError(err);
}
