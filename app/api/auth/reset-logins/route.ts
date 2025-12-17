export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { randomBytes } from "crypto";

export async function POST(req: Request) {
    try {
        // Verify admin password from request body or header
        const { adminPassword } = await req.json().catch(() => ({}));
        const adminPasswordEnv = process.env.ADMIN_PASSWORD;
        
        if (!adminPasswordEnv) {
            return NextResponse.json(
                { error: "Admin password not configured" },
                { status: 500 }
            );
        }
        
        if (adminPassword !== adminPasswordEnv) {
            return NextResponse.json(
                { error: "Invalid admin password" },
                { status: 401 }
            );
        }
        
        // Generate a new session secret
        // This will invalidate all existing cookies because their hash won't match
        const newSecret = randomBytes(32).toString("hex");
        
        await prisma.settings.upsert({
            where: { key: "session_secret" },
            update: { value: newSecret },
            create: { key: "session_secret", value: newSecret },
        });

        // Also store a timestamp of when sessions were reset
        // This allows middleware to invalidate old cookies
        const resetTimestamp = Date.now().toString();
        await prisma.settings.upsert({
            where: { key: "session_reset_at" },
            update: { value: resetTimestamp },
            create: { key: "session_reset_at", value: resetTimestamp },
        });

        // Clear the current user's cookie by returning a response that expires it
        const response = NextResponse.json({ 
            success: true,
            message: "All user sessions have been invalidated. You will be logged out."
        });
        
        // Clear the auth cookie
        response.headers.append(
            "Set-Cookie",
            "app_auth=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT"
        );
        
        return response;
    } catch (error: any) {
        console.error("Reset logins error:", error);
        return NextResponse.json(
            { error: error.message || "Failed to reset logins" },
            { status: 500 }
        );
    }
}

