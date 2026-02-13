export const runtime = "nodejs";
import { NextResponse } from "next/server";
import prisma from "../../../../lib/prisma";

/**
 * GET /api/export/backup
 * Returns a single JSON object with everything needed for a full backup:
 * - users (with schedule embedded)
 * - signatures
 * - routes
 * - drivers
 * - stops
 * - routeRuns
 * Excludes: CityColor, standalone Schedule (schedule is inside each user).
 */
export async function GET() {
    const exportedAt = new Date().toISOString();
    const filename = `backup-${exportedAt.slice(0, 19).replace(/:/g, "-")}.json`;

    // Run each query separately so one failing table doesn't drop the rest; always include all keys
    let users: Awaited<ReturnType<typeof prisma.user.findMany>> = [];
    let signatures: Awaited<ReturnType<typeof prisma.signature.findMany>> = [];
    let routes: Awaited<ReturnType<typeof prisma.route.findMany>> = [];
    let drivers: Awaited<ReturnType<typeof prisma.driver.findMany>> = [];
    let stops: Awaited<ReturnType<typeof prisma.stop.findMany>> = [];
    let routeRuns: Awaited<ReturnType<typeof prisma.routeRun.findMany>> = [];

    try {
        users = await prisma.user.findMany({
            orderBy: [{ city: "asc" }, { last: "asc" }],
            include: { schedule: true },
        });
    } catch (e) {
        console.error("GET /api/export/backup users failed:", e);
    }
    try {
        signatures = await prisma.signature.findMany({
            orderBy: [{ userId: "asc" }, { slot: "asc" }],
        });
    } catch (e) {
        console.error("GET /api/export/backup signatures failed:", e);
    }
    try {
        routes = await prisma.route.findMany();
    } catch (e) {
        console.error("GET /api/export/backup routes failed:", e);
    }
    try {
        drivers = await prisma.driver.findMany({ orderBy: [{ day: "asc" }] });
    } catch (e) {
        console.error("GET /api/export/backup drivers failed:", e);
    }
    try {
        stops = await prisma.stop.findMany({
            orderBy: [{ day: "asc" }, { order: "asc" }],
        });
    } catch (e) {
        console.error("GET /api/export/backup stops failed:", e);
    }
    try {
        routeRuns = await prisma.routeRun.findMany({
            orderBy: [{ day: "asc" }, { createdAt: "desc" }],
        });
    } catch (e) {
        console.error("GET /api/export/backup routeRuns failed:", e);
    }

    // Signature.id is BigInt; JSON.stringify doesn't handle BigInt, so stringify ids
    const signaturesSerializable = signatures.map((s) => ({
        ...s,
        id: String(s.id),
    }));

    const backup = {
        exportedAt,
        users,
        signatures: signaturesSerializable,
        routes,
        drivers,
        stops,
        routeRuns,
    };

    return new NextResponse(JSON.stringify(backup, null, 2), {
        status: 200,
        headers: {
            "Content-Type": "application/json",
            "Content-Disposition": `attachment; filename="${filename}"`,
        },
    });
}
