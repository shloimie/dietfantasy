// app/api/route/cleanup/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import prisma from "../../../../lib/prisma";

function normalizeDay(raw?: string | null) {
    const s = String(raw ?? "all").toLowerCase().trim();
    const days = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday","all"];
    return days.includes(s) ? s : "all";
}
function isDeliverable(u: any) {
    const v = (u?.delivery ?? u?.Delivery);
    return v === undefined || v === null ? true : Boolean(v);
}

export async function POST(req: NextRequest) {
    try {
        const day = normalizeDay(new URL(req.url).searchParams.get("day"));
        const dayWhere = { day };

        // Load users (id, paused, delivery flags)
        const users = await prisma.user.findMany({
            select: { id: true, paused: true, delivery: true,},
        });
        const okUserIds = new Set(
            users.filter(u => !u.paused && isDeliverable(u)).map(u => u.id)
        );

        // Delete invalid stops for this day
        const delRes = await prisma.stop.deleteMany({
            where: {
                ...dayWhere,
                OR: [
                    { userId: null },
                    { userId: { notIn: Array.from(okUserIds) } },
                ],
            },
        });

        // Keep a set of existing stop ids for day
        const existingStops = await prisma.stop.findMany({
            where: { ...dayWhere },
            select: { id: true },
        });
        const goodStopIds = new Set(existingStops.map(s => s.id));

        // Scrub drivers' stopIds to only valid stop ids
        const drivers = await prisma.driver.findMany({
            where: { day },
            select: { id: true, stopIds: true },
        });
        let driversPatched = 0;
        for (const d of drivers) {
            const raw = Array.isArray(d.stopIds) ? d.stopIds : [];
            const filtered = raw
                .map((v: any) => Number(v))
                .filter((n: any) => Number.isFinite(n) && goodStopIds.has(n));
            const changed = filtered.length !== raw.length;
            if (changed) {
                await prisma.driver.update({
                    where: { id: d.id },
                    data: { stopIds: filtered as any },
                });
                driversPatched++;
            }
        }

        // Clear assignedDriverId for any stop pointing to a non-existent driver (paranoia)
        const driverIds = new Set((await prisma.driver.findMany({ where: { day }, select: { id: true } })).map(d => d.id));
        const orphanStops = await prisma.stop.findMany({
            where: {
                ...dayWhere,
                assignedDriverId: { not: null },
            },
            select: { id: true, assignedDriverId: true },
        });
        const toClear = orphanStops.filter(s => !driverIds.has(Number(s.assignedDriverId)));
        if (toClear.length) {
            await prisma.stop.updateMany({
                where: { id: { in: toClear.map(s => s.id) } },
                data: { assignedDriverId: null, order: null },
            });
        }

        // Sync fields from User to Stop to keep denormalized data fresh
        // This ensures stops have the latest user data (name, address, phone, etc.)
        // Note: complex field is on User only, not Stop, so complex detection uses live User data from the users prop
        const allUsersForSync = await prisma.user.findMany({
            where: { id: { in: Array.from(okUserIds) } },
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
                dislikes: true,
                lat: true,
                lng: true,
            },
        });
        const userById = new Map(allUsersForSync.map(u => [u.id, u]));
        
        const stopsToSync = await prisma.stop.findMany({
            where: { ...dayWhere, userId: { in: Array.from(okUserIds) } },
            select: { id: true, userId: true },
        });
        
        // First, deduplicate: if a user has multiple stops for the same day, keep only one
        const stopsByUser = new Map<number, number[]>();
        for (const stop of stopsToSync) {
            if (!stop.userId) continue;
            if (!stopsByUser.has(stop.userId)) {
                stopsByUser.set(stop.userId, []);
            }
            stopsByUser.get(stop.userId)!.push(stop.id);
        }
        
        // For users with multiple stops, delete all but the first one
        const duplicateStopIds: number[] = [];
        for (const [userId, stopIds] of stopsByUser.entries()) {
            if (stopIds.length > 1) {
                // Keep the first stop, delete the rest
                duplicateStopIds.push(...stopIds.slice(1));
            }
        }
        if (duplicateStopIds.length > 0) {
            await prisma.stop.deleteMany({
                where: { id: { in: duplicateStopIds } },
            });
        }
        
        // Now update remaining stops (one per user)
        const updatesByUser = new Map<number, { userId: number; stopId: number; user: typeof allUsersForSync[0] }>();
        for (const stop of stopsToSync) {
            if (!stop.userId || duplicateStopIds.includes(stop.id)) continue;
            const user = userById.get(stop.userId);
            if (!user) continue;
            
            // Only keep one stop per user
            if (!updatesByUser.has(stop.userId)) {
                updatesByUser.set(stop.userId, { userId: stop.userId, stopId: stop.id, user });
            }
        }
        
        let stopsSynced = 0;
        for (const { user, stopId } of updatesByUser.values()) {
            const name = `${(user.first || "").trim()} ${(user.last || "").trim()}`.trim() || "(Unnamed)";
            const updateData: any = {
                name,
                address: user.address ?? "",
                apt: user.apt ?? null,
                city: user.city ?? "",
                state: user.state ?? "",
                zip: user.zip ?? "",
                phone: user.phone ?? null,
                dislikes: user.dislikes ?? null,
                lat: user.lat ?? null,
                lng: user.lng ?? null,
            };
            
            try {
                await prisma.stop.update({
                    where: { id: stopId },
                    data: updateData,
                });
                stopsSynced++;
            } catch (e: any) {
                // If update fails due to unique constraint, the stop already exists with this data
                // This can happen if there's a race condition or duplicate
                console.warn(`[cleanup] Failed to update stop ${stopId} for user ${user.id}:`, e?.message);
            }
        }

        // Ensure all active users (not paused, delivery=true) have a stop for this day
        // Check which users don't have a stop yet
        const existingStopUserIds = await prisma.stop.findMany({
            where: { ...dayWhere, userId: { in: Array.from(okUserIds) } },
            select: { userId: true },
        });
        const usersWithStops = new Set(
            existingStopUserIds.map(s => s.userId).filter((id): id is number => id != null)
        );
        
        // Find users who need stops created
        const usersNeedingStops = allUsersForSync.filter(u => !usersWithStops.has(u.id));
        
        let stopsCreated = 0;
        if (usersNeedingStops.length > 0) {
            console.log(`[cleanup] Found ${usersNeedingStops.length} users missing stops for day "${day}"`);
            const stopsToCreate = usersNeedingStops.map((u) => ({
                day,
                userId: u.id,
                name: `${(u.first || "").trim()} ${(u.last || "").trim()}`.trim() || "(Unnamed)",
                address: u.address ?? "",
                apt: u.apt ?? null,
                city: u.city ?? "",
                state: u.state ?? "",
                zip: u.zip ?? "",
                phone: u.phone ?? null,
                dislikes: u.dislikes ?? null,
                lat: u.lat ?? null,
                lng: u.lng ?? null,
                completed: false,
                proofUrl: null,
                assignedDriverId: null,
                order: null,
            }));
            
            const createResult = await prisma.stop.createMany({
                data: stopsToCreate,
                skipDuplicates: true,
            });
            stopsCreated = createResult.count;
            console.log(`[cleanup] Created ${stopsCreated} stops for day "${day}"`);
        } else {
            console.log(`[cleanup] All active users already have stops for day "${day}"`);
        }

        return NextResponse.json({
            ok: true,
            day,
            removedStops: delRes.count,
            driversPatched,
            clearedAssignments: toClear.length || 0,
            stopsSynced,
            stopsCreated,
        });
    } catch (e: any) {
        console.error("[/api/route/cleanup] Error:", e);
        return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
    }
}