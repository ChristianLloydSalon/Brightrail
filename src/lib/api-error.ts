/** Error envelope shared by server and client (spec §10): { code, message, requestId, fieldErrors }. */
export type ApiErrorCode = "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "VALIDATION" | "CONFLICT" | "NETWORK" | "RATE_LIMITED" | "NOT_CONFIGURED" | "INTERNAL";

export interface ApiErrorShape {
  code: ApiErrorCode;
  message: string;
  requestId: string;
  fieldErrors?: Record<string, string>;
}

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly requestId: string;
  readonly fieldErrors?: Record<string, string>;
  constructor(code: ApiErrorCode, message: string, fieldErrors?: Record<string, string>, requestId?: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.requestId = requestId ?? `req_${Math.random().toString(36).slice(2, 12)}`;
    this.fieldErrors = fieldErrors;
  }
  toJSON(): ApiErrorShape {
    return { code: this.code, message: this.message, requestId: this.requestId, fieldErrors: this.fieldErrors };
  }
}

export type Result<T> = { ok: true; data: T } | { ok: false; error: ApiErrorShape };

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
}
export type SortDir = "asc" | "desc";
