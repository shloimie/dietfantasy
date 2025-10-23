export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import prisma from "../../../../lib/prisma";

type SnapshotDriver = { name: string; color?: string | null; stopIds?: number[] };

export async function POST(req: Request) {
    try {
        const { runId } = await req.json();
        const run = await prisma.routeRun.findUnique({ where: { id: Number(runId) } });
        if (!run) return NextResponse.json({ ok:false, error:"RouteRun not found" }, { status: 404 });

        const day = run.day;
        const snap = (run.snapshot ?? []) as SnapshotDriver[];
        if (!Array.isArray(snap) || snap.length === 0) {
            return NextResponse.json({ ok:false, error:"Empty snapshot" }, { status: 400 });
        }

        // 1) Ensure every snapshot driver exists (match by exact name+day)
        const ensureDriver = async (name: string, color: string | null) => {
            const found = await prisma.driver.findFirst({ where: { name, day } });
            if (found) {
                if (color && found.color !== color) {
                    return prisma.driver.update({ where: { id: found.id }, data: { color } });
                }
                return found;
            }
            return prisma.driver.create({
                data: { name, day, color: color ?? "#7f7f7f", stopIds: [] as unknown as Prisma.InputJsonValue },
            });
        };

        const realized: { id:number; name:string; color:string|null; stopIds:number[] }[] = [];
        for (const d of snap) {
            const drv = await ensureDriver(d.name, (d.color ?? null));
            realized.push({
                id: drv.id,
                name: drv.name,
                color: drv.color,
                stopIds: (d.stopIds ?? []).map(Number).filter(Number.isFinite),
            });
        }

        // 2) Clear all assignments for this day
        await prisma.stop.updateMany({ where: { day }, data: { assignedDriverId: null, order: null } });
        await prisma.driver.updateMany({ where: { day }, data: { stopIds: [] as unknown as Prisma.InputJsonValue } });

        // 3) Apply snapshot: set driver.stopIds and stop.assignedDriverId/order
        for (const drv of realized) {
            const ids = drv.stopIds;
            if (ids.length) {
                await prisma.$transaction(
                    ids.map((stopId, idx) =>
                        prisma.stop.update({
                            where: { id: stopId },
                            data: { assignedDriverId: drv.id, order: idx + 1 },
                        })
                    )
                );
            }
            await prisma.driver.update({
                where: { id: drv.id },
                data: { stopIds: ids as unknown as Prisma.InputJsonValue },
            });
        }

        // 4) Remove drivers for this day that are not in snapshot (safety: keep by exact name match)
        const keepNames = new Set(snap.map(d => d.name));
        const present = await prisma.driver.findMany({ where: { day }, select: { id:true, name:true } });
        const toDelete = present.filter(d => !keepNames.has(d.name)).map(d => d.id);
        if (toDelete.length) {
            // clear their stops (should be none after step 2, but belt/suspenders)
            await prisma.driver.updateMany({
                where: { id: { in: toDelete } },
                data: { stopIds: [] as unknown as Prisma.InputJsonValue },
            });
            await prisma.driver.deleteMany({ where: { id: { in: toDelete } } });
        }

        return NextResponse.json({ ok:true, appliedRunId: run.id, day });
    } catch (e:any) {
        console.error("[/api/route/apply-run] error:", e);
        return NextResponse.json({ ok:false, error: e?.message || "Unknown error" }, { status: 500 });
    }
}