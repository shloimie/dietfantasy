// middleware.ts
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = new Set([
    "/auth/login",
    "/api/auth/login",
    "/favicon.ico",
]);

const NEXT_ASSETS = /^\/(_next|assets|fonts|images)\//;
const API_PATH = /^\/api(\/|$)/;

export function middleware(req: NextRequest) {
    const { pathname } = req.nextUrl;

    // ✅ Always allow API routes
    if (API_PATH.test(pathname)) return NextResponse.next();

    // ✅ Allow static/public assets
    if (PUBLIC_PATHS.has(pathname) || NEXT_ASSETS.test(pathname)) return NextResponse.next();

    // ✅ Allow Next/Image loader
    if (pathname.startsWith("/_next/image")) return NextResponse.next();

    // 🔐 Auth check for everything else
    const auth = req.cookies.get("app_auth")?.value;
    if (auth === "ok") return NextResponse.next();

    // 🚪 Not authed → redirect to login (preserve next=…)
    const url = req.nextUrl.clone();
    url.pathname = "/auth/login";
    url.searchParams.set("next", pathname || "/");
    return NextResponse.redirect(url);
}

// ✅ Do NOT run middleware on /drivers, /sign, or any subpath under them
export const config = {
    matcher: [
        // Run on everything EXCEPT: api, _next, assets, fonts, images, favicon, drivers/*, sign/*
        "/((?!api|_next|assets|fonts|images|favicon\\.ico|drivers|sign).*)",
    ],
};