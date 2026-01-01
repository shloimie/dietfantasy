export const runtime = "edge";

import { NextResponse } from "next/server";

// Lightweight endpoint to get current password hash for middleware
// This runs on Edge runtime so it's fast
export async function GET() {
    // For Edge runtime, we can only access env vars
    // The middleware will check against env APP_PASSWORD as primary
    // Database-stored password validation happens at login time
    const appPassword = process.env.APP_PASSWORD || "";
    
    if (!appPassword) {
        return NextResponse.json({ hash: null });
    }
    
    // Generate hash using Web Crypto (Edge compatible)
    const encoder = new TextEncoder();
    const data = encoder.encode(appPassword);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
    const hash = hashHex.substring(0, 16);
    
    return NextResponse.json({ hash });
}


