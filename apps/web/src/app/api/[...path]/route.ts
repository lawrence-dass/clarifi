import { type NextRequest, NextResponse } from "next/server";

const UPSTREAM_URL = process.env.API_UPSTREAM_URL;

type ProxyContext = {
  params: Promise<{ path: string[] }>;
};

export async function GET(request: NextRequest, context: ProxyContext) {
  return proxy(request, context);
}

export async function POST(request: NextRequest, context: ProxyContext) {
  return proxy(request, context);
}

export async function PUT(request: NextRequest, context: ProxyContext) {
  return proxy(request, context);
}

export async function PATCH(request: NextRequest, context: ProxyContext) {
  return proxy(request, context);
}

export async function DELETE(request: NextRequest, context: ProxyContext) {
  return proxy(request, context);
}

async function proxy(request: NextRequest, context: ProxyContext) {
  const { path } = await context.params;
  const upstream = new URL(`/${path.join("/")}${request.nextUrl.search}`, upstreamUrl());
  const headers = buildForwardHeaders(request);
  const response = await fetch(upstream, {
    method: request.method,
    headers,
    body: hasBody(request.method) ? request.body : undefined,
    duplex: hasBody(request.method) ? "half" : undefined,
    redirect: "manual",
  } as RequestInit & { duplex?: "half" });

  const nextResponse = new NextResponse(response.body, {
    status: response.status,
    statusText: response.statusText,
  });

  response.headers.forEach((value, key) => {
    if (key.toLowerCase() !== "set-cookie") nextResponse.headers.set(key, value);
  });
  const setCookies = response.headers.getSetCookie?.() ?? fallbackSetCookie(response.headers);
  for (const cookie of setCookies) {
    nextResponse.headers.append("Set-Cookie", rewriteSetCookieForBff(cookie));
  }

  return nextResponse;
}

function upstreamUrl(): string {
  if (!UPSTREAM_URL) {
    throw new Error("API_UPSTREAM_URL is required");
  }
  return UPSTREAM_URL;
}

function buildForwardHeaders(request: NextRequest): Headers {
  const headers = new Headers();
  for (const [key, value] of request.headers) {
    const lower = key.toLowerCase();
    if (lower === "host" || lower === "content-length") continue;
    headers.set(key, value);
  }
  const cookie = request.headers.get("cookie");
  if (cookie) headers.set("cookie", cookie);
  return headers;
}

function hasBody(method: string): boolean {
  return method !== "GET" && method !== "HEAD";
}

function fallbackSetCookie(headers: Headers): string[] {
  const cookie = headers.get("set-cookie");
  return cookie ? [cookie] : [];
}

export function rewriteSetCookieForBff(cookie: string): string {
  return cookie.replace(/;\s*Path=\/auth(?=;|$)/i, "; Path=/api/auth");
}
