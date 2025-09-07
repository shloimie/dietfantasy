// middleware.ts
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = [
    "/auth/login",
    "/api/auth/login", // allow login API
    "/favicon.ico",
];

const NEXT_ASSETS = /^\/(_next|assets|fonts|images)\//;

export function middleware(req: NextRequest) {
    const { pathname } = req.nextUrl;

    // allow public and Next.js assets
    if (PUBLIC_PATHS.includes(pathname) || NEXT_ASSETS.test(pathname)) {
        return NextResponse.next();
    }

    // allow dietfantasy remote logo (Next/Image fetch) – skip gating
    if (pathname.startsWith("/_next/image")) {
        return NextResponse.next();
    }

    // has auth cookie?
    const auth = req.cookies.get("app_auth")?.value;
    if (auth === "ok") return NextResponse.next();

    // otherwise redirect to /auth/login
    const url = req.nextUrl.clone();
    url.pathname = "/auth/login";
    url.searchParams.set("next", pathname || "/");
    return NextResponse.redirect(url);
}

export const config = {
    // protect everything by default
    matcher: "/:path*",
};