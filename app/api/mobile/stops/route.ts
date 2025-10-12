// app/api/mobile/stops/route.ts
import { NextResponse } from "next/server";
import { Stop, User } from "@prisma/client";
import prisma from "../../../../lib/prisma";

export const dynamic = "force-dynamic";

// Narrow types to match selected fields below (adjust if you change selects)
type StopLite = Pick<
    Stop,
    | "id"
    | "userId"
    | "name"
    | "address"
    | "apt"
    | "city"
    | "state"
    | "zip"
    | "phone"
    | "lat"
    | "lng"
    | "order"
    | "completed"
    | "proofUrl"
>;
type UserLite = Pick<
    User,
    "id" | "first" | "last" | "address" | "city" | "state" | "zip"
>;

/**
 * Returns the ordered stops for a given driverId, with basic user info.
 * Query: ?driverId=123
 */
export async function GET(req: Request) {
    const url = new URL(req.url);
    const driverIdParam = url.searchParams.get("driverId");

    if (!driverIdParam) {
        return NextResponse.json(
            { error: "Missing required query param: driverId" },
            { status: 400 }
        );
    }

    const driverId = Number(driverIdParam);
    if (!Number.isFinite(driverId)) {
        return NextResponse.json(
            { error: "Invalid driverId" },
            { status: 400 }
        );
    }

    try {
        // 1) Fetch driver w/ stopIds
        const driver = await prisma.driver.findUnique({
            where: { id: driverId },
            select: { id: true, name: true, color: true, stopIds: true },
        });

        if (!driver) {
            return NextResponse.json(
                { error: `Driver ${driverId} not found` },
                { status: 404 }
            );
        }

        const orderedIds = (Array.isArray(driver.stopIds) ? driver.stopIds : [])
            .map((n) => Number(n))
            .filter(Number.isFinite);

        if (orderedIds.length === 0) {
            return NextResponse.json({
                driver: { id: driver.id, name: driver.name, color: driver.color },
                stops: [],
            });
        }

        // 2) Load stops for those IDs
        const stops = (await prisma.stop.findMany({
            where: { id: { in: orderedIds } },
            select: {
                id: true,
                userId: true,
                name: true,
                address: true,
                apt: true,
                city: true,
                state: true,
                zip: true,
                phone: true,
                lat: true,
                lng: true,
                order: true,
                completed: true,
                proofUrl: true,
            },
        })) as StopLite[];

        // Typed map for id -> Stop (or StopLite). Useful to restore original driver order
        const stopById = new Map<number, StopLite>();
        for (const s of stops) stopById.set(s.id, s);

        // 3) Load related users for enrichment (only those present)
        const userIds = Array.from(
            new Set(stops.map((s) => s.userId).filter((v): v is number => !!v))
        );

        let users: UserLite[] = [];
        if (userIds.length) {
            users = (await prisma.user.findMany({
                where: { id: { in: userIds } },
                select: {
                    id: true,
                    first: true,
                    last: true,
                    address: true,
                    city: true,
                    state: true,
                    zip: true,
                },
            })) as UserLite[];
        }

        // ✅ Build a typed User map (fixes your Map constructor error)
        const userMap = new Map<number, UserLite>();
        for (const u of users) userMap.set(u.id, u);

        // 4) Emit stops in the driver's intended order, filtered to those that still exist
        const orderedStops = orderedIds
            .filter((id) => stopById.has(id))
            .map((id) => {
                const s = stopById.get(id)!; // safe after .has
                const u = s.userId ? userMap.get(s.userId) ?? null : null;

                return {
                    id: s.id,
                    userId: s.userId ?? null,
                    name: s.name,
                    address: s.address,
                    apt: s.apt ?? null,
                    city: s.city,
                    state: s.state,
                    zip: s.zip,
                    phone: s.phone ?? null,
                    lat: s.lat ?? null,
                    lng: s.lng ?? null,
                    order: s.order ?? null,
                    completed: s.completed,
                    proofUrl: s.proofUrl ?? null,
                    // Minimal embedded user info for display
                    user: u
                        ? {
                            id: u.id,
                            first: u.first,
                            last: u.last,
                            address: u.address,
                            city: u.city,
                            state: u.state,
                            zip: u.zip,
                        }
                        : null,
                };
            });

        return NextResponse.json({
            driver: { id: driver.id, name: driver.name, color: driver.color },
            stops: orderedStops,
        });
    } catch (e) {
        console.error("[mobile/stops] error:", e);
        // Return a safe shape for the app
        return NextResponse.json(
            { driver: { id: driverId, name: null, color: null }, stops: [] },
            { status: 200 }
        );
    }
}