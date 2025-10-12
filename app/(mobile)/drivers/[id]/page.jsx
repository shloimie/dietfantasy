// app/(mobile)/drivers/[id]/page.jsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { fetchDriver, fetchStops, setStopCompleted } from "../../../../lib/api";
import { mapsUrlFromAddress } from "../../../../lib/maps";
import { mergeStopsWithLocal, addCompleted } from "../../../../lib/localProgress";
import SearchStops from "../../../../components/SearchStops";
import {
    CheckCircle2,
    MapPin,
    Phone,
    Clock,
    Hash,
    ArrowLeft,
    Link as LinkIcon,
    X,
} from "lucide-react";

/** Invisible helper that listens for postMessage from the sign iframe */
function InlineMessageListener({ onDone }) {
    useEffect(() => {
        const handler = async (e) => {
            if (!e?.data || e.data.type !== "signatures:done") return;
            try {
                await onDone?.();
            } catch {}
        };
        window.addEventListener("message", handler);
        return () => window.removeEventListener("message", handler);
    }, [onDone]);
    return null;
}

export default function DriverDetailPage() {
    const { id } = useParams();
    const router = useRouter();

    const [driver, setDriver] = useState(null);
    const [stops, setStops] = useState([]);
    const [allStops, setAllStops] = useState([]);
    const [loading, setLoading] = useState(true);

    // bottom sheet state
    const [sheetOpen, setSheetOpen] = useState(false);
    const [sheetToken, setSheetToken] = useState(null);
    const [sheetTitle, setSheetTitle] = useState("");

    // per-stop "mark complete" loading state
    const [completingId, setCompletingId] = useState(null);

    useEffect(() => {
        let active = true;
        (async () => {
            try {
                // Always fetch fresh on mount
                const d = await fetchDriver(id);
                const every = await fetchStops(); // /api/mobile/stops injects sigCollected
                if (!active) return;

                const merged = d ? selectStopsForRoute(d, every, id) : [];
                setDriver(d);
                setAllStops(every);
                setStops(merged);
                setLoading(false);

                requestAnimationFrame(scrollToHash);
            } catch (e) {
                console.error("Driver detail load failed:", e);
                if (active) setLoading(false);
            }
        })();
        return () => {
            active = false;
        };
    }, [id]);

    function selectStopsForRoute(route, all, routeKey) {
        const byId = new Map(all.map((s) => [String(s.id), s]));
        const selected = (route?.stopIds ?? [])
            .map((sid) => byId.get(String(sid)))
            .filter(Boolean)
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        // Keep local optimistic completion merge only
        return mergeStopsWithLocal(routeKey, selected);
    }

    function scrollToHash() {
        if (typeof window === "undefined") return;
        const hash = window.location.hash.replace("#", "");
        if (!hash) return;
        const el = document.getElementById(hash);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    const doneCount = useMemo(() => stops.filter((s) => !!s.completed).length, [stops]);
    const pct = stops.length ? (doneCount / stops.length) * 100 : 0;

    // bottom sheet open/close
    const openSheet = (token, title) => {
        setSheetToken(token);
        setSheetTitle(title);
        setSheetOpen(true);
    };
    const closeSheet = async () => {
        setSheetOpen(false);
        setSheetToken(null);
        // refresh after collecting signatures so sigCollected is fresh
        try {
            const freshAll = await fetchStops();
            const merged = selectStopsForRoute(driver, freshAll, id);
            setAllStops(freshAll);
            setStops(merged);
        } catch {}
    };

    if (loading || !driver) {
        return <div className="muted" style={{ padding: 20 }}>Loading route…</div>;
    }

    return (
        <div className="container theme" style={{ ["--brand"]: driver.color || "#3665F3" }}>
            {/* Back */}
            <div style={{ marginBottom: 16 }}>
                <button
                    className="btn btn-outline"
                    onClick={() => router.push("/drivers")}
                    style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
                >
                    <ArrowLeft style={{ height: 16, width: 16 }} />
                    Back
                </button>
            </div>

            {/* Banner */}
            <div
                className="card banner"
                style={{
                    background: `linear-gradient(0deg, ${driver.color || "#3665F3"}, ${driver.color || "#3665F3"})`,
                    color: "#fff",
                }}
            >
                <div className="card-content">
                    <div className="row">
                        <div className="flex">
                            <div className="hdr-badge" style={{ background: "#fff", color: "var(--brand)" }}>
                                <Hash />
                            </div>
                            <div>
                                <h1 className="h1" style={{ color: "#fff" }}>
                                    Route {driver.routeNumber}
                                </h1>
                                <small> {driver.name} </small>
                            </div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                            <div style={{ fontSize: 28, fontWeight: 800 }}>
                                {doneCount}/{stops.length}
                            </div>
                            <div style={{ opacity: 0.85 }}>Completed</div>
                        </div>
                    </div>

                    <div
                        style={{
                            marginTop: 16,
                            background: "rgba(255,255,255,.15)",
                            borderRadius: 12,
                            padding: 16,
                        }}
                    >
                        <div style={{ opacity: 0.9, marginBottom: 8, fontSize: 14 }}>Progress</div>
                        <div className="progress">
                            <span style={{ width: `${pct}%`, background: "#fff" }} />
                        </div>
                    </div>
                </div>
            </div>

            {/* Search */}
            <div className="search-wrap">
                <SearchStops allStops={allStops} drivers={[driver]} themeColor={driver.color || "#3665F3"} />
            </div>

            {/* Stops */}
            <section className="grid">
                {stops.map((s, idx) => {
                    const done = !!s.completed;
                    const sigs = s.sigCollected ?? 0;
                    const sigDone = sigs >= 5; // ONLY affects the Signatures button
                    const isLoading = completingId === s.id;

                    const mapsUrl = mapsUrlFromAddress({
                        address: s.address,
                        city: s.city,
                        state: s.state,
                        zip: s.zip,
                    });

                    // Mark Complete button states (independent from signatures)
                    let completeLabel = "Mark Complete";
                    let completeClass = "btn btn-outline";
                    let completeDisabled = false;

                    if (done) {
                        completeLabel = "Completed";
                        completeClass = "btn btn-outline btn-muted";
                        completeDisabled = true;
                    } else if (isLoading) {
                        completeLabel = "Saving…";
                        completeClass = "btn btn-outline btn-loading";
                        completeDisabled = true;
                    }

                    // Signatures button states (disabled if 5/5)
                    const sigBtnDisabled = sigDone;
                    const sigBtnClass = sigDone ? "btn btn-success btn-disabled" : "btn btn-outline";
                    const sigBtnLabel = sigDone ? "Signatures Complete" : "Collect Signatures";

                    return (
                        <div
                            key={s.id}
                            id={`stop-${s.id}`}
                            className={`card stop-card ${done ? "done-bg" : ""}`}
                        >
                            <div className="color-rail" style={{ background: "var(--brand)" }} />
                            <div className="card-content">
                                <div className="row" style={{ alignItems: "flex-start" }}>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div className="flex" style={{ gap: 10, alignItems: "center" }}>
                                            {done ? (
                                                <CheckCircle2 color="var(--success)" />
                                            ) : (
                                                <span className="pill">{idx + 1}</span>
                                            )}
                                            <h2
                                                className="bold"
                                                style={{
                                                    fontSize: 18,
                                                    whiteSpace: "nowrap",
                                                    overflow: "hidden",
                                                    textOverflow: "ellipsis",
                                                }}
                                            >
                                                {s.name}
                                            </h2>

                                            {/* Signature count chip (display only) */}
                                            <span
                                                className="muted"
                                                style={{
                                                    fontSize: 12,
                                                    padding: "2px 8px",
                                                    border: "1px solid #e5e7eb",
                                                    borderRadius: 12,
                                                    background: "#f8fafc",
                                                }}
                                                title="Collected signatures for this customer"
                                            >
                        {sigs}/5 sigs
                      </span>

                                            {done && <span className="muted" style={{ fontSize: 14 }}>Done</span>}
                                        </div>

                                        <div className="kv">
                                            <div className="flex muted">
                                                <MapPin style={{ height: 16, width: 16 }} />
                                                <span>
                          {s.address}, {s.city}, {s.state} {s.zip}
                        </span>
                                            </div>
                                            {s.phone && (
                                                <div className="flex muted">
                                                    <Phone style={{ height: 16, width: 16 }} />
                                                    <a className="link" href={`tel:${s.phone}`}>
                                                        {s.phone}
                                                    </a>
                                                </div>
                                            )}
                                            {s.dislikes && (
                                                <div className="flex muted">
                                                    <span style={{ fontWeight: 600 }}>Dislikes:</span>
                                                    <span>{s.dislikes}</span>
                                                </div>
                                            )}
                                            {done && (
                                                <div className="flex muted">
                                                    <Clock style={{ height: 16, width: 16 }} />
                                                    <span>Completed</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                                        <a className="btn btn-outline" href={mapsUrl} target="_blank" rel="noreferrer">
                                            Open in Maps
                                        </a>

                                        {/* Signatures bottom sheet (disabled if 5/5) */}
                                        <button
                                            className={sigBtnClass}
                                            onClick={() => {
                                                if (sigBtnDisabled) return;
                                                if (!s.signToken) {
                                                    // silent per your preference (no alerts)
                                                    return;
                                                }
                                                openSheet(s.signToken, s.name || "Sign");
                                            }}
                                            disabled={sigBtnDisabled}
                                            style={{ width: 180, display: "inline-flex", alignItems: "center", gap: 8 }}
                                            title={sigDone ? "All signatures collected" : "Open the public signature page"}
                                        >
                                            <LinkIcon style={{ height: 16, width: 16 }} />
                                            {sigBtnLabel}
                                        </button>

                                        {/* Mark Complete (manual only) */}
                                        <button
                                            className={completeClass}
                                            onClick={async () => {
                                                if (completeDisabled) return;
                                                try {
                                                    setCompletingId(s.id);
                                                    const res = await setStopCompleted(s.userId, s.id, true);
                                                    if (res?.ok && res?.stop?.completed) {
                                                        addCompleted(id, s.id);
                                                        setStops((prev) =>
                                                            prev.map((x) => (x.id === s.id ? { ...x, completed: true } : x))
                                                        );
                                                    } else {
                                                        // silent per your preference
                                                    }
                                                } catch {
                                                    // silent per your preference
                                                } finally {
                                                    setCompletingId(null);
                                                }
                                            }}
                                            disabled={completeDisabled}
                                            style={{ width: 180 }}
                                            title={done ? "Completed" : "Mark this stop as completed"}
                                        >
                                            {completeLabel}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </section>

            {/* Bottom Sheet */}
            {sheetOpen && (
                <div className="sheet">
                    <div className="sheet-backdrop" onClick={closeSheet} />
                    <div className="sheet-panel">
                        <div className="sheet-header">
                            <div className="sheet-title">{sheetTitle}</div>
                            <button className="icon-btn" onClick={closeSheet} aria-label="Close">
                                <X />
                            </button>
                        </div>
                        {sheetToken && (
                            <iframe
                                src={`/sign/${sheetToken}`}
                                className="sheet-frame"
                                title="Signature"
                                sandbox="allow-scripts allow-same-origin allow-forms"
                            />
                        )}
                    </div>
                </div>
            )}

            {/* Listen for "signatures:done" and auto-close + refresh */}
            {typeof window !== "undefined" && (
                <InlineMessageListener onDone={closeSheet} />
            )}

            {/* Page-scoped CSS */}
            <style
                dangerouslySetInnerHTML={{
                    __html: `
          :root{
            --bg:#eef2f7; --border:#e5e7eb; --muted:#6b7280; --radius:14px;
            --shadow:0 8px 22px rgba(16,24,40,.06), 0 2px 8px rgba(16,24,40,.04);
            --success:#16a34a;
          }
          *{box-sizing:border-box}
          html,body{margin:0;padding:0;background:var(--bg);color:#111;
            font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial}
          .container{max-width:900px;margin:32px auto;padding:0 20px}
          .card{position:relative;border:1px solid var(--border);background:#fff;border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden}
          .card-content{padding:18px 20px}
          .color-rail{position:absolute;left:0;top:0;bottom:0;width:6px;border-top-left-radius:var(--radius);border-bottom-left-radius:var(--radius)}
          .row{display:flex;align-items:center;justify-content:space-between;gap:12px}
          .flex{display:flex;align-items:center;gap:8px}
          .grid{display:grid;gap:20px}
          .h1{font-size:28px;font-weight:800;margin:0}
          .bold{font-weight:800}
          .muted{color:var(--muted)}
          .hdr-badge{width:44px;height:44px;border-radius:12px;display:grid;place-items:center;background:#e7eefc;color:#2748d8;
            box-shadow:inset 0 0 0 1px rgba(39,72,216,.12)}
          .btn{display:inline-flex;align-items:center;justify-content:center;padding:8px 12px;border-radius:10px;border:1px solid var(--border);background:#111;color:#fff;cursor:pointer;user-select:none;position:relative}
          .btn-outline{background:#fff;color:#111;border-color:var(--border)}
          .btn-muted{background:#f3f4f6;color:#6b7280;cursor:default}
          .btn-success{background:#16a34a;color:#fff;border-color:#16a34a;cursor:default}
          .btn-disabled{opacity:.9;cursor:not-allowed}
          .btn-loading{opacity:.85;cursor:wait}
          .btn-loading::after{
            content:""; position:absolute; right:10px; width:14px; height:14px; border-radius:50%;
            border:2px solid currentColor; border-top-color: transparent; animation: spin .7s linear infinite;
          }
          @keyframes spin{to{transform:rotate(360deg)}}

          .progress{width:100%;height:10px;border-radius:999px;background:#f1f5f9;overflow:hidden}
          .progress>span{display:block;height:100%;border-radius:999px;transition:width .25s ease}
          .pill{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;
            background:#fff;color:var(--brand);border:2px solid var(--brand);font-weight:700;font-size:14px;flex-shrink:0}
          .kv{display:grid;gap:6px;margin-top:8px}
          .link{color:#1d4ed8;text-decoration:none}
          .link:hover{text-decoration:underline}
          .banner small{opacity:.9}
          .search-wrap{margin:16px 0}
          .done-bg{ background:#ECFDF5; }

          /* Bottom sheet */
          .sheet{position:fixed;inset:0;z-index:1000;display:grid}
          .sheet-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.35)}
          .sheet-panel{
            position:absolute;left:0;right:0;bottom:0;
            height:80vh;max-height:720px;background:#fff;border-top-left-radius:16px;border-top-right-radius:16px;
            box-shadow:0 -10px 30px rgba(0,0,0,.25);display:flex;flex-direction:column;
          }
          .sheet-header{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid #eee}
          .sheet-title{font-weight:700}
          .icon-btn{border:1px solid #e5e7eb;background:#fff;border-radius:8px;padding:6px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer}
          .sheet-frame{border:0;width:100%;height:100%;border-bottom-left-radius:16px;border-bottom-right-radius:16px}
        `,
                }}
            />
        </div>
    );
}