// app/api/route/generate/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import prisma from "../../../../lib/prisma";
import { planRoutesByAreaBalanced } from "../../../../utils/routing/areaBalance";

/* ========= Config ========= */
const PALETTE = [
    "#1f77b4", // deep blue
    "#ff7f0e", // orange
    "#2ca02c", // green
    "#d62728", // red
    "#9467bd", // purple
    "#8c564b", // brown
    "#e377c2", // pink
    "#17becf", // cyan
    "#bcbd22", // olive
    "#393b79", // indigo blue
    "#ad494a", // muted brick red
    "#637939", // olive green
    "#ce6dbd", // lavender-magenta
    "#8c6d31", // dark mustard
    "#7f7f7f", // mid gray-brown (neutral contrast)
];

// HQ (for optional first-stop rotation)
const ORIGIN = { lat: 41.14628538783947, lng: -73.98948195720195 };

/* ========= Helpers ========= */
type Body = { day?: string; driverCount?: number; useDietFantasyStart?: boolean };

function normalizeDay(raw?: string | null) {
    const s = String(raw ?? "all").toLowerCase().trim();
    const days = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday","all"];
    return days.includes(s) ? s : "all";
}

const s = (v: unknown) => (v == null ? "" : String(v));        // string (never null/undefined)
const n = (v: unknown) => (typeof v === "number" ? v : null);   // nullable number (coords)

function haversineMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
    const R = 3958.7613;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
function rotateAtIndex<T>(arr: T[], idx: number) {
    if (!arr.length || idx <= 0) return arr.slice();
    return [...arr.slice(idx), ...arr.slice(0, idx)];
}

async function ensureDriver(name: string, color: string, day: string) {
    const found = await prisma.driver.findFirst({ where: { name, day } });
    if (found) {
        if (found.color !== color) {
            return prisma.driver.update({
                where: { id: found.id },
                data: { color },
            });
        }
        return found;
    }
    return prisma.driver.create({
        data: { name, color, day, stopIds: [] as unknown as Prisma.InputJsonValue },
    });
}

