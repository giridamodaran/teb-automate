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

async function proxy(request: NextRequest, host: string, path: string[]): Promise<Response> {
  const targetBase = TARGETS[host.toLowerCase()];
  if (!targetBase) {
    return Response.json({ error: "Unknown host" }, { status: 404 });
  }
  const query = request.nextUrl.searchParams.toString();
  const search = query ? `?${query}` : request.nextUrl.search;
  const target = `${targetBase}/${path.join("/")}${search}`;
  const headers = new Headers();
  request.headers.forEach((value, key) => {
    if (FORWARD.has(key.toLowerCase())) headers.set(key, value);
  });
  const auth = request.headers.get("authorization") || request.headers.get("x-teb-authorization");
  if (auth) headers.set("Authorization", auth);
  const method = request.method.toUpperCase();
  const res = await fetch(target, {
    method,
    headers,
    cache: "no-store",
    body: method === "GET" || method === "HEAD" ? undefined : await request.text(),
  });
  const body = await res.arrayBuffer();
  const responseHeaders = new Headers();
  const contentType = res.headers.get("content-type");
  if (contentType) responseHeaders.set("content-type", contentType);
  responseHeaders.set("x-teb-proxy-target", target);
  responseHeaders.set("x-teb-proxy-auth", headers.has("authorization") ? "yes" : "no");
  if (res.status === 204 || res.status === 205) {
    return new Response(null, { status: res.status, headers: responseHeaders });
  }
  return new Response(body, { status: res.status, headers: responseHeaders });
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
