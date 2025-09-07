export const runtime = "nodejs";

import { NextResponse } from "next/server";

export async function POST(req: Request) {
    const { password } = await req.json();

    if (!process.env.APP_PASSWORD) {
        return new NextResponse("Server not configured", { status: 500 });
    }
    if (password !== process.env.APP_PASSWORD) {
        return new NextResponse("Invalid password", { status: 401 });
    }

    // Set a simple cookie. Expires in 7 days.
    const res = new NextResponse(null, { status: 204 });
    res.headers.append(
        "Set-Cookie",
        `app_auth=ok; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 60 * 60}`
    );
    return res;
}