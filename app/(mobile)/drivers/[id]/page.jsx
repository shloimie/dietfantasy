"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { fetchDriver, fetchStops, setStopCompleted } from "../../../../lib/api";
import { mapsUrlFromAddress } from "../../../../lib/maps";
import { mergeStopsWithLocal, addCompleted } from "../../../../lib/localProgress";
import { CheckCircle2, MapPin, Phone, Clock, Hash, ArrowLeft, Link as LinkIcon, X } from "lucide-react";
import SearchStops from "../../../../components/SearchStops";

/** Invisible helper that listens for postMessage from the sign iframe */
function InlineMessageListener({ onDone }) {
    useEffect(() => {
        const handler = async (e) => {
            if (!e?.data || e.data.type !== "signatures:done") return;
            try { await onDone?.(); } catch {}
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
        return () => { active = false; };
    }, [id]);

    function selectStopsForRoute(route, all, routeKey) {
        const byId = new Map(all.map((s) => [String(s.id), s]));
        const selected = (route?.stopIds ?? [])
            .map((sid) => byId.get(String(sid)))
            .filter(Boolean)
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
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
        try {
            const freshAll = await fetchStops();
            const merged = selectStopsForRoute(driver, freshAll, id);
            setAllStops(freshAll);
            setStops(merged);
        } catch {}
    };

    if (loading || !driver) {
        return <div className="muted" style={{ padding: 16 }}>Loading route…</div>;
    }

    return (
        <div className="container theme" style={{ ["--brand"]: driver.color || "#3665F3" }}>
            {/* Sticky mobile header */}
            <header className="sticky-header">
                <button
                    className="icon-back"
                    onClick={() => router.push("/drivers")}
                    aria-label="Back to routes"
                >
                    <ArrowLeft />
                </button>
                <div className="hdr-center">
                    <div className="hdr-top">
                        <div className="hdr-pill"><Hash /></div>
                        <div className="hdr-txt">
                            <div className="title">Route {driver.routeNumber}</div>
                            <div className="sub">{driver.name}</div>
                        </div>
                    </div>
                    <div className="progress small">
                        <span style={{ width: `${pct}%` }} />
                    </div>
                </div>
                <div className="hdr-count">
                    <div className="strong">{doneCount}/{stops.length}</div>
                    <div className="muted tiny">Done</div>
                </div>
            </header>

            {/* Desktop banner (hidden on small) */}
            <div
                className="card banner desktop-only"
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
                                <h1 className="h1" style={{ color: "#fff" }}>Route {driver.routeNumber}</h1>
                                <small>{driver.name}</small>
                            </div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                            <div className="xxl">{doneCount}/{stops.length}</div>
                            <div className="muted white">Completed</div>
                        </div>
                    </div>

                    <div className="banner-progress">
                        <div className="muted white mb8">Progress</div>
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
                    const sigDone = sigs >= 5;
                    const isLoading = completingId === s.id;

                    const mapsUrl = mapsUrlFromAddress({
                        address: s.address, city: s.city, state: s.state, zip: s.zip,
                    });

                    // Mark Complete states
                    let completeLabel = "Mark Complete";
                    let completeClass = "btn btn-outline";
                    let completeDisabled = false;

                    if (done) { completeLabel = "Completed"; completeClass = "btn btn-outline btn-muted"; completeDisabled = true; }
                    else if (isLoading) { completeLabel = "Saving…"; completeClass = "btn btn-outline btn-loading"; completeDisabled = true; }

                    // Signatures states
                    const sigBtnDisabled = sigDone;
                    const sigBtnClass = sigDone ? "btn btn-success btn-disabled" : "btn btn-outline";
                    const sigBtnLabel = sigDone ? "Signatures Complete" : "Collect Signatures";

                    return (
                        <div key={s.id} id={`stop-${s.id}`} className={`card stop-card ${done ? "done-bg" : ""}`}>
                            <div className="color-rail" style={{ background: "var(--brand)" }} />
                            <div className="card-content">
                                <div className="row top">
                                    <div className="main">
                                        <div className="flex head">
                                            {done ? <CheckCircle2 color="var(--success)" /> : <span className="pill">{idx + 1}</span>}
                                            <h2 className="title2" title={s.name}>{s.name}</h2>
                                            <span className="chip" title="Collected signatures for this customer">{sigs}/5 sigs</span>
                                            {done && <span className="muted d14">Done</span>}
                                        </div>

                                        <div className="kv">
                                            <div className="address-line">
                                                <MapPin className="i16" />
                                                <span className="addr-text"> {s.address}, {s.city}, {s.state} {s.zip}</span>
                                            </div>

                                            {s.phone && (
                                                <div className="flex muted wrap">
                                                    <Phone className="i16" />
                                                    <a className="link" href={`tel:${s.phone}`}>{s.phone}</a>
                                                </div>
                                            )}
                                            {s.dislikes && (
                                                <div className="flex muted wrap">
                                                    <span className="b600">Dislikes:</span>
                                                    <span>{s.dislikes}</span>
                                                </div>
                                            )}
                                            {done && (
                                                <div className="flex muted wrap">
                                                    <Clock className="i16" />
                                                    <span>Completed</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Actions – mobile: stacked full width; desktop: column */}
                                    <div className="mobile-actions">
                                        <a className="btn btn-primary block" href={mapsUrl} target="_blank" rel="noreferrer">
                                            Open in Maps
                                        </a>

                                        <button
                                            className={`${sigBtnClass} block`}
                                            onClick={() => {
                                                if (sigBtnDisabled) return;
                                                if (!s.signToken) return;
                                                openSheet(s.signToken, s.name || "Sign");
                                            }}
                                            disabled={sigBtnDisabled}
                                            title={sigDone ? "All signatures collected" : "Open the public signature page"}
                                        >
                                            <LinkIcon style={{ height: 16, width: 16 }} />
                                            {sigBtnLabel}
                                        </button>

                                        <button
                                            className={`${completeClass} block`}
                                            onClick={async () => {
                                                if (completeDisabled) return;
                                                try {
                                                    setCompletingId(s.id);
                                                    const res = await setStopCompleted(s.userId, s.id, true);
                                                    if (res?.ok && res?.stop?.completed) {
                                                        addCompleted(id, s.id);
                                                        setStops(prev =>
                                                            prev.map(x => (x.id === s.id ? { ...x, completed: true } : x))
                                                        );
                                                    }
                                                } catch {} finally { setCompletingId(null); }
                                            }}
                                            disabled={completeDisabled}
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
                            <button className="icon-btn" onClick={closeSheet} aria-label="Close"><X /></button>
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
            {typeof window !== "undefined" && <InlineMessageListener onDone={closeSheet} />}

            {/* Page-scoped CSS */}
            <style
                dangerouslySetInnerHTML={{
                    __html: `
:root{
  --bg:#f7f8fb; --border:#e8eaef; --muted:#6b7280; --radius:14px;
  --shadow:0 6px 18px rgba(16,24,40,.06), 0 1px 6px rgba(16,24,40,.05);
  --success:#16a34a;
  --tap: rgba(0,0,0,.06);
}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:var(--bg);color:#111;
  -webkit-tap-highlight-color: transparent;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial}
.container{max-width:960px;margin:0 auto;padding:12px 12px calc(12px + env(safe-area-inset-bottom));}

/* Sticky compact header for phones */
.sticky-header{
  position: sticky; top: 0; z-index: 50; display:flex; align-items:center; gap:10px;
  background: #fff; border-bottom:1px solid var(--border); padding:10px 12px;
}
.icon-back{
  display:inline-grid; place-items:center; width:40px; height:40px; border-radius:10px;
  border:1px solid var(--border); background:#fff; cursor:pointer;
}
.icon-back svg{width:20px;height:20px}
.hdr-center{flex:1; min-width:0}
.hdr-top{display:flex; align-items:center; gap:10px}
.hdr-pill{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:#e7eefc;color:var(--brand);box-shadow:inset 0 0 0 1px rgba(39,72,216,.12)}
.hdr-txt .title{font-weight:800; font-size:16px; line-height:1.1}
.hdr-txt .sub{font-size:12px; color:var(--muted)}
.hdr-count{min-width:60px; text-align:right}
.hdr-count .strong{font-weight:800}
.tiny{font-size:11px}
.progress{width:100%;height:8px;border-radius:999px;background:#f1f5f9;overflow:hidden}
.progress.small{height:6px}
.progress>span{display:block;height:100%;border-radius:999px;background:var(--brand);transition:width .25s ease}

/* Desktop banner hides on small */
.desktop-only{display:none}
@media (min-width: 780px){
  .desktop-only{display:block}
  .sticky-header{display:none}
  .container{padding:24px}
}

/* Cards */
.card{position:relative;border:1px solid var(--border);background:#fff;border-radius:18px;box-shadow:var(--shadow);overflow:hidden}
.card-content{padding:14px}
.color-rail{position:absolute;left:0;top:0;bottom:0;width:6px;border-top-left-radius:18px;border-bottom-left-radius:18px}
.row{display:flex;align-items:center;justify-content:space-between;gap:10px}
.row.top{align-items:flex-start}
.flex{display:flex;align-items:center;gap:8px}
.grid{display:grid;gap:12px}
.h1{font-size:28px;font-weight:800;margin:0}
.bold{font-weight:800}
.muted{color:var(--muted)}
.hdr-badge{width:44px;height:44px;border-radius:12px;display:grid;place-items:center;background:#e7eefc;color:#2748d8;box-shadow:inset 0 0 0 1px rgba(39,72,216,.12)}
.banner .xxl{font-size:28px;font-weight:800}
.white{color:#fff}
.mb8{margin-bottom:8px}
.banner-progress{margin-top:16px;background:rgba(255,255,255,.15);border-radius:12px;padding:16px}

.pill{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;
  background:#fff;color:var(--brand);border:2px solid var(--brand);font-weight:700;font-size:14px;flex-shrink:0}
.kv{display:grid;gap:6px;margin-top:8px}
.link{color:#1d4ed8;text-decoration:none}
.link:hover{text-decoration:underline}
.title2{font-weight:800; font-size:17px; margin:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
.d14{font-size:14px}
.wrap{flex-wrap:wrap}
.i16{width:16px;height:16px}
.b600{font-weight:600}
.chip{font-size:12px;padding:2px 8px;border:1px solid var(--border);border-radius:12px;background:#f8fafc}
.done-bg{ background:#ECFDF5; }

/* Buttons */
.btn{
  display:inline-flex; align-items:center; justify-content:center; gap:8px;
  padding:12px 14px; border-radius:12px; border:1px solid var(--border); background:#111; color:#fff;
  cursor:pointer; user-select:none; position:relative; touch-action:manipulation;
}
.btn:active{transform:translateY(1px); background: #0f0f0f;}
.btn.block{width:100%}
.btn-primary{background:var(--brand); border-color:var(--brand)}
.btn-outline{background:#fff;color:#111;border-color:var(--border)}
.btn-muted{background:#f3f4f6;color:#6b7280;cursor:default}
.btn-success{background:#16a34a;color:#fff;border-color:#16a34a;cursor:default}
.btn-disabled{opacity:.9;cursor:not-allowed}
.btn-loading{opacity:.85;cursor:wait}
.btn-loading::after{
  content:""; position:absolute; right:12px; width:16px; height:16px; border-radius:50%;
  border:2px solid currentColor; border-top-color: transparent; animation: spin .7s linear infinite;
}
@keyframes spin{to{transform:rotate(360deg)}}

/* Actions layout */
.mobile-actions{display:grid; gap:8px; width:100%; max-width:520px}
@media (min-width: 780px){
  .mobile-actions{display:flex; flex-direction:column; width:auto; min-width:180px}
}

/* Search spacing */
.search-wrap{margin:10px 0 14px}

/* Bottom sheet */
.sheet{position:fixed;inset:0;z-index:1000;display:grid}
.sheet-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.35)}
.sheet-panel{
  position:absolute;left:0;right:0;bottom:0;
  height:92vh;max-height:760px;background:#fff;border-top-left-radius:18px;border-top-right-radius:18px;
  box-shadow:0 -10px 30px rgba(0,0,0,.25);display:flex;flex-direction:column;
}
.sheet-header{display:flex;align-items:center;justify-content:space-between;padding:12px;border-bottom:1px solid #eee}
.sheet-title{font-weight:700}
.icon-btn{border:1px solid #e5e7eb;background:#fff;border-radius:10px;padding:8px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer}
.sheet-frame{border:0;width:100%;height:100%;border-bottom-left-radius:18px;border-bottom-right-radius:18px}
        /* --- mobile overflow fix --- */
.stop-card{ overflow:hidden; }

@media (max-width: 780px){
  /* stack content + actions vertically on phones */
  .row.top{ 
    flex-direction: column; 
    align-items: stretch; 
  }

  /* make the action group full-width and grid */
  .mobile-actions{
    display: grid;
    grid-template-columns: 1fr;
    gap: 10px;
    width: 100%;
  }

  /* ensure buttons expand to card width */
  .btn.block{ width: 100%; }

  /* avoid any accidental extra right space */
  .card-content{ padding-right: 14px; }
  .title2{ max-width: 100%; }
}
        `,
                }}
            />
        </div>
    );
}