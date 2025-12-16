export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { createHash } from "crypto";

// Generate a hash of the password to include in the cookie
// This ensures that when password changes, all existing sessions are invalidated
function getPasswordHash(password: string): string {
    return createHash("sha256").update(password).digest("hex").substring(0, 16);
}

export async function POST(req: Request) {
    const { password } = await req.json();

    if (!process.env.APP_PASSWORD) {
        return new NextResponse("Server not configured", { status: 500 });
    }
    if (password !== process.env.APP_PASSWORD) {
        return new NextResponse("Invalid password", { status: 401 });
    }

    // Include password hash in cookie so changing password invalidates all sessions
    const passwordHash = getPasswordHash(process.env.APP_PASSWORD);
    const cookieValue = `ok:${passwordHash}`;

    // Set a cookie with password hash. Expires in 7 days.
    const res = new NextResponse(null, { status: 204 });
    res.headers.append(
        "Set-Cookie",
        `app_auth=${cookieValue}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 60 * 60}`
    );
    return res;
}