/* ========= Handler ========= */
export async function POST(req: Request) {
    try {
        const body = (await req.json().catch(() => ({}))) as Body;
        const dayInput = normalizeDay(body.day);
        const kActive = Math.max(1, Math.min(20, body.driverCount ?? 6));
        const useDietFantasyStart = body.useDietFantasyStart !== false; // default true

        // Treat "all" as a concrete value in Stop.day (ENUM should include "all")
        type StopData = Prisma.StopUncheckedCreateInput;
        const dayValue = dayInput as StopData["day"];
        const dayWhere = { day: dayValue }; // <-- ALWAYS scope by day, even for "all"

        /* ---------- 0) Mirror latest Users -> Stops for THIS day ---------- */
        const users = await prisma.user.findMany({
            select: {
                id: true, first: true, last: true,
                address: true, apt: true, city: true, state: true, zip: true, phone: true,
                paused: true, lat: true, lng: true,
                schedule: {
                    select: {
                        monday: true, tuesday: true, wednesday: true, thursday: true,
                        friday: true, saturday: true, sunday: true,
                    }
                }
            },
            orderBy: { id: "asc" },
        });

        const isOnDay = (u: any) => {
            if (dayValue === "all") return true;
            const sc = u?.schedule;
            if (!sc) return true; // back-compat: treat missing schedule as on
            return !!sc[dayValue as keyof typeof sc];
        };

        const activeUsers = users.filter(u => !u.paused && isOnDay(u));
        const activeUserIds = new Set(activeUsers.map(u => u.id));

        // Delete stops for THIS day whose user is no longer active-for-day
        await prisma.stop.deleteMany({
            where: {
                ...dayWhere,
                OR: [
                    { userId: null },
                    { userId: { notIn: Array.from(activeUserIds) } },
                ],
            },
        });

        // Existing stops for THIS day
        const existing = await prisma.stop.findMany({
            where: { ...dayWhere, userId: { in: Array.from(activeUserIds) } },
            select: { id: true, userId: true },
            orderBy: { id: "asc" },
        });

        // De-dup: keep one stop per (userId, day), delete extras
        const seen = new Set<number>();
        const extraIds: number[] = [];
        for (const r of existing) {
            if (r.userId == null) continue;
            if (seen.has(r.userId)) extraIds.push(r.id);
            else seen.add(r.userId);
        }
        if (extraIds.length) {
            await prisma.stop.deleteMany({ where: { id: { in: extraIds } } });
        }

        // Re-read after de-dup
        const existingAfter = await prisma.stop.findMany({
            where: { ...dayWhere, userId: { in: Array.from(activeUserIds) } },
            select: { id: true, userId: true },
            orderBy: { id: "asc" },
        });
        const haveStop = new Set(existingAfter.map(x => x.userId!));

        // Create missing (ALWAYS include all required fields, NEVER null for non-nullable)
        const toCreate: StopData[] = activeUsers
            .filter(u => !haveStop.has(u.id))
            .map((u) => ({
                day: dayValue,
                userId: u.id,
                name: s(`${u.first ?? ""} ${u.last ?? ""}`.trim()) || "(Unnamed)",
                address: s(u.address),
                apt: s(u.apt),
                city: s(u.city),
                state: s(u.state),
                zip: s(u.zip),
                phone: s(u.phone),
                lat: n(u.lat),
                lng: n(u.lng),
            }));

        if (toCreate.length) {
            await prisma.stop.createMany({
                data: toCreate,
                skipDuplicates: true, // safe if you later add unique (userId, day)
            });
        }

        // Pull current snapshot for THIS day (after mirror)
        const allStops = await prisma.stop.findMany({
            where: { ...dayWhere },
            select: { id: true, userId: true, lat: true, lng: true },
            orderBy: { id: "asc" },
        });

        const pausedByUser = new Map(users.map(u => [u.id, !!u.paused]));

        // Partition for planner
        const eligibleGeoIds: number[] = [];   // geocoded + active
        const ungeocodedIds: number[] = [];    // active but missing lat/lng
        const pausedIds: number[] = [];        // paused (only for logging)

        for (const srow of allStops) {
            const paused = srow.userId != null ? !!pausedByUser.get(srow.userId) : false;
            const hasGeo = srow.lat != null && srow.lng != null;
            if (paused) {
                pausedIds.push(srow.id);
            } else if (!hasGeo) {
                ungeocodedIds.push(srow.id);
            } else {
                eligibleGeoIds.push(srow.id);
            }
        }

        /* ---------- 1) Plan ONLY geocoded stops; DO NOT put ungeocoded on Driver 0 ---------- */
        let plan = [{ driverIndex: 0, stopIds: [] as number[], count: 0 }];
        if (eligibleGeoIds.length) {
            const geoStops = await prisma.stop.findMany({
                where: { id: { in: eligibleGeoIds } },
                select: { id: true, lat: true, lng: true },
                orderBy: { id: "asc" },
            });
            const pts = geoStops
                .map((s) => ({
                    id: s.id,
                    lat: typeof s.lat === "string" ? parseFloat(s.lat) : (s.lat as number),
                    lng: typeof s.lng === "string" ? parseFloat(s.lng) : (s.lng as number),
                }))
                .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng));

            plan = planRoutesByAreaBalanced(pts, kActive);
            if (!Array.isArray(plan) || plan.length === 0) throw new Error("Planner returned no routes.");
        }

        // Planner’s outliers (geocoded but intentionally isolated)
        const plannerD0Ids: number[] = (plan[0]?.stopIds ?? []).map(Number).filter(Number.isFinite);

        /* ---------- 2) Ensure drivers for THIS day ---------- */
        const d0 = await ensureDriver("Driver 0", "#666666", dayValue as string);
        const actives = [];
        for (let i = 1; i <= kActive; i++) {
            actives.push(await ensureDriver(`Driver ${i}`, PALETTE[(i - 1) % PALETTE.length], dayValue as string));
        }

        /* ---------- 3) Clear assignments for THIS day ---------- */
        await prisma.stop.updateMany({ where: { ...dayWhere }, data: { assignedDriverId: null, order: null } });
        await prisma.driver.updateMany({ where: { day: dayValue as string }, data: { stopIds: [] as unknown as Prisma.InputJsonValue } });

        /* ---------- 4) Assign ONLY the planned geocoded buckets ---------- */
        let assignedActiveCount = 0;
        for (let i = 1; i < plan.length; i++) {
            const ids: number[] = (plan[i]?.stopIds ?? []).map(Number).filter(Number.isFinite);
            const drv = actives[i - 1];
            if (!drv) continue;

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
            assignedActiveCount += ids.length;
        }

        /* ---------- 5) Assign ONLY planner outliers to Driver 0; leave ungeocoded UNASSIGNED ---------- */
        if (plannerD0Ids.length) {
            await prisma.stop.updateMany({
                where: { id: { in: plannerD0Ids } },
                data: { assignedDriverId: d0.id, order: null },
            });
        }
        await prisma.driver.update({
            where: { id: d0.id },
            data: { stopIds: plannerD0Ids as unknown as Prisma.InputJsonValue },
        });

        /* ---------- 6) Optional: rotate active driver routes to start near HQ ---------- */
        if (useDietFantasyStart) {
            for (const drv of actives) {
                const rec = await prisma.driver.findUnique({
                    where: { id: drv.id },
                    select: { id: true, stopIds: true },
                });
                if (!rec) continue;

                const ids: number[] = Array.isArray(rec.stopIds)
                    ? (rec.stopIds as Array<number | string | null>)
                        .map((v) => (v == null ? NaN : Number(v)))
                        .filter((n) => Number.isFinite(n)) as number[]
                    : [];

                if (!ids.length) continue;

                const stopsForDriver = await prisma.stop.findMany({
                    where: { id: { in: ids } },
                    select: { id: true, lat: true, lng: true },
                });
                const byId = new Map(stopsForDriver.map((s) => [s.id, s]));

                let bestIdx = 0;
                let bestDist = Number.POSITIVE_INFINITY;
                ids.forEach((sid, idx) => {
                    const p = byId.get(sid);
                    const lat = typeof p?.lat === "string" ? parseFloat(p!.lat as any) : (p?.lat as number);
                    const lng = typeof p?.lng === "string" ? parseFloat(p!.lng as any) : (p?.lng as number);
                    if (Number.isFinite(lat) && Number.isFinite(lng)) {
                        const dMi = haversineMiles(ORIGIN, { lat, lng });
                        if (dMi < bestDist) { bestDist = dMi; bestIdx = idx; }
                    }
                });

                const rotated = rotateAtIndex(ids, bestIdx);
                await prisma.$transaction(
                    rotated.map((sid, j) =>
                        prisma.stop.update({ where: { id: sid }, data: { order: j + 1 } })
                    )
                );
                await prisma.driver.update({
                    where: { id: drv.id },
                    data: { stopIds: rotated as unknown as Prisma.InputJsonValue },
                });
            }
        }

        /* ---------- 7) Remove any drivers beyond 0..kActive for THIS day ---------- */
        const keepNames = new Set<string>(Array.from({ length: kActive + 1 }, (_, i) => `Driver ${i}`));
        const present = await prisma.driver.findMany({
            where: { day: dayValue as string },
            select: { id: true, name: true },
        });
        const keepIds = new Set<number>(present.filter((d) => keepNames.has(d.name)).map((d) => d.id));

        await prisma.driver.updateMany({
            where: { day: dayValue as string, id: { notIn: Array.from(keepIds) } },
            data: { stopIds: [] as unknown as Prisma.InputJsonValue },
        });
        await prisma.driver.deleteMany({ where: { day: dayValue as string, id: { notIn: Array.from(keepIds) } } });

        /* ---------- 8) Breakdown (no ungeocoded assigned anywhere) ---------- */
        const totals = {
            scopeDay: String(dayValue),
            usersTotal: users.length,
            usersActiveForDay: activeUsers.length,
            totalStopsInScope: (await prisma.stop.count({ where: { ...dayWhere } })), // after mirror+dedupe
            // routing buckets
            eligibleGeo: eligibleGeoIds.length,
            paused: pausedIds.length,
            ungeocoded: ungeocodedIds.length,
            plannerOutliersToD0: plannerD0Ids.length,
            assignedActiveDrivers: assignedActiveCount,
            assignedDriver0: plannerD0Ids.length,
            totalAssigned: assignedActiveCount + plannerD0Ids.length,
            leftoverUnassigned: allStops.length - (assignedActiveCount + plannerD0Ids.length), // these are exactly the ungeocoded now
        };

        // Extra detail: log example IDs for debugging
        console.log("[/api/route/generate] Breakdown:", totals, {
            sampleUngeocodedIds: ungeocodedIds.slice(0, 10),
            samplePausedIds: pausedIds.slice(0, 10),
            samplePlannerD0Ids: plannerD0Ids.slice(0, 10),
        });

        return NextResponse.json({
            ok: true,
            appliedStartRotation: useDietFantasyStart,
            origin: ORIGIN,
            message: `Assigned ${totals.totalAssigned} geocoded stops (${totals.assignedActiveDrivers} active + ${totals.assignedDriver0} outliers). Ungeocoded kept unassigned: ${totals.ungeocoded}.`,
            summary: totals,
        });
    } catch (e: any) {
        console.error("[/api/route/generate] Error:", e);
        return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
    }
}