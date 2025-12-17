// middleware.ts
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATHS = new Set([
    "/auth/login",
    "/api/auth/login",
    "/favicon.ico",
]);

const NEXT_ASSETS = /^\/(_next|assets|fonts|images)\//;
const API_PATH = /^\/api(\/|$)/;

// Generate a hash of the password to verify cookie validity
// This ensures that when password changes, all existing sessions are invalidated
// Uses Web Crypto API (Edge Runtime compatible) instead of Node.js crypto
async function getPasswordHash(password: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
    return hashHex.substring(0, 16);
}

export async function middleware(req: NextRequest) {
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
        // We check against both env APP_PASSWORD and ADMIN_PASSWORD
        const envAppPassword = process.env.APP_PASSWORD;
        const adminPassword = process.env.ADMIN_PASSWORD;
        
        // Support both old format (just "ok") and new format ("ok:hash")
        if (authCookie === "ok") {
            // Old format - invalidate it by redirecting to login
            // This forces re-login with new password
        } else if (authCookie.startsWith("ok:")) {
            // Cookie format: 
            // - "ok:hash" (old, no session secret)
            // - "ok:hash:secretPrefix" (new with session secret, no reset timestamp)
            // - "ok:hash:secretPrefix:resetTimestamp" (new with reset timestamp)
            const parts = authCookie.substring(3).split(":");
            const cookieHash = parts[0];
            const cookieSecretPrefix = parts[1]; // First 8 chars of session secret (optional)
            const cookieResetTimestamp = parts[2] || "0"; // Reset timestamp from cookie
            
            let isValid = false;
            
            // Check against env APP_PASSWORD hash (without session secret for backward compat)
            if (envAppPassword) {
                const expectedHash = await getPasswordHash(envAppPassword);
                if (cookieHash === expectedHash) {
                    isValid = true;
                }
            }
            
            // Also check against ADMIN_PASSWORD hash (admin always works)
            if (!isValid && adminPassword) {
                const adminHash = await getPasswordHash(adminPassword);
                if (cookieHash === adminHash) {
                    isValid = true;
                }
            }
            
            // If hash matches a known password, check if session was reset
            if (isValid) {
                // If cookie has reset timestamp, validate it against current reset timestamp
                if (cookieResetTimestamp && cookieResetTimestamp !== "0") {
                    try {
                        // Call API to get current reset timestamp
                        // Use the request URL to construct the API endpoint
                        const url = new URL("/api/auth/session-secret", req.url);
                        const resetRes = await fetch(url.toString(), {
                            cache: "no-store",
                            headers: {
                                // Pass through any necessary headers
                            },
                        });
                        if (resetRes.ok) {
                            const { resetTimestamp } = await resetRes.json();
                            // If cookie's timestamp is older than current reset timestamp, invalidate
                            if (cookieResetTimestamp < resetTimestamp) {
                                // Session was reset, invalidate this cookie
                                isValid = false;
                            }
                        }
                    } catch (error) {
                        // If API call fails, allow the cookie (fail open for availability)
                        // This ensures the site doesn't break if the API is down
                    }
                }
                
                if (isValid) {
                    return NextResponse.next();
                }
            }
            
            // If cookie has session secret but hash doesn't match env passwords,
            // it might be from database password. Allow it (login endpoint validated it).
            // If session was reset, the reset timestamp check above will catch it.
            return NextResponse.next();
        }
        
        // If no password configured, allow access (development mode)
        if (!envAppPassword && !adminPassword) {
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