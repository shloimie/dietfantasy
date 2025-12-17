export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";

// Lightweight endpoint to get current session reset timestamp
// Used by middleware to validate cookies
export async function GET() {
    try {
        const resetSetting = await prisma.settings.findUnique({
            where: { key: "session_reset_at" },
        });
        const resetTimestamp = resetSetting?.value || "0";
        return NextResponse.json({ resetTimestamp });
    } catch (error) {
        // If DB access fails, return 0 (no reset)
        return NextResponse.json({ resetTimestamp: "0" });
    }
}

