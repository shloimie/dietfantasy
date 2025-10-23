export const runtime = "nodejs";

import { NextResponse } from "next/server";
import prisma from "../../../../../lib/prisma";

type Body = { day?: string; runId?: number | string };

function normalizeDay(raw?: string | null) {
    const s = String(raw ?? "all").toLowerCase().trim();
    const days = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday","all"];
    return days.includes(s) ? s : "all";
}

async function buildSnapshot(day: string) {
    const drivers = await prisma.driver.findMany({
        where: { day },
        select: { name: true, color: true, stopIds: true },
        orderBy: { id: "asc" },
    });
    return (drivers || []).map(d => ({
        name: d.name,
        color: d.color,
        stopIds: Array.isArray(d.stopIds)
            ? (d.stopIds as Array<number | string | null>)
                .map(v => (v == null ? NaN : Number(v)))
                .filter(n => Number.isFinite(n)) as number[]
            : [],
    }));
}

/** Save current driver/stop state into a RouteRun.
 *  - If body.runId is provided: update THAT run (keeps its timestamp).
 *  - Else: update latest run for the day; if none, create a new one.
 */
export async function POST(req: Request) {
    try {
        const body = (await req.json().catch(() => ({}))) as Body;
        const day = normalizeDay(body.day);
        const runId = body.runId != null ? Number(body.runId) : null;

        const snapshot = await buildSnapshot(day);

        if (Number.isFinite(runId as any)) {
            // Explicitly update the run the user is working on
            const exists = await prisma.routeRun.findUnique({ where: { id: runId! }, select: { id: true, day: true } });
            if (!exists) {
                return NextResponse.json({ ok: false, error: "RouteRun not found" }, { status: 404 });
            }
            if (exists.day !== day) {
                return NextResponse.json({ ok: false, error: "Day mismatch for RouteRun" }, { status: 400 });
            }
            await prisma.routeRun.update({ where: { id: runId! }, data: { snapshot } });
            return NextResponse.json({ ok: true, updatedRunId: runId });
        }

        // Fallback: update latest; or create if none
        const latest = await prisma.routeRun.findFirst({
            where: { day },
            orderBy: { createdAt: "desc" },
            select: { id: true },
        });

        if (latest?.id) {
            await prisma.routeRun.update({ where: { id: latest.id }, data: { snapshot } });
            return NextResponse.json({ ok: true, updatedRunId: latest.id });
        } else {
            const created = await prisma.routeRun.create({ data: { day, snapshot }, select: { id: true } });
            return NextResponse.json({ ok: true, createdRunId: created.id });
        }
    } catch (e: any) {
        console.error("[/api/route/runs/save-current] error:", e);
        return NextResponse.json({ ok: false, error: e?.message || "Unknown error" }, { status: 500 });
    }
}