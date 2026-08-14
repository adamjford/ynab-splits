import { data, redirect } from "react-router";

const REQUIRED_HEADERS: Record<string, string> = {
  "Cache-Control": "private, no-store, max-age=0",
  "Vary": "Cookie",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' ws: wss:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  "X-Frame-Options": "DENY",
};

export function securityHeaders(existing?: HeadersInit): Headers {
  const headers = new Headers(existing);
  for (const [name, value] of Object.entries(REQUIRED_HEADERS)) headers.set(name, value);
  return headers;
}

export function secureData<T>(value: T, init?: number | ResponseInit) {
  if (typeof init === "number") return data(value, { status: init, headers: securityHeaders() });
  return data(value, { ...init, headers: securityHeaders(init?.headers) });
}

export function secureRedirect(url: string, init?: number | ResponseInit): Response {
  if (typeof init === "number") return redirect(url, { status: init, headers: securityHeaders() });
  return redirect(url, { ...init, headers: securityHeaders(init?.headers) });
}

export function secureResponse(response: Response): Response {
  const headers = securityHeaders(response.headers);
  for (const [name, value] of headers) response.headers.set(name, value);
  return response;
}
