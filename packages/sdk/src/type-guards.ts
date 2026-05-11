/** Runtime type guards (mirrors historic spawn-shared package layout). */

/** Extract union of all values from a const object or readonly tuple. */
export type ValueOf<T> = T extends readonly (infer U)[] ? U : T[keyof T];

/** Type guard: returns true for non-null, non-array objects (plain objects). */
export function isPlainObject(val: unknown): val is Record<string, unknown> {
  return val !== null && typeof val === "object" && !Array.isArray(val);
}

export function isString(val: unknown): val is string {
  return typeof val === "string";
}

export function isNumber(val: unknown): val is number {
  return typeof val === "number";
}

export function hasStatus(err: unknown): err is {
  status: number;
} {
  return err !== null && typeof err === "object" && "status" in err && typeof err.status === "number";
}

export function getErrorMessage(err: unknown): string {
  return err && typeof err === "object" && "message" in err ? String(err.message) : String(err);
}

export function toRecord(val: unknown): Record<string, unknown> | null {
  if (isPlainObject(val)) {
    return val;
  }
  return null;
}

export function toObjectArray(val: unknown): Record<string, unknown>[] {
  if (!Array.isArray(val)) {
    return [];
  }
  return val.filter((item): item is Record<string, unknown> => isPlainObject(item));
}
