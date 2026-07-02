import { vi } from "vitest";

type WorkspacesRouteModule = typeof import("@/app/api/v1/workspaces/route");
type WorkspaceDetailRouteModule = typeof import("@/app/api/v1/workspaces/[workspaceId]/route");
type WorkspaceRouteModule = typeof import("@/app/api/v1/workspaces/[workspaceId]/[...segments]/route");
type QuotePdfRouteModule = typeof import("@/app/deals/[dealId]/quotes/[quoteId]/pdf/route");
type WorkspacesRouteHandler = (request: Request) => Promise<Response>;
type WorkspaceDetailRouteHandler = (
  request: Request,
  context: { params: Promise<{ workspaceId: string }> }
) => Promise<Response>;
type WorkspaceRouteHandler = (
  request: Request,
  context: { params: Promise<{ workspaceId: string; segments?: string[] }> }
) => Promise<Response>;
type QuotePdfRouteHandler = (
  request: Request,
  context: { params: Promise<{ dealId: string; quoteId: string }> }
) => Promise<Response>;

type InvokeWorkspacesApiOptions = {
  method: "GET" | "POST";
  actorUserId?: string;
  body?: unknown;
  rawBody?: string;
};

type InvokeWorkspaceDetailApiOptions = {
  method: "GET";
  workspaceId: string;
  actorUserId?: string;
};

type InvokeWorkspaceApiOptions = {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  workspaceId: string;
  segments?: string[];
  actorUserId?: string;
  body?: unknown;
  rawBody?: string;
  query?: string | URLSearchParams;
};

type InvokeQuotePdfRouteOptions = {
  actorUserId?: string;
  selectedWorkspaceId?: string;
  dealId: string;
  quoteId: string;
};

const mockHeaderState = vi.hoisted(() => ({
  headers: new Headers(),
  cookies: new Map<string, string>()
}));

vi.mock("next/headers", () => ({
  headers: async () => mockHeaderState.headers,
  cookies: async () => ({
    get: (name: string) => {
      const value = mockHeaderState.cookies.get(name);
      return value ? { name, value } : undefined;
    }
  })
}));

let workspacesRouteModule: Promise<WorkspacesRouteModule> | undefined;
let workspaceDetailRouteModule: Promise<WorkspaceDetailRouteModule> | undefined;
let workspaceRouteModule: Promise<WorkspaceRouteModule> | undefined;
let quotePdfRouteModule: Promise<QuotePdfRouteModule> | undefined;

export async function invokeWorkspacesApi({
  method,
  actorUserId,
  body,
  rawBody
}: InvokeWorkspacesApiOptions) {
  setMockHeaders(actorUserId);
  const route = await loadWorkspacesRouteModule();
  const handler = route[method] as WorkspacesRouteHandler | undefined;

  if (!handler) {
    throw new Error(`Workspaces API route does not export a ${method} handler.`);
  }

  return withTrustedHeaderAuth(actorUserId, () => handler(createRequest("api/v1/workspaces", method, body, rawBody)));
}

export async function invokeWorkspaceDetailApi({
  method,
  workspaceId,
  actorUserId
}: InvokeWorkspaceDetailApiOptions) {
  setMockHeaders(actorUserId);
  const route = await loadWorkspaceDetailRouteModule();
  const handler = route[method] as WorkspaceDetailRouteHandler | undefined;

  if (!handler) {
    throw new Error(`Workspace detail API route does not export a ${method} handler.`);
  }

  return withTrustedHeaderAuth(actorUserId, () => handler(createRequest(`api/v1/workspaces/${workspaceId}`, method), {
    params: Promise.resolve({ workspaceId })
  }));
}

export async function invokeWorkspaceApi({
  method,
  workspaceId,
  segments = [],
  actorUserId,
  body,
  rawBody,
  query
}: InvokeWorkspaceApiOptions) {
  setMockHeaders(actorUserId);
  const route = await loadWorkspaceRouteModule();
  const handler = route[method] as WorkspaceRouteHandler | undefined;

  if (!handler) {
    throw new Error(`Workspace API route does not export a ${method} handler.`);
  }

  const queryString = typeof query === "string" ? query : query?.toString();
  const path = `${["api", "v1", "workspaces", workspaceId, ...segments].join("/")}${queryString ? `?${queryString}` : ""}`;
  const request = createRequest(path, method, body, rawBody);

  return withTrustedHeaderAuth(actorUserId, () => handler(request, {
    params: Promise.resolve({ workspaceId, segments })
  }));
}

export async function invokeQuotePdfRoute({
  actorUserId,
  selectedWorkspaceId,
  dealId,
  quoteId
}: InvokeQuotePdfRouteOptions) {
  setMockHeaders(actorUserId, selectedWorkspaceId);
  const route = await loadQuotePdfRouteModule();
  const handler = route.GET as QuotePdfRouteHandler | undefined;

  if (!handler) {
    throw new Error("Quote PDF route does not export a GET handler.");
  }

  return withTrustedHeaderAuth(actorUserId, () => handler(createRequest(`deals/${dealId}/quotes/${quoteId}/pdf`, "GET"), {
    params: Promise.resolve({ dealId, quoteId })
  }));
}

export async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  return JSON.parse(text) as T;
}

function setMockHeaders(actorUserId?: string, selectedWorkspaceId?: string) {
  mockHeaderState.headers = new Headers(actorUserId ? { "x-user-id": actorUserId } : undefined);
  mockHeaderState.cookies = new Map(selectedWorkspaceId ? [["northstar_workspace", selectedWorkspaceId]] : undefined);
}

function createRequest(path: string, method: string, body?: unknown, rawBody?: string) {
  const headers = new Headers();
  const init: RequestInit = { method, headers };

  if (rawBody !== undefined) {
    headers.set("content-type", "application/json");
    init.body = rawBody;
  } else if (body !== undefined) {
    headers.set("content-type", "application/json");
    init.body = JSON.stringify(body);
  }

  return new Request(`http://localhost/${path}`, init);
}

async function withTrustedHeaderAuth<T>(actorUserId: string | undefined, callback: () => Promise<T>) {
  if (!actorUserId) return callback();

  const previousAuthMode = process.env.AUTH_MODE;
  const previousAuthUserIdHeader = process.env.AUTH_USER_ID_HEADER;
  process.env.AUTH_MODE = "trusted-header";
  process.env.AUTH_USER_ID_HEADER = "x-user-id";

  try {
    return await callback();
  } finally {
    restoreEnv("AUTH_MODE", previousAuthMode);
    restoreEnv("AUTH_USER_ID_HEADER", previousAuthUserIdHeader);
  }
}

function restoreEnv(key: "AUTH_MODE" | "AUTH_USER_ID_HEADER", value: string | undefined) {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

function loadWorkspacesRouteModule() {
  workspacesRouteModule ??= import("@/app/api/v1/workspaces/route");
  return workspacesRouteModule;
}

function loadWorkspaceDetailRouteModule() {
  workspaceDetailRouteModule ??= import("@/app/api/v1/workspaces/[workspaceId]/route");
  return workspaceDetailRouteModule;
}

function loadWorkspaceRouteModule() {
  workspaceRouteModule ??= import("@/app/api/v1/workspaces/[workspaceId]/[...segments]/route");
  return workspaceRouteModule;
}

function loadQuotePdfRouteModule() {
  quotePdfRouteModule ??= import("@/app/deals/[dealId]/quotes/[quoteId]/pdf/route");
  return quotePdfRouteModule;
}
