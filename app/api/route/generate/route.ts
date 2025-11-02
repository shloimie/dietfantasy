// app/api/route/generate/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import prisma from "../../../../lib/prisma";
import { planRoutesByAreaBalanced } from "../../../../utils/routing/areaBalance";

/* ========= Config ========= */
const PALETTE = [
    "#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd",
    "#8c564b", "#e377c2", "#17becf", "#bcbd22", "#393b79",
    "#ad494a", "#637939", "#ce6dbd", "#8c6d31", "#7f7f7f",
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

const s = (v: unknown) => (v == null ? "" : String(v));
const n = (v: unknown) => (typeof v === "number" ? v : null);

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

/** Treat any falsy-delivery as paused for routing purposes */
function isDeliverable(u: any) {
    // support either "delivery" or "Delivery" in DB
    const v = (u?.delivery ?? u?.Delivery);
    // default true if missing
    return v === undefined || v === null ? true : Boolean(v);
}

/* ========= Handler ========= */
export async function POST(req: Request) {
    try {
        const body = (await req.json().catch(() => ({}))) as Body;
        const dayInput = normalizeDay(body.day);
        const kActive = Math.max(1, Math.min(20, body.driverCount ?? 6));
        const useDietFantasyStart = body.useDietFantasyStart !== false; // default true

        type StopData = Prisma.StopUncheckedCreateInput;
        const dayValue = dayInput as StopData["day"];
        const dayWhere = { day: dayValue };

        /* ---------- 0) Mirror latest Users -> Stops for THIS day ---------- */
        const users = await prisma.user.findMany({
            select: {
                id: true, first: true, last: true,
                address: true, apt: true, city: true, state: true, zip: true, phone: true,
                paused: true, lat: true, lng: true,
                delivery: true,
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
            if (!sc) return true; // back-compat
            return !!sc[dayValue as keyof typeof sc];
        };

        // ACTIVE = not paused AND deliverable AND (on day)
        const activeUsers = users.filter(u => !u.paused && isDeliverable(u) && isOnDay(u));
        const activeUserIds = new Set(activeUsers.map(u => u.id));

        // 🔥 Purge stops for THIS day if user is missing, paused, or not deliverable
        await prisma.stop.deleteMany({
            where: {
                ...dayWhere,
                OR: [
                    { userId: null },
                    { userId: { notIn: Array.from(activeUserIds) } },
                ],
            },
        });

        // Existing stops for this day among active userIds
        const existing = await prisma.stop.findMany({
            where: { ...dayWhere, userId: { in: Array.from(activeUserIds) } },
            select: { id: true, userId: true },
            orderBy: { id: "asc" },
        });

        // De-dup: keep one stop per (userId, day)
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

        // Create missing for ACTIVE (deliverable && !paused)
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
            await prisma.stop.createMany({ data: toCreate, skipDuplicates: true });
        }

        // Pull current snapshot for THIS day (after mirror)
        const allStops = await prisma.stop.findMany({
            where: { ...dayWhere },
            select: { id: true, userId: true, lat: true, lng: true },
            orderBy: { id: "asc" },
        });

        const pausedOrNoDeliveryByUser = new Map(
            users.map(u => [u.id, (!!u.paused || !isDeliverable(u))])
        );

        // Partition for planner
        const eligibleGeoIds: number[] = [];
        const ungeocodedIds: number[] = [];
        const excludedIds: number[] = []; // paused or delivery=false (for logging)

        for (const srow of allStops) {
            const excluded = srow.userId != null ? !!pausedOrNoDeliveryByUser.get(srow.userId) : true;
            const hasGeo = srow.lat != null && srow.lng != null;
            if (excluded) {
                excludedIds.push(srow.id);
            } else if (!hasGeo) {
                ungeocodedIds.push(srow.id);
            } else {
                eligibleGeoIds.push(srow.id);
            }
        }

        /* ---------- 1) Plan ONLY geocoded stops; leave ungeocoded unassigned ---------- */
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

        /* ---------- 6) Optional start rotation ---------- */
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
                        .filter((num) => Number.isFinite(num)) as number[]
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

        /* ---------- 7) Remove any drivers beyond 0..kActive ---------- */
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

        /* ---------- 8) Breakdown ---------- */
        const totals = {
            scopeDay: String(dayValue),
            usersTotal: users.length,
            usersActiveForDay: activeUsers.length,
            totalStopsInScope: (await prisma.stop.count({ where: { ...dayWhere } })),
            eligibleGeo: eligibleGeoIds.length,
            excludedPausedOrNoDelivery: excludedIds.length,
            ungeocoded: ungeocodedIds.length,
            plannerOutliersToD0: plannerD0Ids.length,
            assignedActiveDrivers: assignedActiveCount,
            assignedDriver0: plannerD0Ids.length,
            totalAssigned: assignedActiveCount + plannerD0Ids.length,
            leftoverUnassigned: (await prisma.stop.count({ where: { ...dayWhere, assignedDriverId: null } })),
        };

        /* ---------- 9) Save snapshot to RouteRun (keep 10) ---------- */
        try {
            const driversForDay = await prisma.driver.findMany({
                where: { day: dayValue as string },
                select: { name: true, color: true, stopIds: true },
                orderBy: { id: "asc" },
            });

            const snapshot = (driversForDay || []).map(d => ({
                name: d.name,
                color: d.color,
                stopIds: Array.isArray(d.stopIds)
                    ? (d.stopIds as Array<number | string | null>).map(v => (v == null ? NaN : Number(v))).filter(Number.isFinite) as number[]
                    : [],
            }));

            const created = await prisma.routeRun.create({
                data: { day: String(dayValue), snapshot: snapshot as unknown as Prisma.InputJsonValue },
                select: { id: true },
            });

            const toPrune = await prisma.routeRun.findMany({
                where: { day: String(dayValue) },
                orderBy: { createdAt: "desc" },
                skip: 10,
                select: { id: true },
            });
            if (toPrune.length) {
                await prisma.routeRun.deleteMany({ where: { id: { in: toPrune.map(r => r.id) } } });
            }
            console.log("[/api/route/generate] snapshot saved RouteRun.id =", created.id);
        } catch (snapErr) {
            console.warn("[/api/route/generate] snapshot save failed:", snapErr);
        }

        return NextResponse.json({
            ok: true,
            appliedStartRotation: useDietFantasyStart,
            origin: ORIGIN,
            message: `Assigned ${totals.totalAssigned} geocoded stops. Ungeocoded left unassigned: ${totals.ungeocoded}. Excluded (paused or no delivery): ${totals.excludedPausedOrNoDelivery}.`,
            summary: totals,
        });
    } catch (e: any) {
        console.error("[/api/route/generate] Error:", e);
        return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
    }
}