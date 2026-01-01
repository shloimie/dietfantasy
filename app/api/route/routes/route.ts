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
        //    ⬇️ include dislikes so we can fall back to stop-level denorms if present
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
                dislikes: true,  // <-- NEW
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
                    dislikes: true, // <-- NEW
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
                dislikes: string; // <-- NEW
            }
        >();

        for (const s of allStops) {
            const u = s.userId != null ? userById.get(s.userId) : undefined;
            const name =
                [u?.first, u?.last].filter(Boolean).join(" ").trim() || "(Unnamed)";

            // prefer live user value; fall back to stop’s denorm
            const dislikes =
                (u?.dislikes ?? s.dislikes ?? "") as string;

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

                // ensure labels receive dislikes at the top level
                dislikes: typeof dislikes === "string" ? dislikes.trim() : "",
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

        // 8) Check users without stops, create missing stops, and log reasons
        const allUsers = await prisma.user.findMany({
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
                paused: true,
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

        // Check which users have stops for THIS day
        const dayWhere = day === "all" ? {} : { day };
        const stopsForDay = await prisma.stop.findMany({
            where: dayWhere,
            select: { userId: true },
        });
        const usersWithStops = new Set<number>();
        for (const s of stopsForDay) {
            if (typeof s.userId === "number") {
                usersWithStops.add(s.userId);
            }
        }

        const isDeliverable = (u: any) => {
            const v = (u?.delivery ?? u?.Delivery);
            return v === undefined || v === null ? true : Boolean(v);
        };

        const isOnDay = (u: any, dayValue: string) => {
            if (dayValue === "all") return true;
            const sc = u?.schedule;
            if (!sc) return true; // back-compat
            return !!sc[dayValue as keyof typeof sc];
        };

        const s = (v: unknown) => (v == null ? "" : String(v));
        const n = (v: unknown) => (typeof v === "number" ? v : null);

        // Build list of users without stops and their reasons
        // Also create stops for users who should have them
        const usersWithoutStops: Array<{ id: number; name: string; reason: string }> = [];
        const stopsToCreate: Array<{
            day: string;
            userId: number;
            name: string;
            address: string;
            apt: string | null;
            city: string;
            state: string;
            zip: string;
            phone: string | null;
            lat: number | null;
            lng: number | null;
        }> = [];

        for (const user of allUsers) {
            if (!usersWithStops.has(user.id)) {
                const reasons: string[] = [];
                
                if (user.paused) {
                    reasons.push("paused");
                }
                if (!isDeliverable(user)) {
                    reasons.push("delivery off");
                }
                if (!isOnDay(user, day)) {
                    reasons.push(`not on schedule (${day})`);
                }
                
                const name = `${user.first || ""} ${user.last || ""}`.trim() || "Unnamed";
                
                // If user should have a stop (no valid reasons), create it
                if (reasons.length === 0) {
                    stopsToCreate.push({
                        day: day,
                        userId: user.id,
                        name: name || "(Unnamed)",
                        address: s(user.address),
                        apt: user.apt ? s(user.apt) : null,
                        city: s(user.city),
                        state: s(user.state),
                        zip: s(user.zip),
                        phone: user.phone ? s(user.phone) : null,
                        lat: n(user.lat),
                        lng: n(user.lng),
                    });
                } else {
                    // User has a valid reason for not having a stop, log it
                    const reason = reasons.join(", ");
                    usersWithoutStops.push({ id: user.id, name, reason });
                }
            }
        }

        // Create missing stops for users who should have them
        if (stopsToCreate.length > 0) {
            // Add users who are getting stops created to the response for logging
            for (const stopData of stopsToCreate) {
                const userName = stopData.name;
                usersWithoutStops.push({ 
                    id: stopData.userId, 
                    name: userName, 
                    reason: "creating stop now" 
                });
            }
            
            try {
                await prisma.stop.createMany({ 
                    data: stopsToCreate, 
                    skipDuplicates: true 
                });
            } catch (e: any) {
                // If createMany fails due to unique constraint, try creating one at a time
                // This handles cases where stops might already exist
                console.warn(`[route/routes] createMany failed, creating stops individually:`, e?.message);
                for (const stopData of stopsToCreate) {
                    try {
                        await prisma.stop.create({ data: stopData });
                    } catch (createError: any) {
                        // Skip if stop already exists (unique constraint)
                        if (createError?.code !== 'P2002') {
                            console.error(`[route/routes] Failed to create stop for user ${stopData.userId}:`, createError?.message);
                        }
                    }
                }
            }
        }

        return NextResponse.json(
            { routes, unrouted, usersWithoutStops },
            { headers: { "Cache-Control": "no-store" } }
        );
    } catch (e: any) {
        console.error("routes GET error", e);
        // Return empty set so UI doesn't crash
        return NextResponse.json({ routes: [], unrouted: [] }, { status: 200 });
    }
}