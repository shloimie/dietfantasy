// app/api/route/remove-driver/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "../../../../lib/prisma";

function normalizeDay(raw?: string | null) {
    const s = String(raw ?? "all").toLowerCase().trim();
    const days = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday","all"];
    return days.includes(s) ? s : "all";
}

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { driverId } = body;
        const day = normalizeDay(body.day);

        if (!driverId) {
            return NextResponse.json(
                { ok: false, error: "driverId is required" },
                { status: 400 }
            );
        }

        // Find the driver
        const driver = await prisma.driver.findUnique({
            where: { id: Number(driverId) },
        });

        if (!driver) {
            return NextResponse.json(
                { ok: false, error: "Driver not found" },
                { status: 404 }
            );
        }

        // Check if this is Driver 0 (reserved for outliers)
        const isDriver0 = /driver\s+0/i.test(driver.name || "");
        if (isDriver0) {
            return NextResponse.json(
                { ok: false, error: "Cannot remove Driver 0 (reserved for outliers)" },
                { status: 400 }
            );
        }

        // Check if driver has assigned stops
        const stopIds = Array.isArray(driver.stopIds) ? driver.stopIds : [];
        if (stopIds.length > 0) {
            return NextResponse.json(
                { ok: false, error: `Driver has ${stopIds.length} assigned stop(s). Please reassign them first.` },
                { status: 400 }
            );
        }

        // Count total active drivers (excluding Driver 0)
        const allDrivers = await prisma.driver.findMany({
            where: { day },
        });
        const activeDrivers = allDrivers.filter(d => !/driver\s+0/i.test(d.name || ""));

        if (activeDrivers.length <= 1) {
            return NextResponse.json(
                { ok: false, error: "Cannot remove the last active driver" },
                { status: 400 }
            );
        }

        // Delete the driver
        await prisma.driver.delete({
            where: { id: Number(driverId) },
        });

        return NextResponse.json({ ok: true });
    } catch (error: any) {
        console.error("[remove-driver] Error:", error);
        return NextResponse.json(
            { ok: false, error: error.message || "Failed to remove driver" },
            { status: 500 }
        );
    }
}
