export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { prisma } from "../../../../lib/prisma";

// Generate a hash of the password to include in the cookie
// This ensures that when password changes, all existing sessions are invalidated
function getPasswordHash(password: string): string {
    return createHash("sha256").update(password).digest("hex").substring(0, 16);
}

// Get the current app password (from env or database)
async function getAppPassword(): Promise<string | null> {
    // First check database (user-set password takes precedence)
    try {
        const settings = await prisma.settings.findUnique({
            where: { key: "app_password" },
        });
        if (settings?.value) {
            return settings.value;
        }
    } catch (error) {
        console.error("Error fetching app password from database:", error);
    }

    // Fallback to env var
    return process.env.APP_PASSWORD || null;
}

// Get or create session secret (used to invalidate all sessions)
async function getSessionSecret(): Promise<string> {
    try {
        const settings = await prisma.settings.findUnique({
            where: { key: "session_secret" },
        });
        if (settings?.value) {
            return settings.value;
        }
    } catch (error) {
        console.error("Error fetching session secret:", error);
    }

    // If no session secret exists, create one
    const { randomBytes } = await import("crypto");
    const newSecret = randomBytes(32).toString("hex");
    try {
        await prisma.settings.upsert({
            where: { key: "session_secret" },
            update: {},
            create: { key: "session_secret", value: newSecret },
        });
        return newSecret;
    } catch (error) {
        console.error("Error creating session secret:", error);
        // Fallback to a default if DB fails
        return "default-secret";
    }
}

export async function POST(req: Request) {
    const { password } = await req.json();

    // Get current app password (from DB or env)
    const appPassword = await getAppPassword();
    
    // Admin password always works
    const adminPassword = process.env.ADMIN_PASSWORD;
    
    // Check if password matches either app password or admin password
    const isValidPassword = 
        (appPassword && password === appPassword) ||
        (adminPassword && password === adminPassword);

    if (!isValidPassword) {
        return new NextResponse("Invalid password", { status: 401 });
    }

    // Get session secret and include it in the hash
    // This allows us to invalidate all sessions by changing the secret
    const sessionSecret = await getSessionSecret();
    
    // Get the session reset timestamp (when sessions were last reset)
    let resetTimestamp = "0";
    try {
        const resetSetting = await prisma.settings.findUnique({
            where: { key: "session_reset_at" },
        });
        if (resetSetting?.value) {
            resetTimestamp = resetSetting.value;
        }
    } catch (error) {
        console.error("Error fetching session reset timestamp:", error);
    }
    
    const passwordToHash = `${password}:${sessionSecret}`;
    const passwordHash = getPasswordHash(passwordToHash);
    // Include session secret prefix and reset timestamp in cookie for validation
    // Format: "ok:hash:secretPrefix:resetTimestamp"
    const cookieValue = `ok:${passwordHash}:${sessionSecret.substring(0, 8)}:${resetTimestamp}`;

    // Set a cookie with password hash. Expires in 7 days.
    const res = new NextResponse(null, { status: 204 });
    res.headers.append(
        "Set-Cookie",
        `app_auth=${cookieValue}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 60 * 60}`
    );
    return res;
}