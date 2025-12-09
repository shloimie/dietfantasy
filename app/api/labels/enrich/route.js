// app/api/labels/enrich/route.js
// Server-side enrichment: takes { routes, users, strict?, debug? } and returns routes where each stop has .complex:boolean

export const dynamic = "force-dynamic";

/* ---------------- helpers ---------------- */
const toBool = (v) => {
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v !== 0;
    if (typeof v === "string") {
        const s = v.trim().toLowerCase();
        return s === "true" || s === "1" || s === "yes" || s === "y";
    }
    return false;
};

const displayNameLoose = (u = {}) => {
    const cands = [
        u.name,
        `${u.first ?? ""} ${u.last ?? ""}`.trim(),
        u.fullName,
        `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim(),
        u?.user?.name,
        `${u?.user?.first ?? ""} ${u?.user?.last ?? ""}`.trim(),
    ].filter(Boolean);
    return cands[0] || "";
};

const normalizeName = (s) =>
    String(s || "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .replace(/[^\p{L}\p{N}\s]/gu, "")
        .trim();

const normalizePhone = (s) => String(s || "").replace(/\D+/g, "").replace(/^1/, "");
const normalizeAddr = (u = {}) =>
    normalizeName(
        [u.address || u.addr || "", u.apt || u.unit || "", u.city || "", u.state || "", u.zip || ""]
            .filter(Boolean)
            .join(", ")
    );

const latKey = (lat) => (typeof lat === "number" ? lat.toFixed(4) : "");
const lngKey = (lng) => (typeof lng === "number" ? lng.toFixed(4) : "");
const latLngKey = (u) => `${latKey(u.lat ?? u.latitude)}|${lngKey(u.lng ?? u.longitude)}`;

function buildForceComplexIndex(users = []) {
    const idSet = new Set();
    const nameSet = new Set();
    const phoneSet = new Set();
    const addrSet = new Set();
    const llSet = new Set();

    let complexCount = 0;
    for (const u of users) {
        const isCx =
            toBool(u?.complex) ||
            toBool(u?.isComplex) ||
            toBool(u?.flags?.complex) ||
            toBool(u?.user?.complex) ||
            toBool(u?.User?.complex) ||
            toBool(u?.client?.complex);
        if (!isCx) continue;

        complexCount++;
        if (u.id != null) idSet.add(String(u.id));
        const nm = normalizeName(displayNameLoose(u));
        if (nm) nameSet.add(nm);
        const ph = normalizePhone(u.phone);
        if (ph) phoneSet.add(ph);
        const ak = normalizeAddr(u);
        if (ak) addrSet.add(ak);
        const ll = latLngKey(u);
        if (ll !== "|") llSet.add(ll);
    }
    return { idSet, nameSet, phoneSet, addrSet, llSet, complexCount };
}

function markStopComplex(stop, forceIdx, strict = false) {
    const s = stop || {};

    // direct flags
    const direct =
        toBool(s?.complex) ||
        toBool(s?.isComplex) ||
        toBool(s?.flags?.complex) ||
        toBool(s?.user?.complex) ||
        toBool(s?.User?.complex) ||
        toBool(s?.client?.complex);
    if (direct) return { ...s, complex: true, __complexSource: "stop.direct" };

    // ids
    const ids = [
        s.userId,
        s.userID,
        s.userid,
        s?.user?.id,
        s?.User?.id,
        s?.client?.id,
        s.id,
    ]
        .map((v) => (v == null ? null : String(v)))
        .filter(Boolean);
    for (const id of ids) {
        if (forceIdx.idSet.has(id)) return { ...s, complex: true, __complexSource: "user.id" };
    }

    if (strict) return { ...s, complex: false, __complexSource: "none(strict)" };

    // NOTE: Name matching removed - different people can have the same name
    // const nm = normalizeName(displayNameLoose(s));
    // if (nm && forceIdx.nameSet.has(nm)) return { ...s, complex: true, __complexSource: "user.name" };

    // NOTE: Phone matching removed - phone numbers can be shared (family members, businesses)
    // This was causing false positives where non-complex users were marked complex
    // const ph = normalizePhone(s.phone || s?.user?.phone);
    // if (ph && forceIdx.phoneSet.has(ph)) return { ...s, complex: true, __complexSource: "user.phone" };

    // NOTE: Address matching removed - addresses can be shared (apartments, family members)
    // This was causing false positives where non-complex users were marked complex
    // const ak = normalizeAddr(s);
    // if (ak && forceIdx.addrSet.has(ak)) return { ...s, complex: true, __complexSource: "user.addr" };

    // NOTE: lat/lng matching removed - nearby addresses shouldn't automatically be complex
    // const ll = latLngKey(s);
    // if (ll !== "|" && forceIdx.llSet.has(ll))
    //     return { ...s, complex: true, __complexSource: "user.latlng" };

    return { ...s, complex: false, __complexSource: "none" };
}

/* ---------------- route handler ---------------- */
export async function POST(req) {
    try {
        const body = await req.json().catch(() => ({}));
        const routes = Array.isArray(body?.routes) ? body.routes : [];
        const users = Array.isArray(body?.users) ? body.users : [];
        const strict = Boolean(body?.strict);
        const debug = Boolean(body?.debug);

        const driversCount = routes.length;
        const stopsCount = routes.reduce((a, r) => a + (Array.isArray(r) ? r.length : 0), 0);

        const forceIdx = buildForceComplexIndex(users);

        console.log("[enrich] received:", {
            driversCount,
            stopsCount,
            usersCount: users.length,
            usersComplex: forceIdx.complexCount,
            strict,
            debug,
        });

        const enriched = routes.map((stops) => (stops || []).map((s) => markStopComplex(s, forceIdx, strict)));

        const perDriver = enriched.map((stops, i) => ({
            driver: i + 1,
            complex: stops.filter((x) => x.complex).length,
            total: stops.length,
        }));
        const totalComplex = perDriver.reduce((a, r) => a + r.complex, 0);

        const diag = {
            driversCount,
            stopsCount,
            usersCount: users.length,
            usersComplex: forceIdx.complexCount,
            perDriver,
            totalComplex,
            keySizes: {
                idSet: forceIdx.idSet.size,
                nameSet: forceIdx.nameSet.size,
                phoneSet: forceIdx.phoneSet.size,
                addrSet: forceIdx.addrSet.size,
                latlngSet: forceIdx.llSet.size,
            },
        };

        if (debug) {
            const sampleComplexUsers = users
                .filter((u) => toBool(u?.complex))
                .slice(0, 5)
                .map((u) => ({
                    id: u.id ?? null,
                    name: displayNameLoose(u),
                    phone: normalizePhone(u.phone),
                    addr: normalizeAddr(u),
                    ll: latLngKey(u),
                }));
            const flat = enriched.flat().filter((x) => x.complex).slice(0, 10);
            const sampleEnrichedComplexStops = flat.map((s) => ({
                id: s.id ?? null,
                userId: s.userId ?? s?.user?.id ?? null,
                name: displayNameLoose(s),
                phone: normalizePhone(s.phone || s?.user?.phone),
                addr: normalizeAddr(s),
                ll: latLngKey(s),
                __complexSource: s.__complexSource || "unknown",
            }));
            diag.sampleComplexUsers = sampleComplexUsers;
            diag.sampleEnrichedComplexStops = sampleEnrichedComplexStops;
        }

        return new Response(JSON.stringify({ routes: enriched, diag }), {
            status: 200,
            headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        });
    } catch (e) {
        console.error("labels/enrich POST error:", e);
        return new Response(JSON.stringify({ error: "enrich_failed" }), { status: 500 });
    }
}