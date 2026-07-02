import { ZodError } from "zod";

import { isSensitiveRedactionKey, redactSensitiveText } from "@/lib/security/redaction";

export type ApiErrorBody = {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
};

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public details?: unknown
  ) {
    super(message);
  }
}

export function json(data: unknown, status = 200) {
  return Response.json(data, { status });
}

export function created(data: unknown) {
  return json(data, 201);
}

export function noContent() {
  return new Response(null, { status: 204 });
}

export function handleApiError(error: unknown) {
  if (error instanceof ZodError) {
    return json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "The request payload is invalid.",
          details: redactSensitiveApiResponseValue(error.flatten())
        }
      } satisfies ApiErrorBody,
      422
    );
  }

  if (error instanceof ApiError) {
    return json(
      {
        error: {
          code: error.code,
          message: redactSensitiveText(error.message),
          details: redactSensitiveApiResponseValue(error.details)
        }
      } satisfies ApiErrorBody,
      error.status
    );
  }

  console.error(formatApiErrorForLog(error));
  return json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "Something went wrong."
      }
    } satisfies ApiErrorBody,
    500
  );
}

export function formatApiErrorForLog(error: unknown) {
  if (error instanceof Error) {
    return redactSensitiveText(error.stack ?? `${error.name}: ${error.message}`);
  }

  if (typeof error === "string") {
    return redactSensitiveText(error);
  }

  try {
    return redactSensitiveText(JSON.stringify(redactSensitiveApiResponseValue(error)));
  } catch {
    return "Unserializable internal API error.";
  }
}

function redactSensitiveApiResponseValue(value: unknown, key?: string, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === undefined) return undefined;
  if (isSensitiveRedactionKey(key)) return "[redacted]";
  if (typeof value === "string") return redactSensitiveText(value);
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (depth >= 8) return "[redacted]";
  if (seen.has(value)) return "[redacted]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveApiResponseValue(item, undefined, depth + 1, seen));
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
      entryKey,
      redactSensitiveApiResponseValue(entryValue, entryKey, depth + 1, seen)
    ])
  );
}
