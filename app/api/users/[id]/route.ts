export const runtime = "nodejs";
import { NextResponse } from "next/server";
import prisma from "../../../../lib/prisma";


// small helper so we always have all 7 keys (default true if missing)
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

// ---------- GET /api/users/[id]
export async function GET(
    _req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;           // ✅ await params
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
    const { id } = await params;           // ✅ await params
    const b = await req.json();
    const scheduleInput = sanitizeSchedule(b.schedule);

    const updated = await prisma.user.update({
        where: { id: Number(id) },
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
            // ⬇️ IMPORTANT: in nested upsert, DO NOT pass `id` or `userId`
            schedule: {
                upsert: {
                    create: scheduleInput,
                    update: scheduleInput,
                },
            },
        },
        include: { schedule: true },
    });

    return NextResponse.json(updated);
}

// ---------- DELETE /api/users/[id]
export async function DELETE(
    _req: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params;           // ✅ await params
    // optional: delete schedule first if your relation isn’t cascading
    await prisma.schedule.deleteMany({ where: { userId: Number(id) } }).catch(() => {});
    const deleted = await prisma.user.delete({ where: { id: Number(id) } });
    return NextResponse.json({ ok: true, id: deleted.id });
}