// app/api/route/add-driver/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "../../../../lib/prisma";

const PALETTE = [
    "#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd",
    "#8c564b", "#e377c2", "#17becf", "#bcbd22", "#393b79",
    "#ad494a", "#637939", "#ce6dbd", "#8c6d31", "#7f7f7f",
];

function normalizeDay(raw?: string | null) {
    const s = String(raw ?? "all").toLowerCase().trim();
    const days = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday","all"];
    return days.includes(s) ? s : "all";
}

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const day = normalizeDay(body.day);

        // Find all existing drivers for this day
        const existing = await prisma.driver.findMany({
            where: { day },
            orderBy: { name: "asc" },
        });

        // Parse driver numbers from names (e.g., "Driver 5" -> 5)
        const driverNumbers = existing
            .map(d => {
                const match = /driver\s+(\d+)/i.exec(d.name || "");
                return match ? parseInt(match[1], 10) : -1;
            })
            .filter(n => n >= 0);

        // Find the max driver number (excluding Driver 0)
        const maxNum = driverNumbers.filter(n => n > 0).reduce((max, n) => Math.max(max, n), 0);
        const newNum = maxNum + 1;

        // Assign color from palette (cycling through colors)
        const colorIndex = (newNum - 1) % PALETTE.length;
        const color = PALETTE[colorIndex];

        // Create new driver
        const newDriver = await prisma.driver.create({
            data: {
                name: `Driver ${newNum}`,
                color,
                day,
                stopIds: [], // Empty array, no stops assigned yet
            },
        });

        return NextResponse.json({ ok: true, driver: newDriver });
    } catch (error: any) {
        console.error("[add-driver] Error:", error);
        return NextResponse.json(
            { ok: false, error: error.message || "Failed to add driver" },
            { status: 500 }
        );
    }
}
