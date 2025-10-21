// app/api/route/routes/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import prisma from "../../../../lib/prisma";

const sid = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/** Extract numeric from "Driver X"; unknowns go to end */
function driverRankByName(name: unknown) {
    const m = /driver\s+(\d+)/i.exec(String(name || ""));
    return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
}

/** Coerce Prisma Decimal | string | number | null -> number | null */
function toNum(v: unknown): number | null {
    if (v == null) return null;
    const n = Number(v as any);
    return Number.isFinite(n) ? n : null;
}

export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const day = (searchParams.get("day") || "all").toLowerCase();

        const driverWhere = day === "all" ? {} : { day };

        // 1) Drivers filtered by day (if not "all")
        const driversRaw = await prisma.driver.findMany({ where: driverWhere });

        // 2) All stops (do NOT filter by day; legacy rows may not have it)
        const allStops = await prisma.stop.findMany({
            orderBy: { id: "asc" },
            select: {
                id: true,
                userId: true,
                // denormalized copies on Stop (fallbacks)
                address: true,
                apt: true,
                city: true,
                state: true,
                zip: true,
                phone: true,
                lat: true,
                lng: true,
            },
        });

        // 3) Fetch all Users for the userIds we saw in stops
        const userIdSet = new Set<number>();
        for (const s of allStops) if (typeof s.userId === "number") userIdSet.add(s.userId);
        const userIds = Array.from(userIdSet);

        const users = userIds.length
            ? await prisma.user.findMany({
                where: { id: { in: userIds } },
                select: {
                    id: true,
                    first: true,
                    last: true,
                    address: true,
                    apt: true,
                    city: true,
                    state: true,
                    zip: true,
                    phone: true,
                    lat: true,
                    lng: true,
                },
            })
            : [];

        const userById = new Map(users.map((u) => [u.id, u]));

        // 4) Sort drivers so Driver 0,1,2… are in that order
        const drivers = [...driversRaw].sort(
            (a, b) => driverRankByName(a.name) - driverRankByName(b.name)
        );

        // 5) Hydrate each stop, preferring live User fields when available
        const stopById = new Map<
            string,
            {
                id: number;
                userId: number | null;
                name: string;
                address: string;
                apt: string;
                city: string;
                state: string;
                zip: string;
                phone: string;
                lat: number | null;
                lng: number | null;
            }
        >();

        for (const s of allStops) {
            const u = s.userId != null ? userById.get(s.userId) : undefined;
            const name = [u?.first, u?.last].filter(Boolean).join(" ").trim() || "(Unnamed)";

            stopById.set(sid(s.id), {
                id: s.id,
                userId: s.userId ?? null,
                name,

                // prefer live user fields; fallback to stop’s denorm copies
                address: (u?.address ?? s.address ?? "") as string,
                apt: (u?.apt ?? s.apt ?? "") as string,
                city: (u?.city ?? s.city ?? "") as string,
                state: (u?.state ?? s.state ?? "") as string,
                zip: (u?.zip ?? s.zip ?? "") as string,
                phone: (u?.phone ?? s.phone ?? "") as string,

                lat: toNum(u?.lat ?? s.lat),
                lng: toNum(u?.lng ?? s.lng),
            });
        }

        // 6) Build driver routes strictly from their stopIds
        const routes = drivers.map((d) => {
            const ids: any[] = Array.isArray(d.stopIds) ? d.stopIds : [];
            const stops: any[] = [];
            for (const raw of ids) {
                const hyd = stopById.get(sid(raw));
                if (hyd) stops.push(hyd);
            }
            return {
                driverId: d.id,
                driverName: d.name,
                color: d.color,
                stops,
            };
        });

        // 7) Unrouted = all hydrated stops not referenced by any driver's current list
        const claimed = new Set(routes.flatMap((r) => r.stops.map((s) => sid(s.id))));
        const unrouted: any[] = [];
        for (const [k, v] of stopById.entries()) {
            if (!claimed.has(k)) unrouted.push(v);
        }

        return NextResponse.json(
            { routes, unrouted },
            { headers: { "Cache-Control": "no-store" } }
        );
    } catch (e: any) {
        console.error("routes GET error", e);
        // Return empty set so UI doesn't crash
        return NextResponse.json({ routes: [], unrouted: [] }, { status: 200 });
    }
}