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
const str = (v: any) => (v == null ? null : String(v));

/* ---------- GET /api/users/[id] */
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

/* ---------- PUT /api/users/[id] */
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
    const cascadeStopsFlag = !!b.cascadeStops;

    // fetch current so we can detect changes
    const current = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            address: true, apt: true, city: true, state: true, zip: true, phone: true,
            latitude: true, longitude: true, geocodedAt: true,
        },
    });

    // Detect address/phone/coords changes
    const addressChanged =
        (str(current?.address) ?? "") !== (str(b.address) ?? "") ||
        (str(current?.apt) ?? "")     !== (str(b.apt) ?? "") ||
        (str(current?.city) ?? "")    !== (str(b.city) ?? "") ||
        (str(current?.state) ?? "")   !== (str(b.state) ?? "") ||
        (str(current?.zip) ?? "")     !== (str(b.zip) ?? "");

    const phoneChanged =
        (str(current?.phone) ?? "") !== (str(b.phone) ?? "");

    // Decide final coordinates:
    // 1) If client provided lat/lng, trust them.
    // 2) Else, geocode if needed (force when address changed).
    let finalLat = bodyLat;
    let finalLng = bodyLng;

    if (finalLat == null || finalLng == null) {
        const { lat, lng } = await geocodeIfNeeded(
            {
                address: b.address, apt: b.apt, city: b.city, state: b.state, zip: b.zip,
                latitude: addressChanged ? null : (current?.latitude ?? null),
                longitude: addressChanged ? null : (current?.longitude ?? null),
            },
            addressChanged // force geocode when address changed
        );
        finalLat = num(lat);
        finalLng = num(lng);
    }

    // Determine geocodedAt: set to now when we first obtain coords or when address changed
    const shouldSetGeocodedAt =
        addressChanged
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
                upsert: { create: scheduleInput, update: scheduleInput },
            },

            // write coords to BOTH field name styles
            latitude: finalLat,
            longitude: finalLng,
            lat: finalLat,
            lng: finalLng,

            geocodedAt: shouldSetGeocodedAt
                ? new Date()
                : (addressChanged ? null : current?.geocodedAt ?? null),
        },
        include: { schedule: true },
    });

    // === Cascade denormalized fields to Stops when needed ===
    // If any address/phone/coords changed OR explicit cascade flag is set,
    // push fresh values into all of the user's stops so routes/search/labels see the latest.
    const shouldCascade =
        cascadeStopsFlag || addressChanged || phoneChanged || (finalLat != null && finalLng != null);

    if (shouldCascade) {
        const stopData: any = {};
        if (b.address !== undefined) stopData.address = b.address ?? null;
        if (b.apt     !== undefined) stopData.apt     = b.apt ?? null;
        if (b.city    !== undefined) stopData.city    = b.city ?? null;
        if (b.state   !== undefined) stopData.state   = b.state ?? null;
        if (b.zip     !== undefined) stopData.zip     = b.zip ?? null;
        if (b.phone   !== undefined) stopData.phone   = b.phone ?? null;
        if (finalLat  != null)       stopData.lat     = finalLat;
        if (finalLng  != null)       stopData.lng     = finalLng;

        if (Object.keys(stopData).length > 0) {
            try {
                await prisma.stop.updateMany({
                    where: { userId },
                    data: stopData,
                });
            } catch (e: any) {
                console.error("Cascade update to stops failed:", e?.message || e);
                // don't fail the request — user update already succeeded
            }
        }
    }

    return NextResponse.json(updated);
}

/* ---------- DELETE /api/users/[id] */
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
            const stops = await tx.stop.findMany({ where: { userId }, select: { id: true } });
            const stopIds = stops.map((s) => s.id);

            // 3) Delete those stops
            if (stopIds.length) {
                await tx.stop.deleteMany({ where: { id: { in: stopIds } } });
            }

            // 4) Remove those stop IDs from every driver’s stopIds array
            const drivers = await tx.driver.findMany({ select: { id: true, stopIds: true } });
            for (const d of drivers) {
                const filtered = (d.stopIds ?? []).filter((sid) => !stopIds.includes(sid));
                if (filtered.length !== (d.stopIds?.length ?? 0)) {
                    await tx.driver.update({ where: { id: d.id }, data: { stopIds: filtered } });
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