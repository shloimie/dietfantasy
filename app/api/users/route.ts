// app/api/users/route.ts
export const runtime = "nodejs";
import { NextResponse } from "next/server";
import prisma from "../../../lib/prisma";
import { geocodeIfNeeded } from "../../../lib/geocode";

function sanitizeSchedule(input: any) {
    const s = input ?? {};
    return {
        monday: s.monday ?? true,
        tuesday: s.tuesday ?? true,
        wednesday: s.wednesday ?? true,
        thursday: s.thursday ?? true,
        friday: s.friday ?? true,
        saturday: s.saturday ?? true,
        sunday: s.sunday ?? true,
    };
}

const num = (v: any) => (typeof v === "number" && Number.isFinite(v) ? v : null);

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

// ---------- GET /api/users
export async function GET() {
    try {
        const list = await prisma.user.findMany({
            orderBy: [{ city: "asc" }, { last: "asc" }],
            select: {
                id: true,
                first: true,
                last: true,
                address: true,
                apt: true,
                city: true,
                dislikes: true,
                county: true,
                zip: true,
                state: true,
                phone: true,
                medicaid: true,
                paused: true,
                complex: true,


                bill: true,
                delivery: true,

                // geo
                lat: true,
                lng: true,

                // timestamps
                createdAt: true,
                updatedAt: true,

                // schedule
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

                // JSON + Unite Us IDs
                visits: true,
                billings: true,
                clientId: true,
                caseId: true,
            },
        });
        return NextResponse.json(list, { status: 200 });
    } catch (e: any) {
        console.error("GET /api/users failed (with new fields). Falling back.", e?.message || e);
        try {
            const list = await prisma.user.findMany({
                orderBy: [{ city: "asc" }, { last: "asc" }],
                select: {
                    id: true,
                    first: true,
                    last: true,
                    address: true,
                    apt: true,
                    city: true,
                    dislikes: true,
                    county: true,
                    zip: true,
                    state: true,
                    phone: true,
                    medicaid: true,
                    paused: true,
                    complex: true,
                    lat: true,
                    lng: true,
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
                    visits: true,
                },
            });
            const hydrated = list.map((u: any) => ({
                ...u,
                createdAt: null,
                updatedAt: null,
                bill: true,       // default in UI
                delivery: true,   // default in UI
                billings: [],
                clientId: null,
                caseId: null,
            }));
            return NextResponse.json(hydrated, { status: 200 });
        } catch (e2: any) {
            console.error("GET /api/users fallback also failed:", e2?.message || e2);
            return NextResponse.json({ error: "Failed to load users" }, { status: 500 });
        }
    }
}

// ---------- POST /api/users
export async function POST(req: Request) {
    try {
        const b = await req.json();
        const scheduleInput = sanitizeSchedule(b.schedule);

        // Existing optional fields
        const clientId: string | null = (b.clientId ?? b.client_id) ?? null;
        const caseId: string | null = (b.caseId ?? b.case_id) ?? null;
        const billings = parseBillings(b.billings ?? b.billing ?? b.billing_json ?? b.Billings);

        // NEW booleans (default true)
        const bill: boolean = b.bill == null ? true : !!b.bill;
        const delivery: boolean = b.delivery == null ? true : !!b.delivery;

        // coords
        let bodyLat = num(b.lat ?? b.latitude);
        let bodyLng = num(b.lng ?? b.longitude);

        if (bodyLat == null || bodyLng == null) {
            const { lat, lng } = await geocodeIfNeeded({
                address: b.address,
                apt: b.apt,
                city: b.city,
                state: b.state,
                zip: b.zip,
            });
            bodyLat = num(lat);
            bodyLng = num(lng);
        }

        const created = await prisma.user.create({
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

                // NEW
                bill,
                delivery,

                schedule: { create: scheduleInput },

                lat: bodyLat,
                lng: bodyLng,
                latitude: bodyLat,
                longitude: bodyLng,
                geocodedAt: bodyLat != null && bodyLng != null ? new Date() : null,

                // IDs/JSON
                clientId,
                caseId,
                billings,
            },
            include: { schedule: true },
        });

        return NextResponse.json(created, { status: 201 });
    } catch (e: any) {
        console.error("POST /api/users failed:", e?.message || e);
        return NextResponse.json(
            { error: "Create user failed", detail: e?.message || String(e) },
            { status: 400 }
        );
    }
}