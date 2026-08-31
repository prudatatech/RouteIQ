import { useMemo, useState, useEffect, useRef } from "react";
import { useQuery } from '@tanstack/react-query';
import { analyticsAPI } from '@/services/api';
import {
  ResponsiveContainer, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import {
  Truck, Users, Building2, TrendingUp, Filter, Search, ArrowUp, ArrowDown, ArrowUpDown,
  Star, Clock, AlertTriangle, DollarSign, Package, MapPin, Calendar, RotateCcw,
  ShieldCheck, Gauge, Route, ChevronDown,
} from "lucide-react";

/* ─── Theme ─────────────────────────────────────────────────────────────── */
const T = {
  bg: "#ffffff",
  panel: "#fafafa",
  panel2: "#f4f4f5",
  border: "#e4e4e7",
  borderSoft: "#f0f0f0",
  text: "#0f172a",
  sub: "#475569",
  mute: "#94a3b8",
  amber: "#d97706",
  amberSoft: "#fef3c7",
  yellow: "#eab308",
  yellowSoft: "#fef9c3",
  red: "#ef4444",
  redSoft: "#fee2e2",
  green: "#16a34a",
  greenSoft: "#dcfce7",
  blue: "#2563eb",
  blueSoft: "#dbeafe",
};

const fontDisplay = "'Space Grotesk', 'Sora', sans-serif";
const fontBody = "'Inter', sans-serif";

/* ─── Mock trend data ────────────────────────────────────────────────────── */
const WEEKS = ["W1","W2","W3","W4","W5","W6","W7","W8"];
let _s = 7421;
const rand = () => { _s |= 0; _s = (_s + 0x6d2b79f5) | 0; let t = Math.imul(_s ^ (_s >>> 15), 1 | _s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const driverTrend = WEEKS.map((w, i) => ({ week: w, onTime: Number((88 + Math.sin(i / 1.6) * 4 + rand() * 3 - 1.5).toFixed(1)) }));
const vendorTrend  = WEEKS.map((w, i) => ({ week: w, sla: Number((90 + Math.cos(i / 1.8) * 3.5 + rand() * 2.4 - 1.2).toFixed(1)) }));

const DATE_RANGES = [
  { id: "7d",  label: "Last 7 days",  mult: 0.24 },
  { id: "30d", label: "Last 30 days", mult: 1 },
  { id: "90d", label: "Last 90 days", mult: 2.9 },
];

const REGIONS = [
  "North India (Delhi, Punjab, UP)",
  "South India (Karnataka, TN, Kerala)",
  "East India (West Bengal, Bihar, Odisha)",
  "West India (Maharashtra, Gujarat, Rajasthan)",
  "Central India (MP, Chhattisgarh)",
  "Northeast India",
];

/* ─── Image-3 style MetricCard ───────────────────────────────────────────── */
function MetricCard({ icon: Icon, label, value, accent = T.amber }: any) {
  return (
    <div style={{
      flex: 1, minWidth: 160,
      background: "#fff",
      border: `1px solid ${T.border}`,
      borderRadius: 16,
      padding: "20px 18px",
      display: "flex", flexDirection: "column", gap: 14,
      boxShadow: "0 1px 4px rgba(0,0,0,0.05)",
    }}>
      {/* Icon + label row */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{
          background: T.amberSoft,
          borderRadius: 10, padding: 8,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          <Icon size={16} color={T.amber} />
        </div>
        <span style={{ fontSize: 13, fontWeight: 600, color: T.sub }}>{label}</span>
      </div>
      {/* Bold value */}
      <div style={{ fontSize: 28, fontWeight: 800, color: T.text, fontFamily: fontDisplay, lineHeight: 1 }}>
        {value}
      </div>
    </div>
  );
}

/* ─── Status pill ─────────────────────────────────────────────────────────── */
function StatusPill({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    available:   { bg: T.yellowSoft, color: T.yellow },
    on_route:    { bg: T.amberSoft,  color: T.amber },
    idle:        { bg: T.panel2,     color: T.sub },
    maintenance: { bg: T.redSoft,    color: T.red },
    offline:     { bg: T.panel2,     color: T.mute },
    Active:      { bg: T.greenSoft,  color: T.green },
    "Under review": { bg: T.amberSoft, color: T.amber },
  };
  const c = map[status] || map.available;
  return (
    <span style={{
      background: c.bg, color: c.color,
      fontSize: 11, fontWeight: 700,
      padding: "3px 10px", borderRadius: 20,
      whiteSpace: "nowrap", textTransform: "capitalize",
    }}>
      {status?.replace("_", " ")}
    </span>
  );
}

/* ─── Sort-able table header ─────────────────────────────────────────────── */
function Th({ label, sortKey, active, dir, onClick, align }: any) {
  return (
    <th
      onClick={() => onClick(sortKey)}
      style={{
        textAlign: align || "left", padding: "10px 14px", fontSize: 11,
        letterSpacing: "0.05em", textTransform: "uppercase",
        color: active ? T.text : T.sub, cursor: "pointer",
        userSelect: "none", whiteSpace: "nowrap",
        borderBottom: `1px solid ${T.border}`, fontFamily: fontBody, fontWeight: 600,
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
        {label}
        {active ? (dir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ArrowUpDown size={11} style={{ opacity: 0.4 }} />}
      </span>
    </th>
  );
}

const lightTt = {
  background: "#fff", border: `1px solid ${T.border}`,
  borderRadius: 10, padding: "8px 12px", fontSize: 12,
  boxShadow: "0 4px 6px -1px rgba(0,0,0,0.07)",
};

/* ════════════════════════════════════════════════════════════════════════════
   DRIVER ANALYTICS — standalone
═══════════════════════════════════════════════════════════════════════════════ */
function DriverAnalyticsView() {
  const [dateRange, setDateRange] = useState("30d");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [[sortKey, sortDir], setSort] = useState<[string, "asc" | "desc"]>(["completed_routes", "desc"]);

  const { data: raw = [] } = useQuery({ queryKey: ["driver-performance"], queryFn: () => analyticsAPI.driverPerformance().then((d: any) => Array.isArray(d) ? d : []), refetchInterval: 30_000 });
  const mult = DATE_RANGES.find(d => d.id === dateRange)?.mult || 1;

  const drivers = useMemo(() =>
    (raw as any[])
      .map(d => ({ ...d, vehicle: d.plate_number, type: d.vehicle_type, status: d.status || "available" }))
      .filter(d => {
        const s = search.toLowerCase();
        const matchSearch = s === "" || d.name?.toLowerCase().includes(s) || d.plate_number?.toLowerCase().includes(s);
        return (statusFilter === "All" || d.status === statusFilter) && matchSearch;
      })
      .sort((a, b) => sortDir === "asc" ? (a[sortKey] > b[sortKey] ? 1 : -1) : (a[sortKey] < b[sortKey] ? 1 : -1)),
  [raw, search, statusFilter, sortKey, sortDir]);

  const toggle = (k: string) => setSort([k, sortKey === k && sortDir === "desc" ? "asc" : "desc"]);

  const kpis = {
    trips:     Math.round(drivers.reduce((s: number, d: any) => s + d.completed_routes, 0) * mult),
    onTime:    Number((drivers.reduce((s: number, d: any) => s + d.on_time_pct, 0) / (drivers.length || 1)).toFixed(1)),
    rating:    Number((drivers.reduce((s: number, d: any) => s + d.rating, 0) / (drivers.length || 1)).toFixed(2)),
    incidents: Math.round(drivers.length * 0.5 * mult),
    distance:  Math.round(drivers.reduce((s: number, d: any) => s + d.total_distance_km, 0) * mult),
  };

  const barData = drivers.slice(0, 8).map((d: any) => ({
    name: d.name !== "Unassigned" ? d.name.split(" ")[0] : d.vehicle,
    trips: Math.round(d.completed_routes * mult),
  }));

  const selectStyle: React.CSSProperties = {
    background: T.panel, border: "none", fontSize: 13,
    cursor: "pointer", paddingRight: 20, appearance: "none",
    outline: "none", fontFamily: fontBody,
  };

  return (
    <div style={{ background: T.bg, padding: "0 0 24px 0" }}>
      {/* ── Filters ── */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 24 }}>
        <div style={{ background: T.panel, border: `1px solid ${T.borderSoft}`, borderRadius: 14, padding: "10px 16px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", flex: 1, minWidth: 200 }}>
          <Filter size={15} color={T.mute} />
          <span style={{ fontSize: 13, fontWeight: 700, color: T.text, marginRight: "auto" }}>Advanced filters</span>
          <div style={{ position: "relative" }}>
            <Calendar size={13} style={{ position: "absolute", left: 8, top: 9, color: T.mute, pointerEvents: "none" }} />
            <select value={dateRange} onChange={e => setDateRange(e.target.value)} style={{ ...selectStyle, paddingLeft: 26 }}>
              {DATE_RANGES.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>
            <ChevronDown size={11} style={{ position: "absolute", right: 6, top: 10, color: T.mute, pointerEvents: "none" }} />
          </div>
          <div style={{ position: "relative" }}>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={selectStyle}>
              <option value="All">Fleet: All</option>
              <option value="available">Available</option>
              <option value="on_route">On Route</option>
              <option value="idle">Idle</option>
              <option value="maintenance">Maintenance</option>
              <option value="offline">Offline</option>
            </select>
            <ChevronDown size={11} style={{ position: "absolute", right: 6, top: 10, color: T.mute, pointerEvents: "none" }} />
          </div>
        </div>
        <div style={{ position: "relative", flex: 2, minWidth: 220 }}>
          <Search size={15} color={T.mute} style={{ position: "absolute", left: 13, top: 12 }} />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search driver or vehicle..."
            style={{ width: "100%", background: T.panel, border: `1px solid ${T.borderSoft}`, borderRadius: 14, padding: "11px 14px 11px 36px", fontSize: 13, color: T.text, outline: "none", fontFamily: fontBody, boxSizing: "border-box" }}
          />
        </div>
        {(search || statusFilter !== "All" || dateRange !== "30d") && (
          <button onClick={() => { setSearch(""); setStatusFilter("All"); setDateRange("30d"); }} style={{ background: T.panel, border: `1px solid ${T.borderSoft}`, borderRadius: 14, padding: "0 16px", color: T.sub, fontSize: 13, fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
            <RotateCcw size={13} /> Reset
          </button>
        )}
      </div>

      {/* ── KPI cards ── */}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 28 }}>
        <MetricCard icon={Route} label="Trips Completed" value={kpis.trips.toLocaleString("en-IN")} />
        <MetricCard icon={Clock} label="On-time %" value={kpis.onTime + "%"} />
        <MetricCard icon={Star} label="Avg Driver Rating" value={kpis.rating} />
        <MetricCard icon={AlertTriangle} label="Incidents" value={kpis.incidents} />
        <MetricCard icon={Gauge} label="Total Distance" value={`${kpis.distance.toLocaleString("en-IN")} km`} />
      </div>

      {/* ── Control Tower section ── */}
      <div style={{ background: T.panel, border: `1px solid ${T.borderSoft}`, borderRadius: 18, padding: 24, marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <div style={{ background: T.amberSoft, padding: 10, borderRadius: 12, display: "flex" }}>
            <Truck size={20} color={T.amber} />
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: T.text, fontFamily: fontDisplay }}>
              Control Tower: Fleet & Driver Analytics
              <span style={{ fontSize: 12, background: T.panel2, color: T.sub, padding: "2px 8px", borderRadius: 12, fontWeight: 600, marginLeft: 8 }}>{drivers.length}</span>
            </h3>
            <p style={{ margin: 0, fontSize: 12, color: T.mute, marginTop: 2 }}>Live tracking from Control Tower & Cargo Network</p>
          </div>
        </div>

        {/* Charts */}
        <div style={{ display: "flex", gap: 18, height: 260, marginBottom: 20 }}>
          <div style={{ flex: 1, background: '#fff', borderRadius: 16, border: `1px solid ${T.border}`, padding: '16px 18px', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
            <h4 style={{ fontSize: 12, fontWeight: 700, color: T.sub, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.07em" }}>Weekly Punctuality Trend</h4>
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={driverTrend} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="drvGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f59e0b" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#fde68a" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="week" tick={{ fill: '#6b7280', fontSize: 11, fontWeight: 500 }} axisLine={false} tickLine={false} />
                <YAxis domain={[75, 100]} tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} unit="%" />
                <Tooltip contentStyle={{ ...lightTt, fontSize: 13 }} formatter={(v: any) => [`${v}%`, 'On-time']} />
                <Area type="monotone" dataKey="onTime" stroke="#f59e0b" strokeWidth={3} fill="url(#drvGrad)" name="On-time %" dot={{ r: 3, fill: '#f59e0b', strokeWidth: 0 }} activeDot={{ r: 6, fill: '#d97706' }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div style={{ flex: 1, background: '#fff', borderRadius: 16, border: `1px solid ${T.border}`, padding: '16px 18px', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
            <h4 style={{ fontSize: 12, fontWeight: 700, color: T.sub, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.07em" }}>Top Drivers by Volume</h4>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={barData} margin={{ top: 5, right: 8, left: -10, bottom: 0 }} barCategoryGap="30%">
                <defs>
                  <linearGradient id="barGradDrv" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#f59e0b" stopOpacity={1} />
                    <stop offset="100%" stopColor="#ea580c" stopOpacity={0.8} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ ...lightTt, fontSize: 13 }} cursor={{ fill: 'rgba(245,158,11,0.06)' }} />
                <Bar dataKey="trips" fill="url(#barGradDrv)" radius={[6, 6, 0, 0]} name="Trips" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Table */}
        <div style={{ overflowX: "auto", border: `1px solid ${T.borderSoft}`, borderRadius: 12 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: T.panel2 }}>
                <Th label="Vehicle (Plate)" sortKey="vehicle" active={sortKey === "vehicle"} dir={sortDir} onClick={toggle} />
                <Th label="Type" sortKey="type" active={sortKey === "type"} dir={sortDir} onClick={toggle} />
                <Th label="Driver Assigned" sortKey="name" active={sortKey === "name"} dir={sortDir} onClick={toggle} />
                <Th label="Trips" sortKey="completed_routes" active={sortKey === "completed_routes"} dir={sortDir} onClick={toggle} align="right" />
                <Th label="On-time" sortKey="on_time_pct" active={sortKey === "on_time_pct"} dir={sortDir} onClick={toggle} align="right" />
                <Th label="Rating" sortKey="rating" active={sortKey === "rating"} dir={sortDir} onClick={toggle} align="right" />
                <Th label="Status" sortKey="status" active={sortKey === "status"} dir={sortDir} onClick={toggle} />
              </tr>
            </thead>
            <tbody>
              {drivers.length === 0 ? (
                <tr><td colSpan={7} style={{ padding: 24, textAlign: "center", color: T.mute, fontSize: 13 }}>No drivers found</td></tr>
              ) : drivers.map((d: any) => (
                <tr key={d.id} style={{ borderBottom: `1px solid ${T.borderSoft}` }}
                  onMouseEnter={e => (e.currentTarget.style.background = T.panel)}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                  <td style={{ padding: "10px 14px", fontWeight: 800, color: T.text }}>{d.vehicle}</td>
                  <td style={{ padding: "10px 14px", color: T.sub, textTransform: "uppercase", fontSize: 11, fontWeight: 600 }}>{d.type}</td>
                  <td style={{ padding: "10px 14px", color: T.sub }}>{d.name}</td>
                  <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 700 }}>{d.completed_routes}</td>
                  <td style={{ padding: "10px 14px", textAlign: "right" }}>{d.on_time_pct}%</td>
                  <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 700, color: d.rating >= 4 ? T.green : d.rating >= 3 ? T.amber : T.red }}>{d.rating}</td>
                  <td style={{ padding: "10px 14px" }}><StatusPill status={d.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   VENDOR ANALYTICS — standalone
═══════════════════════════════════════════════════════════════════════════════ */
function VendorAnalyticsView() {
  const [dateRange, setDateRange] = useState("30d");
  const [search, setSearch] = useState("");
  const [[sortKey, sortDir], setSort] = useState<[string, "asc" | "desc"]>(["deliveries", "desc"]);

  const { data: raw = [] } = useQuery({ queryKey: ["vendor-performance"], queryFn: () => analyticsAPI.vendorPerformance().then((d: any) => Array.isArray(d) ? d : []), refetchInterval: 30_000 });
  const mult = DATE_RANGES.find(d => d.id === dateRange)?.mult || 1;

  const vendors = useMemo(() =>
    (raw as any[])
      .filter(v => {
        const s = search.toLowerCase();
        return s === "" || v.name?.toLowerCase().includes(s) || v.id?.toLowerCase().includes(s);
      })
      .sort((a, b) => sortDir === "asc" ? (a[sortKey] > b[sortKey] ? 1 : -1) : (a[sortKey] < b[sortKey] ? 1 : -1)),
  [raw, search, sortKey, sortDir]);

  const toggle = (k: string) => setSort([k, sortKey === k && sortDir === "desc" ? "asc" : "desc"]);

  const kpis = {
    deliveries: Math.round(vendors.reduce((s: number, v: any) => s + v.deliveries, 0) * mult),
    sla:        Number((vendors.reduce((s: number, v: any) => s + v.sla, 0) / (vendors.length || 1)).toFixed(1)),
    cost:       Number((vendors.reduce((s: number, v: any) => s + v.costPerDelivery, 0) / (vendors.length || 1)).toFixed(0)),
    damage:     Number((vendors.reduce((s: number, v: any) => s + v.damageRate, 0) / (vendors.length || 1)).toFixed(2)),
  };

  const barData = vendors.slice(0, 8).map((v: any) => ({ name: v.name.slice(0, 10), cost: v.costPerDelivery }));

  const selectStyle: React.CSSProperties = {
    background: T.panel, border: "none", fontSize: 13,
    cursor: "pointer", paddingRight: 20, appearance: "none",
    outline: "none", fontFamily: fontBody,
  };

  return (
    <div style={{ background: T.bg, padding: "0 0 24px 0" }}>
      {/* ── Filters ── */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 24 }}>
        <div style={{ background: T.panel, border: `1px solid ${T.borderSoft}`, borderRadius: 14, padding: "10px 16px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", flex: 1, minWidth: 200 }}>
          <Filter size={15} color={T.mute} />
          <span style={{ fontSize: 13, fontWeight: 700, color: T.text, marginRight: "auto" }}>Advanced filters</span>
          <div style={{ position: "relative" }}>
            <Calendar size={13} style={{ position: "absolute", left: 8, top: 9, color: T.mute, pointerEvents: "none" }} />
            <select value={dateRange} onChange={e => setDateRange(e.target.value)} style={{ ...selectStyle, paddingLeft: 26 }}>
              {DATE_RANGES.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>
            <ChevronDown size={11} style={{ position: "absolute", right: 6, top: 10, color: T.mute, pointerEvents: "none" }} />
          </div>
        </div>
        <div style={{ position: "relative", flex: 2, minWidth: 220 }}>
          <Search size={15} color={T.mute} style={{ position: "absolute", left: 13, top: 12 }} />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search vendor name or id..."
            style={{ width: "100%", background: T.panel, border: `1px solid ${T.borderSoft}`, borderRadius: 14, padding: "11px 14px 11px 36px", fontSize: 13, color: T.text, outline: "none", fontFamily: fontBody, boxSizing: "border-box" }}
          />
        </div>
        {(search || dateRange !== "30d") && (
          <button onClick={() => { setSearch(""); setDateRange("30d"); }} style={{ background: T.panel, border: `1px solid ${T.borderSoft}`, borderRadius: 14, padding: "0 16px", color: T.sub, fontSize: 13, fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
            <RotateCcw size={13} /> Reset
          </button>
        )}
      </div>

      {/* ── KPI cards ── */}
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 28 }}>
        <MetricCard icon={Package}      label="Total Deliveries"  value={kpis.deliveries.toLocaleString("en-IN")} />
        <MetricCard icon={ShieldCheck}  label="SLA Compliance"    value={kpis.sla + "%"} />
        <MetricCard icon={DollarSign}   label="Avg Cost / Delivery" value={`₹${kpis.cost.toLocaleString("en-IN")}`} />
        <MetricCard icon={AlertTriangle} label="Damage Rate"       value={kpis.damage + "%"} />
        <MetricCard icon={Building2}    label="Active Vendors"    value={vendors.length} />
      </div>

      {/* ── Vendor Portal section ── */}
      <div style={{ background: T.panel, border: `1px solid ${T.borderSoft}`, borderRadius: 18, padding: 24, marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <div style={{ background: "#f3f4f6", padding: 10, borderRadius: 12, display: "flex" }}>
            <Building2 size={20} color={T.text} />
          </div>
          <div>
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: T.text, fontFamily: fontDisplay }}>
              Vendor Portal: Partner Analytics
              <span style={{ fontSize: 12, background: T.panel2, color: T.sub, padding: "2px 8px", borderRadius: 12, fontWeight: 600, marginLeft: 8 }}>{vendors.length}</span>
            </h3>
            <p style={{ margin: 0, fontSize: 12, color: T.mute, marginTop: 2 }}>Live performance metrics from Vendor Portal operations</p>
          </div>
        </div>

        {/* Charts */}
        <div style={{ display: "flex", gap: 18, height: 260, marginBottom: 20 }}>
          <div style={{ flex: 1, background: '#fff', borderRadius: 16, border: `1px solid ${T.border}`, padding: '16px 18px', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
            <h4 style={{ fontSize: 12, fontWeight: 700, color: T.sub, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.07em" }}>SLA Compliance Trend</h4>
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={vendorTrend} margin={{ top: 5, right: 8, left: -10, bottom: 0 }}>
                <defs>
                  <linearGradient id="vndGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#6366f1" stopOpacity={0.04} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="week" tick={{ fill: '#6b7280', fontSize: 11, fontWeight: 500 }} axisLine={false} tickLine={false} />
                <YAxis domain={[80, 100]} tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} unit="%" />
                <Tooltip contentStyle={{ ...lightTt, fontSize: 13 }} formatter={(v: any) => [`${v}%`, 'SLA']} />
                <Area type="monotone" dataKey="sla" stroke="#0ea5e9" strokeWidth={3} fill="url(#vndGrad)" name="SLA %" dot={{ r: 3, fill: '#0ea5e9', strokeWidth: 0 }} activeDot={{ r: 6, fill: '#0284c7' }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div style={{ flex: 1, background: '#fff', borderRadius: 16, border: `1px solid ${T.border}`, padding: '16px 18px', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
            <h4 style={{ fontSize: 12, fontWeight: 700, color: T.sub, marginBottom: 12, textTransform: "uppercase", letterSpacing: "0.07em" }}>Highest Cost Vendors (Per Delivery)</h4>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={barData} margin={{ top: 5, right: 8, left: -10, bottom: 0 }} barCategoryGap="30%">
                <defs>
                  <linearGradient id="barGradVnd" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6366f1" stopOpacity={1} />
                    <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.75} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="name" tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fill: '#6b7280', fontSize: 11 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ ...lightTt, fontSize: 13 }} cursor={{ fill: 'rgba(99,102,241,0.06)' }} />
                <Bar dataKey="cost" fill="url(#barGradVnd)" radius={[6, 6, 0, 0]} name="Cost/Delivery" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Table */}
        <div style={{ overflowX: "auto", border: `1px solid ${T.borderSoft}`, borderRadius: 12 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: T.panel2 }}>
                <Th label="Vendor" sortKey="name" active={sortKey === "name"} dir={sortDir} onClick={toggle} />
                <Th label="Region" sortKey="region" active={sortKey === "region"} dir={sortDir} onClick={toggle} />
                <Th label="Deliveries" sortKey="deliveries" active={sortKey === "deliveries"} dir={sortDir} onClick={toggle} align="right" />
                <Th label="SLA %" sortKey="sla" active={sortKey === "sla"} dir={sortDir} onClick={toggle} align="right" />
                <Th label="Cost/Del" sortKey="costPerDelivery" active={sortKey === "costPerDelivery"} dir={sortDir} onClick={toggle} align="right" />
                <Th label="Status" sortKey="status" active={sortKey === "status"} dir={sortDir} onClick={toggle} />
              </tr>
            </thead>
            <tbody>
              {vendors.length === 0 ? (
                <tr><td colSpan={6} style={{ padding: 24, textAlign: "center", color: T.mute, fontSize: 13 }}>No vendors found</td></tr>
              ) : vendors.map((v: any) => (
                <tr key={v.id} style={{ borderBottom: `1px solid ${T.borderSoft}` }}
                  onMouseEnter={e => (e.currentTarget.style.background = T.panel)}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                  <td style={{ padding: "10px 14px", fontWeight: 800, color: T.text }}>{v.name}</td>
                  <td style={{ padding: "10px 14px", color: T.sub }}>{v.region}</td>
                  <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 700 }}>{v.deliveries}</td>
                  <td style={{ padding: "10px 14px", textAlign: "right", fontWeight: 700, color: v.sla >= 90 ? T.green : v.sla >= 75 ? T.amber : T.red }}>{v.sla}%</td>
                  <td style={{ padding: "10px 14px", textAlign: "right" }}>₹{v.costPerDelivery}</td>
                  <td style={{ padding: "10px 14px" }}><StatusPill status={v.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════════
   MAIN EXPORT — routes to the right view based on mode
═══════════════════════════════════════════════════════════════════════════════ */
export default function AdvancedAnalyticsTab({ mode }: { mode: "driver" | "vendor" }) {
  return mode === "driver" ? <DriverAnalyticsView /> : <VendorAnalyticsView />;
}
