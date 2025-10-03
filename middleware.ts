// middleware.ts
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = new Set([
    "/auth/login",
    "/api/auth/login", // login API stays open
    "/favicon.ico",
]);

const NEXT_ASSETS = /^\/(_next|assets|fonts|images)\//;
// Allow ALL API routes (incl. /api/mobile/*) to bypass auth
const API_PATH = /^\/api(\/|$)/;

export function middleware(req: NextRequest) {
    const { pathname } = req.nextUrl;

    // ✅ Always allow API routes (return JSON, not HTML)
    if (API_PATH.test(pathname)) {
        return NextResponse.next();
    }

    // ✅ Allow public pages and Next/static assets
    if (PUBLIC_PATHS.has(pathname) || NEXT_ASSETS.test(pathname)) {
        return NextResponse.next();
    }

    // ✅ Allow Next/Image loader
    if (pathname.startsWith("/_next/image")) {
        return NextResponse.next();
    }

    // 🔐 Auth check for everything else
    const auth = req.cookies.get("app_auth")?.value;
    if (auth === "ok") return NextResponse.next();

    // 🚪 Not authed → redirect to login (preserve next=…)
    const url = req.nextUrl.clone();
    url.pathname = "/auth/login";
    url.searchParams.set("next", pathname || "/");
    return NextResponse.redirect(url);
}

// Limit middleware to non-API, non-static paths (extra safety)
export const config = {
    matcher: [
        "/((?!api|_next|assets|fonts|images|favicon.ico).*)",
    ],
};
