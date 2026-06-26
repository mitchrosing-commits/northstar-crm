import { ZodError } from "zod";

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
          details: error.flatten()
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
          message: error.message,
          details: error.details
        }
      } satisfies ApiErrorBody,
      error.status
    );
  }

  console.error(error);
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
