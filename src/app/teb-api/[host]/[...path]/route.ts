import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const TARGETS: Record<string, string> = {
  master: "https://mastersv4api.tebsys.com",
  user: "https://userv4api.tebsys.com",
  dynamic: "https://dynamicv4api.tebsys.com",
  company: "https://companyv4api.tebsys.com",
  template: "https://templatev4api.tebsys.com",
  micro: "https://gateway.tebsys.com",
};

const FORWARD = new Set([
  "authorization",
  "type",
  "deviceinfo",
  "deviceaddress",
  "apihitdate",
  "accept",
  "content-type",
]);

const MAX_BODY_BYTES = 1_000_000;

function isPublicPath(host: string, path: string[]): boolean {
  const joined = path.join("/").toLowerCase();
  if (host === "micro" && joined.includes("getlogin")) return true;
  if (host === "user" && joined.includes("acuserforgotpassword")) return true;
  return false;
}

function safeSegments(path: string[]): string[] | null {
  if (!path.length || path.length > 24) return null;
  const cleaned: string[] = [];
  for (const segment of path) {
    if (!segment || segment === "." || segment === ".." || segment.includes("\\") || /[\u0000-\u001f]/.test(segment)) {
      return null;
    }
    cleaned.push(segment);
  }
  return cleaned;
}

function hasAuthHeader(request: NextRequest): boolean {
  const auth = request.headers.get("authorization") || request.headers.get("x-teb-authorization");
  return Boolean(auth?.trim());
}

async function proxy(request: NextRequest, host: string, path: string[]): Promise<Response> {
  const targetBase = TARGETS[host.toLowerCase()];
  if (!targetBase) {
    return Response.json({ error: "Unknown host" }, { status: 404 });
  }
  const segments = safeSegments(path);
  if (!segments) {
    return Response.json({ error: "Invalid path" }, { status: 400 });
  }
  if (!isPublicPath(host.toLowerCase(), segments) && !hasAuthHeader(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const query = request.nextUrl.searchParams.toString();
  const search = query ? `?${query}` : "";
  const target = `${targetBase}/${segments.join("/")}${search}`;
  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (FORWARD.has(key.toLowerCase())) headers.set(key, value);
  });
  const auth = request.headers.get("authorization") || request.headers.get("x-teb-authorization");
  if (auth) headers.set("Authorization", auth);
  const method = request.method.toUpperCase();
  let body: string | undefined;
  if (method !== "GET" && method !== "HEAD") {
    body = await request.text();
    if (body.length > MAX_BODY_BYTES) {
      return Response.json({ error: "Payload too large" }, { status: 413 });
    }
  }
  let res: Response;
  try {
    res = await fetch(target, {
      method,
      headers,
      cache: "no-store",
      body,
    });
  } catch {
    return Response.json({ error: "Upstream unavailable" }, { status: 502 });
  }
  const responseBody = await res.arrayBuffer();
  const responseHeaders = new Headers();
  const contentType = res.headers.get("content-type");
  if (contentType) responseHeaders.set("content-type", contentType);
  if (res.status === 204 || res.status === 205) {
    return new Response(null, { status: res.status, headers: responseHeaders });
  }
  return new Response(responseBody, { status: res.status, headers: responseHeaders });
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ host: string; path: string[] }> },
) {
  const { host, path } = await context.params;
  return proxy(request, host, path);
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ host: string; path: string[] }> },
) {
  const { host, path } = await context.params;
  return proxy(request, host, path);
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ host: string; path: string[] }> },
) {
  const { host, path } = await context.params;
  return proxy(request, host, path);
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ host: string; path: string[] }> },
) {
  const { host, path } = await context.params;
  return proxy(request, host, path);
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ host: string; path: string[] }> },
) {
  const { host, path } = await context.params;
  return proxy(request, host, path);
}
