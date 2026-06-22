export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, body: ApiErrorBody) {
    super(body.message);
    this.name = "ApiError";
    this.status = status;
    this.code = body.code;
    this.details = body.details;
  }
}

export interface ApiClientOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
}

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL;

// Auth endpoints where a 401 means "bad/absent credentials", not "access token
// expired" — refreshing and retrying these would either recurse or mask a real
// auth failure, so they opt out of the refresh-and-retry below.
const NO_REFRESH_PATHS = ["/auth/refresh", "/auth/login", "/auth/register", "/auth/logout", "/demo/session"];

function isRefreshable(path: string): boolean {
  const p = path.startsWith("/") ? path : `/${path}`;
  return !NO_REFRESH_PATHS.some((auth) => p === auth || p.startsWith(`${auth}?`));
}

// A single in-flight refresh shared across callers: when the access token
// expires, a burst of requests (e.g. the notification poll + dashboard queries)
// all 401 at once — we want exactly one /auth/refresh, then each retries once.
let refreshPromise: Promise<boolean> | null = null;

function refreshSession(): Promise<boolean> {
  refreshPromise ??= (async () => {
    try {
      const res = await fetch(toApiUrl("/auth/refresh"), {
        method: "POST",
        credentials: "include",
      });
      return res.ok;
    } catch {
      return false;
    }
  })().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

async function rawFetch(path: string, options: ApiClientOptions): Promise<Response> {
  const { body, headers, ...init } = options;
  const requestHeaders = new Headers(headers);
  let requestBody: BodyInit | undefined;

  if (body instanceof FormData) {
    requestBody = body;
  } else if (body !== undefined) {
    requestHeaders.set("Content-Type", "application/json");
    requestBody = JSON.stringify(body);
  }

  return fetch(toApiUrl(path), {
    ...init,
    headers: requestHeaders,
    body: requestBody,
    credentials: "include",
  });
}

export async function apiClient<TResponse>(
  path: string,
  options: ApiClientOptions = {},
): Promise<TResponse> {
  let response = await rawFetch(path, options);

  // Access token likely expired: refresh once (shared) and retry the request.
  if (response.status === 401 && isRefreshable(path)) {
    const refreshed = await refreshSession();
    if (refreshed) {
      response = await rawFetch(path, options);
    }
  }

  const payload = await parseResponse(response);
  if (!response.ok) {
    throw toApiError(response.status, payload);
  }

  return payload as TResponse;
}

function toApiUrl(path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const configuredBase = apiBaseUrl();
  const base = configuredBase.endsWith("/") ? configuredBase.slice(0, -1) : configuredBase;
  return `${base}${normalizedPath}`;
}

function apiBaseUrl(): string {
  if (!API_BASE_URL) {
    throw new Error("NEXT_PUBLIC_API_URL is required");
  }
  return API_BASE_URL;
}

async function parseResponse(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  const text = await response.text();
  if (!text) return undefined;
  return JSON.parse(text) as unknown;
}

function toApiError(status: number, payload: unknown): ApiError {
  const fallback: ApiErrorBody = {
    code: "HTTP_ERROR",
    message: "Request failed",
  };

  if (
    payload
    && typeof payload === "object"
    && "error" in payload
    && payload.error
    && typeof payload.error === "object"
  ) {
    const error = payload.error as Partial<ApiErrorBody>;
    if (typeof error.code === "string" && typeof error.message === "string") {
      return new ApiError(status, {
        code: error.code,
        message: error.message,
        details: error.details,
      });
    }
  }

  return new ApiError(status, fallback);
}
