export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";

export async function POST(req: Request) {
    try {
        const { adminPassword, newPassword } = await req.json();

        // Verify admin password
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

        // Validate new password
        if (!newPassword || typeof newPassword !== "string") {
            return NextResponse.json(
                { error: "New password is required" },
                { status: 400 }
            );
        }

        if (newPassword.length < 3) {
            return NextResponse.json(
                { error: "New password must be at least 3 characters" },
                { status: 400 }
            );
        }

        // Store the new password in database
        await prisma.settings.upsert({
            where: { key: "app_password" },
            update: { value: newPassword },
            create: { key: "app_password", value: newPassword },
        });

        return NextResponse.json({ success: true });
    } catch (error: any) {
        console.error("Change password error:", error);
        return NextResponse.json(
            { error: error.message || "Failed to change password" },
            { status: 500 }
        );
    }
}

