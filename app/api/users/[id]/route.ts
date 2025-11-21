// app/api/users/[id]/route.ts
export const runtime = "nodejs";

import { NextResponse, NextRequest } from "next/server";
import prisma from "../../../../lib/prisma";
import { geocodeIfNeeded } from "../../../../lib/geocode";
import type { Prisma } from "@prisma/client";

/* ====================== Utils & helpers ====================== */

// Safely map unknown/JSON value -> number[]
function jsonToNumArray(v: unknown): number[] {
    if (!Array.isArray(v)) return [];
    return v.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
}

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
// ⬇️ add near top (reuse same helper as POST)
const parseBillings = (raw: any) => {
    if (raw == null) return [];
    try {
        if (typeof raw === "string") {
            const t = raw.trim();
            if (!t) return [];
            return JSON.parse(t);
        }
        return raw; // already JSON
    } catch {
        return String(raw); // preserve malformed content as text
    }
};

const num = (v: any) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: any) => (v == null ? null : String(v));

/* ====================== GET /api/users/[id] ====================== */
export async function GET(
    _req: NextRequest,
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

/* ====================== PUT /api/users/[id] ====================== */
/* ====================== PUT /api/users/[id] ====================== */
export async function PUT(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    // --- helpers local to this handler ---
    const parseBillings = (raw: any) => {
        if (raw == null) return [];
        try {
            if (typeof raw === "string") {
                const t = raw.trim();
                if (!t) return [];
                return JSON.parse(t);
            }
            return raw; // already JSON
        } catch {
            // preserve malformed content so you can see/debug it later
            return String(raw);
        }
    };

    const { id } = await params;
    const userId = Number(id);
    if (!Number.isFinite(userId)) {
        return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const b = await req.json();
    const scheduleInput = sanitizeSchedule(b.schedule);

    // Pull coords from body (support both lat/lng and latitude/longitude)
    // Special handling: if clearGeocode flag is set, force null
    const clearGeocode = !!b.clearGeocode;
    let bodyLat = clearGeocode ? null : num(b.lat ?? b.latitude);
    let bodyLng = clearGeocode ? null : num(b.lng ?? b.longitude);
    const cascadeStopsFlag = !!b.cascadeStops;

    // fetch current so we can detect changes
    const current = await prisma.user.findUnique({
        where: { id: userId },
        select: {
            first: true,
            last: true,
            address: true,
            apt: true,
            city: true,
            state: true,
            zip: true,
            phone: true,
            latitude: true,
            longitude: true,
            geocodedAt: true,
        },
    });

    // if user not found
    if (!current) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Detect address/phone changes
    const addressChanged =
        (str(current?.address) ?? "") !== (str(b.address) ?? "") ||
        (str(current?.apt) ?? "") !== (str(b.apt) ?? "") ||
        (str(current?.city) ?? "") !== (str(b.city) ?? "") ||
        (str(current?.state) ?? "") !== (str(b.state) ?? "") ||
        (str(current?.zip) ?? "") !== (str(b.zip) ?? "");

    const phoneChanged = (str(current?.phone) ?? "") !== (str(b.phone) ?? "");

    // Decide final coordinates:
    // 1) If clearGeocode flag is set, force to null (skip geocoding)
    // 2) If client provided lat/lng, trust them.
    // 3) Else, geocode if needed (force when address changed).
    let finalLat = bodyLat;
    let finalLng = bodyLng;

    if (!clearGeocode && (finalLat == null || finalLng == null)) {
        const { lat, lng } = await geocodeIfNeeded(
            {
                address: b.address,
                apt: b.apt,
                city: b.city,
                state: b.state,
                zip: b.zip,
                latitude: addressChanged ? null : (current?.latitude ?? null),
                longitude: addressChanged ? null : (current?.longitude ?? null),
            },
            addressChanged // force geocode when address changed
        );
        finalLat = num(lat);
        finalLng = num(lng);
    }

    // Determine geocodedAt: set to now when we first obtain coords or when address changed
    const shouldSetGeocodedAt = addressChanged
        ? finalLat != null && finalLng != null
        : current?.geocodedAt
            ? false
            : finalLat != null && finalLng != null;

    // ===== NEW FIELDS =====
    // Accept both camel and snake for IDs; allow null to clear, undefined to keep unchanged
    const clientId: string | null | undefined = b.clientId ?? b.client_id;
    const caseId: string | null | undefined = b.caseId ?? b.case_id;

    // Booleans: only update if provided; otherwise leave as-is
    const bill: boolean | undefined = b.bill === undefined ? undefined : !!b.bill;
    const delivery: boolean | undefined =
        b.delivery === undefined ? undefined : !!b.delivery;

    // Billings can be array or JSON string; only set if any key provided
    const billings =
        b.billings === undefined &&
        b.billing === undefined &&
        b.billing_json === undefined &&
        b.Billings === undefined
            ? undefined
            : parseBillings(b.billings ?? b.billing ?? b.billing_json ?? b.Billings);

    // Perform the update (use undefined to leave fields unchanged)
    const updated = await prisma.user.update({
        where: { id: userId },
        data: {
            // core text fields (set to undefined to keep unchanged if not provided)
            first: b.first ?? undefined,
            last: b.last ?? undefined,
            address: b.address ?? undefined,
            apt: b.apt === undefined ? undefined : b.apt ?? null,
            city: b.city ?? undefined,
            dislikes: b.dislikes === undefined ? undefined : b.dislikes ?? null,
            county: b.county === undefined ? undefined : b.county ?? null,
            zip: b.zip === undefined ? undefined : b.zip ?? null,
            state: b.state ?? undefined,
            phone: b.phone ?? undefined,

            // flags
            medicaid: b.medicaid === undefined ? undefined : !!b.medicaid,
            paused: b.paused === undefined ? undefined : !!b.paused,
            complex: b.complex === undefined ? undefined : !!b.complex,

            // ===== write new fields when present =====
            bill,          // boolean | undefined
            delivery,      // boolean | undefined
            clientId,      // string | null | undefined
            caseId,        // string | null | undefined
            billings,      // Json | string (malformed preserved) | undefined

            // schedule upsert if provided
            ...(b.schedule
                ? {
                    schedule: {
                        upsert: { create: scheduleInput, update: scheduleInput },
                    },
                }
                : {}),

            // coords to BOTH field styles (if we resolved them)
            // Special case: when clearGeocode is true, explicitly set to null
            latitude: clearGeocode ? null : (finalLat == null ? undefined : finalLat),
            longitude: clearGeocode ? null : (finalLng == null ? undefined : finalLng),
            lat: clearGeocode ? null : (finalLat == null ? undefined : finalLat),
            lng: clearGeocode ? null : (finalLng == null ? undefined : finalLng),

            geocodedAt: clearGeocode
                ? null
                : shouldSetGeocodedAt
                    ? new Date()
                    : addressChanged
                        ? null
                        : current?.geocodedAt ?? null,
        },
        include: {
            schedule: {
                select: {
                    monday: true,
                    tuesday: true,
                    wednesday: true,
                    thursday: true,
                    friday: true,
                    saturday: true,
                    sunday: true,
                },
            },
        },
    });

    // === Cascade denormalized fields to Stops when needed ===
    const nameChanged =
        (b.first !== undefined || b.last !== undefined) &&
        (`${b.first ?? current?.first ?? ""} ${b.last ?? current?.last ?? ""}`.trim() !==
         `${current?.first ?? ""} ${current?.last ?? ""}`.trim());

    const shouldCascade =
        cascadeStopsFlag || addressChanged || phoneChanged || nameChanged || clearGeocode || (finalLat != null && finalLng != null);

    if (shouldCascade) {
        const stopData: Record<string, any> = {};
        // Cascade name if first or last changed
        if (b.first !== undefined || b.last !== undefined) {
            const firstName = b.first ?? current?.first ?? "";
            const lastName = b.last ?? current?.last ?? "";
            stopData.name = `${firstName} ${lastName}`.trim();
        }
        if (b.address !== undefined) stopData.address = b.address ?? null;
        if (b.apt !== undefined) stopData.apt = b.apt ?? null;
        if (b.city !== undefined) stopData.city = b.city ?? null;
        if (b.state !== undefined) stopData.state = b.state ?? null;
        if (b.zip !== undefined) stopData.zip = b.zip ?? '';
        if (b.phone !== undefined) stopData.phone = b.phone ?? null;
        // Special case: when clearing geocode, explicitly set to null
        if (clearGeocode) {
            stopData.lat = null;
            stopData.lng = null;
        } else {
            if (finalLat != null) stopData.lat = finalLat;
            if (finalLng != null) stopData.lng = finalLng;
        }

        if (Object.keys(stopData).length > 0) {
            try {
                console.log(`[/api/users/${userId}] Cascading to stops:`, stopData);
                const result = await prisma.stop.updateMany({
                    where: { userId },
                    data: stopData,
                });
                console.log(`[/api/users/${userId}] Cascaded to ${result.count} stops`);
            } catch (e: any) {
                console.error("Cascade update to stops failed:", e?.message || e);
                // don't fail the request — user update already succeeded
            }
        }
    }

    return NextResponse.json(updated);
}

/* ====================== DELETE /api/users/[id] ====================== */
export async function DELETE(
    _req: NextRequest,
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

            // 4) Remove those stop IDs from every driver’s stopIds (JSON) array
            const drivers = await tx.driver.findMany({
                select: { id: true, stopIds: true },
            });

            for (const d of drivers) {
                const curr = jsonToNumArray(d.stopIds as unknown);
                const filtered = curr.filter((sid) => !stopIds.includes(sid));

                if (filtered.length !== curr.length) {
                    await tx.driver.update({
                        where: { id: d.id },
                        data: {
                            stopIds: filtered as unknown as Prisma.JsonValue,
                        },
                    });
                }
            }

            // 5) Optional related data (may not exist in all schemas)
            await (tx as any).signature?.deleteMany?.({ where: { userId } }).catch(() => {});
            await (tx as any).visit?.deleteMany?.({ where: { userId } }).catch(() => {});

            // 6) Finally delete the user itself
            await tx.user.delete({ where: { id: userId } });
        });

        return NextResponse.json({ ok: true, id: userId });
    } catch (err: any) {
        console.error("User delete cascade failed:", err);
        return NextResponse.json(
            { error: err?.message ?? "Delete failed" },
            { status: 500 }
        );
    }
}