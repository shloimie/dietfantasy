// app/api/route/rename-driver/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import prisma from "../../../../lib/prisma";

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { driverId, newNumber } = body;

        if (!driverId || newNumber == null) {
            return NextResponse.json(
                { ok: false, error: "driverId and newNumber are required" },
                { status: 400 }
            );
        }

        const newNum = Number(newNumber);

        // Validate newNumber
        if (!Number.isInteger(newNum) || newNum < 1 || newNum > 99) {
            return NextResponse.json(
                { ok: false, error: "Driver number must be between 1 and 99" },
                { status: 400 }
            );
        }

        // Don't allow renaming to 0 (reserved)
        if (newNum === 0) {
            return NextResponse.json(
                { ok: false, error: "Driver 0 is reserved for outliers" },
                { status: 400 }
            );
        }

        // Find the driver to rename
        const driver = await prisma.driver.findUnique({
            where: { id: Number(driverId) },
        });

        if (!driver) {
            return NextResponse.json(
                { ok: false, error: "Driver not found" },
                { status: 404 }
            );
        }

        // Check if this is Driver 0 (can't rename Driver 0)
        const isDriver0 = /driver\s+0/i.test(driver.name || "");
        if (isDriver0) {
            return NextResponse.json(
                { ok: false, error: "Cannot rename Driver 0" },
                { status: 400 }
            );
        }

        const newName = `Driver ${newNum}`;

        // Check if another driver already has this number (for the same day)
        const existing = await prisma.driver.findFirst({
            where: {
                day: driver.day,
                name: newName,
                NOT: { id: Number(driverId) },
            },
        });

        if (existing) {
            return NextResponse.json(
                { ok: false, error: `Driver ${newNum} already exists for this day` },
                { status: 400 }
            );
        }

        // Update the driver's name
        const updated = await prisma.driver.update({
            where: { id: Number(driverId) },
            data: { name: newName },
        });

        return NextResponse.json({ ok: true, driver: updated });
    } catch (error: any) {
        console.error("[rename-driver] Error:", error);
        return NextResponse.json(
            { ok: false, error: error.message || "Failed to rename driver" },
            { status: 500 }
        );
    }
}
