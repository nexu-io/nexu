interface Env {
  LANDING: Fetcher;
  APP: Fetcher;
  API_ORIGIN: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // API reverse proxy
    if (url.pathname.startsWith("/api/")) {
      const target = new URL(url.pathname + url.search, env.API_ORIGIN);
      const headers = new Headers(request.headers);
      headers.set("Host", new URL(env.API_ORIGIN).host);
      return fetch(target, {
        method: request.method,
        headers,
        body: request.body,
      });
    }

    // Main app routes + its static assets
    if (
      url.pathname.startsWith("/workspace") ||
      url.pathname.startsWith("/auth") ||
      url.pathname.startsWith("/claim") ||
      url.pathname.startsWith("/invite") ||
      url.pathname.startsWith("/assets/") ||
      url.pathname.startsWith("/toolkit-icons/")
    ) {
      return env.APP.fetch(request);
    }

    // Root path: check better-auth session cookie
    if (url.pathname === "/") {
      const cookie = request.headers.get("Cookie") || "";
      const hasSession = cookie.includes("better-auth.session_token");
      if (hasSession) {
        return Response.redirect(
          new URL("/workspace", request.url).toString(),
          302,
        );
      }
    }

    // Everything else → landing page
    return env.LANDING.fetch(request);
  },
} satisfies ExportedHandler<Env>;
