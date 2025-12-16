// middleware.ts
import { NextResponse, type NextRequest } from "next/server";
import { createHash } from "crypto";

const PUBLIC_PATHS = new Set([
    "/auth/login",
    "/api/auth/login",
    "/favicon.ico",
]);

const NEXT_ASSETS = /^\/(_next|assets|fonts|images)\//;
const API_PATH = /^\/api(\/|$)/;

// Generate a hash of the password to verify cookie validity
// This ensures that when password changes, all existing sessions are invalidated
function getPasswordHash(password: string): string {
    return createHash("sha256").update(password).digest("hex").substring(0, 16);
}

export function middleware(req: NextRequest) {
    const { pathname } = req.nextUrl;

    // ✅ Always allow API routes
    if (API_PATH.test(pathname)) return NextResponse.next();

    // ✅ Allow static/public assets
    if (PUBLIC_PATHS.has(pathname) || NEXT_ASSETS.test(pathname)) return NextResponse.next();

    // ✅ Allow Next/Image loader
    if (pathname.startsWith("/_next/image")) return NextResponse.next();

    // 🔐 Auth check for everything else
    const authCookie = req.cookies.get("app_auth")?.value;
    
    if (authCookie) {
        // Check if cookie format is valid and password hash matches current password
        const currentPassword = process.env.APP_PASSWORD;
        if (currentPassword) {
            const expectedHash = getPasswordHash(currentPassword);
            
            // Support both old format (just "ok") and new format ("ok:hash")
            if (authCookie === "ok") {
                // Old format - invalidate it by redirecting to login
                // This forces re-login with new password
            } else if (authCookie.startsWith("ok:")) {
                const cookieHash = authCookie.substring(3);
                if (cookieHash === expectedHash) {
                    // Valid session with matching password hash
                    return NextResponse.next();
                }
                // Hash mismatch - password changed, invalidate session
            }
        } else {
            // No password configured - allow access (development mode)
            return NextResponse.next();
        }
    }

    // 🚪 Not authed or invalid session → redirect to login (preserve next=…)
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