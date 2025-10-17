export const runtime = "nodejs";
import { NextResponse } from "next/server";
import prisma from "../../../../lib/prisma";
import { geocodeIfNeeded } from "../../../../lib/geocode";

// keep all 7 keys, default true
function sanitizeSchedule(input: any) {
    const s = input ?? {};
    return {
        monday:    s.monday    ?? true,
        tuesday:   s.tuesday   ?? true,
        wednesday: s.wednesday ?? true,
        thursday:  s.thursday  ?? true,
        friday:    s.friday    ?? true,
        saturday:  s.saturday  ?? true,
        sunday:    s.sunday    ?? true,
    };
}

const num = (v: any) => (typeof v === "number" && Number.isFinite(v) ? v : null);

// ---------- GET /api/users/[id]
export async function GET(
    _req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const user = await prisma.user.findUnique({
        where: { id: Number(id) },
        include: { schedule: true },
    });
    if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(user);
}

// ---------- PUT /api/users/[id]
export async function PUT(
    req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const userId = Number(id);
    const b = await req.json();
    const scheduleInput = sanitizeSchedule(b.schedule);

    // Pull coords from body (support both lat/lng and latitude/longitude)
    let bodyLat = num(b.lat ?? b.latitude);
    let bodyLng = num(b.lng ?? b.longitude);
    const cascadeStops = !!b.cascadeStops;

    // fetch current so we can detect address changes & existing geocode
    const current = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            address: true, apt: true, city: true, state: true, zip: true,
            latitude: true, longitude: true, geocodedAt: true,
        },
    });

    const addrChanged =
        current?.address !== b.address ||
        current?.apt     !== (b.apt ?? null) ||
        current?.city    !== b.city ||
        current?.state   !== b.state ||
        current?.zip     !== (b.zip ?? null);

    // Decide final coordinates:
    // 1) If client provided lat/lng, trust them.
    // 2) Else, geocode if needed (force when address changed).
    let finalLat = bodyLat;
    let finalLng = bodyLng;

    if (finalLat == null || finalLng == null) {
        const { lat, lng } = await geocodeIfNeeded(
            {
                address: b.address, apt: b.apt, city: b.city, state: b.state, zip: b.zip,
                latitude: addrChanged ? null : (current?.latitude ?? null),
                longitude: addrChanged ? null : (current?.longitude ?? null),
            },
            addrChanged // force geocode when address changed
        );
        finalLat = num(lat);
        finalLng = num(lng);
    }

    // Determine geocodedAt: set to now when we first obtain coords or when address changed
    const shouldSetGeocodedAt =
        addrChanged
            ? (finalLat != null && finalLng != null)
            : (current?.geocodedAt ? false : (finalLat != null && finalLng != null));

    const updated = await prisma.user.update({
        where: { id: userId },
        data: {
            first: b.first,
            last: b.last,
            address: b.address,
            apt: b.apt ?? null,
            city: b.city,
            dislikes: b.dislikes ?? null,
            county: b.county ?? null,
            zip: b.zip ?? null,
            state: b.state,
            phone: b.phone,
            medicaid: !!b.medicaid,
            paused: !!b.paused,
            complex: !!b.complex,
            schedule: {
                upsert: {
                    create: scheduleInput,
                    update: scheduleInput,
                },
            },

            // ✅ Write coords to BOTH possible field names
            latitude: finalLat,
            longitude: finalLng,
            lat: finalLat,
            lng: finalLng,

            // sensible geocodedAt handling
            geocodedAt: shouldSetGeocodedAt
                ? new Date()
                : (addrChanged ? null : current?.geocodedAt ?? null),
        },
        include: { schedule: true },
    });
    console.log('updated');

    // Optionally cascade the new geocode to all of the user's Stops
    if (cascadeStops && finalLat != null && finalLng != null) {
        await prisma.stop.updateMany({
            where: { userId },
            data: {
                lat: finalLat,
                lng: finalLng,
                // If you also want to normalize city/state/zip on stops from body:
                ...(b.city  ? { city: b.city }   : {}),
                ...(b.state ? { state: b.state } : {}),
                ...(b.zip   ? { zip: b.zip }     : {}),
            },
        });
    }

    return NextResponse.json(updated);
}

// ---------- DELETE /api/users/[id]
export async function DELETE(
    _req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;
    const userId = Number(id);

    try {
        await prisma.$transaction(async (tx) => {
            // 1) Delete schedules linked to this user
            await tx.schedule.deleteMany({ where: { userId } }).catch(() => {});

            // 2) Find all stops for this user
            const stops = await tx.stop.findMany({
                where: { userId },
                select: { id: true },
            });
            const stopIds = stops.map((s) => s.id);

            // 3) Delete those stops
            if (stopIds.length) {
                await tx.stop.deleteMany({ where: { id: { in: stopIds } } });
            }

            // 4) Remove those stop IDs from every driver’s stopIds array (JSONB-safe)
            const drivers = await tx.driver.findMany({
                select: { id: true, stopIds: true },
            });

            for (const d of drivers) {
                const filtered = (d.stopIds ?? []).filter((sid) => !stopIds.includes(sid));
                if (filtered.length !== (d.stopIds?.length ?? 0)) {
                    await tx.driver.update({
                        where: { id: d.id },
                        data: { stopIds: filtered },
                    });
                }
            }

            // 5) Optional related data
            await tx.signature?.deleteMany?.({ where: { userId } }).catch(() => {});
            await tx.visit?.deleteMany?.({ where: { userId } }).catch(() => {});

            // 6) Finally delete the user itself
            await tx.user.delete({ where: { id: userId } });
        });

        return NextResponse.json({ ok: true, id: userId });
    } catch (err: any) {
        console.error("User delete cascade failed:", err);
        return NextResponse.json({ error: err.message ?? "Delete failed" }, { status: 500 });
    }
}