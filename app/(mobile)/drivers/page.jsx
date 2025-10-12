// app/drivers/page.jsx
import Link from "next/link";
import { fetchDrivers, fetchStops } from "../../../lib/api";
import { Truck, MapPin, ChevronRight, Hash, User } from "lucide-react";
import SearchStops from "../../../components/SearchStops";

export const dynamic = "force-dynamic";
export const metadata = { title: "Delivery Routes" };

export default async function DriversHome() {
    console.log("[DriversHome] render start");
    let drivers = [];
    let allStops = [];
    try {
        drivers = await fetchDrivers();
        console.log("[DriversHome] drivers length:", drivers?.length);
        try {
            allStops = await fetchStops();
            console.log("[DriversHome] stops length:", allStops?.length);
        } catch (e) {
            console.warn("[DriversHome] fetchStops failed:", e?.message || e);
            allStops = [];
        }
    } catch (e) {
        console.error("[DriversHome] fetchDrivers failed:", e?.message || e);
        return (
            <div style={{ minHeight: "60vh", display: "grid", placeItems: "center", textAlign: "center" }}>
                <div>
                    <h1 style={{ fontSize: 28, fontWeight: 800, margin: 0 }}>Connection Error</h1>
                    <p style={{ marginTop: 8, color: "#6b7280" }}>Failed to load routes.</p>
                </div>
            </div>
        );
    }
    console.log("[DriversHome] render with drivers:", drivers?.length);

    return (
        <div className="container">
            <div className="card">
                <div className="card-content">
                    <header className="hdr">
                        <div className="hdr-badge"><Truck /></div>
                        <div>
                            <h1 className="h1">Delivery Routes</h1>
                            <p className="sub">Select your route to begin deliveries</p>
                        </div>
                    </header>

                    <div className="search-wrap">
                        <SearchStops allStops={allStops} drivers={drivers} themeColor="#3665F3" />
                    </div>

                    <div className="grid">
                        {drivers.map((d, idx) => {
                            const total = d.totalStops ?? (d.stopIds?.length ?? 0);
                            const done = d.completedStops ?? 0;
                            const pct = total ? (done / total) * 100 : 0;

                            // server-side log per card (first few only to avoid noise)
                            if (idx < 3) {
                                console.log("[DriversHome] card", idx, {
                                    id: d.id,
                                    name: d.name,
                                    color: d.color,
                                    routeNumber: d.routeNumber,
                                    total,
                                    done,
                                });
                            }

                            return (
                                <Link
                                    key={d.id}
                                    href={`/drivers/${d.id}`}
                                    className="card driver-card"
                                    style={{ textDecoration: "none", color: "inherit" }}
                                >
                                    <div className="color-rail" style={{ background: (d.color && d.color.trim()) ? d.color : "#3665F3" }} />
                                    <div className="card-content">
                                        <div className="row">
                                            <div className="flex">
                                                <div className="hdr-badge" style={{ background: "#fff", color: (d.color && d.color.trim()) ? d.color : "#3665F3" }}>
                                                    <User />
                                                </div>
                                                <div>
                                                    <div className="flex" style={{ gap: 6 }}>
                                                        <h2 className="bold" style={{ fontSize: 18 }}>{d.name}</h2>
                                                        <ChevronRight className="muted" />
                                                    </div>
                                                    <div className="flex muted" style={{ marginTop: 2 }}>
                                                        <Hash style={{ width: 16, height: 16 }} />
                                                        <span>Route {d.routeNumber}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="flex muted" style={{ marginTop: 12 }}>
                                            <MapPin style={{ width: 16, height: 16 }} />
                                            <span>{done} / {total} stops</span>
                                        </div>

                                        <div className="progress" style={{ marginTop: 12 }}>
                                            <span style={{ width: `${pct}%`, background: (d.color && d.color.trim()) ? d.color : "#3665F3" }} />
                                        </div>
                                    </div>
                                </Link>
                            );
                        })}
                    </div>
                </div>
            </div>

            <style
                dangerouslySetInnerHTML={{
                    __html: `
          :root{
            --bg:#eef2f7; --border:#e5e7eb; --muted:#6b7280; --radius:14px;
            --shadow:0 8px 22px rgba(16,24,40,.06), 0 2px 8px rgba(16,24,40,.04);
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
          .sub{margin:.25rem 0 0;color:var(--muted)}
          .bold{font-weight:800}
          .muted{color:var(--muted)}
          .hdr{display:flex;align-items:center;gap:12px;margin-bottom:16px}
          .hdr-badge{width:44px;height:44px;border-radius:12px;display:grid;place-items:center;background:#e7eefc;color:#2748d8;
            box-shadow:inset 0 0 0 1px rgba(39,72,216,.12)}
          .progress{width:100%;height:10px;border-radius:999px;background:#f1f5f9;overflow:hidden}
          .progress>span{display:block;height:100%;border-radius:999px;transition:width .25s ease}
          .search-wrap{margin-bottom:16px}
        `,
                }}
            />
        </div>
    );
}