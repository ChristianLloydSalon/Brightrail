import { ApiError } from "@/lib/api-error";

/** A unique constraint rejected a write. Repositories throw it; use cases turn it into a field error. */
export class DuplicateKeyError extends Error {
  constructor(readonly constraint?: string) {
    super("Duplicate key");
    this.name = "DuplicateKeyError";
  }
}

/** VALIDATION with field errors, in the shape every form expects. */
export function fieldError(fields: Record<string, string>, code: "VALIDATION" | "CONFLICT" = "VALIDATION"): ApiError {
  return new ApiError(code, "Check the highlighted fields.", fields);
}

/** Throws a field-level VALIDATION error when `errors` is non-empty. */
export function assertNoFieldErrors(errors: Record<string, string>): void {
  if (Object.keys(errors).length) throw fieldError(errors);
}

/** Runs `write`, mapping a unique-key violation to the given field error. */
export async function onDuplicate<T>(write: () => Promise<T>, toError: () => ApiError): Promise<T> {
  try {
    return await write();
  } catch (e) {
    if (e instanceof DuplicateKeyError) throw toError();
    throw e;
  }
}

/** Non-null or NOT_FOUND. */
export function found<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) throw new ApiError("NOT_FOUND", message);
  return value;
}
