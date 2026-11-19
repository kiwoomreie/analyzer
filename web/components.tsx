import { useEffect, useRef, useState } from "react";
import { DATA_MODE_LABEL, type DataMode } from "../shared/model.ts";

export function Text(p: { label: string; value?: string; onChange: (v: string | undefined) => void; placeholder?: string; wide?: boolean; testId?: string; hint?: string }) {
  return (
    <label className={`field${p.wide ? " wide" : ""}`}>
      <span>{p.label}</span>
      <input data-testid={p.testId} value={p.value ?? ""} placeholder={p.placeholder} onChange={(e: any) => p.onChange(e.target.value === "" ? undefined : e.target.value)} />
      {p.hint && <small className="muted">{p.hint}</small>}
    </label>
  );
}

/** 빈칸=미입력(undefined)과 숫자 0을 구분한다. */
export function Num(p: { label: string; value?: number | null; onChange: (v: number | undefined) => void; step?: string; suffix?: string; testId?: string; hint?: string; integer?: boolean }) {
  const [raw, setRaw] = useState(p.value === undefined || p.value === null ? "" : String(p.value));
  const last = useRef(p.value);
  useEffect(() => {
    if (p.value !== last.current) { last.current = p.value; setRaw(p.value === undefined || p.value === null ? "" : String(p.value)); }
  }, [p.value]);
  return (
    <label className="field">
      <span>{p.label}{p.suffix ? ` (${p.suffix})` : ""}</span>
      <input data-testid={p.testId} inputMode="decimal" value={raw}
        onChange={(e: any) => {
          const s = e.target.value.replace(/,/g, "");
          setRaw(e.target.value);
          if (s.trim() === "") { last.current = undefined; p.onChange(undefined); return; }
          const n = Number(s);
          if (Number.isFinite(n) && (!p.integer || Number.isInteger(n))) { last.current = n; p.onChange(n); }
        }} />
      {p.hint && <small className="muted">{p.hint}</small>}
    </label>
  );
}

export function Select<T extends string>(p: { label: string; value: T | undefined; options: [T, string][]; onChange: (v: T) => void; testId?: string; allowEmpty?: boolean }) {
  return (
    <label className="field">
      <span>{p.label}</span>
      <select data-testid={p.testId} value={p.value ?? ""} onChange={(e: any) => p.onChange(e.target.value as T)}>
        {p.allowEmpty && <option value="">선택</option>}
        {p.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

export function DateText(p: { label: string; value?: string; onChange: (v: string | undefined) => void; dayOnly?: boolean; testId?: string }) {
  const ok = !p.value || (p.dayOnly ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{4}-\d{2}(-\d{2})?$/).test(p.value);
  return (
    <label className="field">
      <span>{p.label}</span>
      <input data-testid={p.testId} value={p.value ?? ""} placeholder={p.dayOnly ? "YYYY-MM-DD" : "YYYY-MM 또는 YYYY-MM-DD"} className={ok ? "" : "invalid"} onChange={(e: any) => p.onChange(e.target.value === "" ? undefined : e.target.value)} />
      {!ok && <small className="err">날짜 형식 확인</small>}
    </label>
  );
}

export function Check(p: { label: string; checked: boolean; onChange: (v: boolean) => void; testId?: string }) {
  return (
    <label className="check">
      <input type="checkbox" data-testid={p.testId} checked={p.checked} onChange={(e: any) => p.onChange(e.target.checked)} /> {p.label}
    </label>
  );
}

export function ModeBadge({ mode }: { mode: DataMode }) {
  return <span className={`badge mode-${mode}`}>{DATA_MODE_LABEL[mode]}</span>;
}

export function Badge({ tone, children }: { tone: "info" | "warn" | "bad" | "ok" | "muted"; children: any }) {
  return <span className={`badge tone-${tone}`}>{children}</span>;
}

/** 펼쳐 보는 상세 영역. 펼침 상태는 탭 세션 동안 유지(입력 중 사라지지 않게). */
export function Section(p: { id: string; title: string; summary?: string; children: any }) {
  const sk = `la.open.${p.id}`;
  const [open, setOpen] = useState<boolean>(() => { try { return sessionStorage.getItem(sk) === "1" || location.hash === `#${p.id}`; } catch { return false; } });
  return (
    <details className="section" id={p.id} open={open} onToggle={(e: any) => { const o = e.target.open; setOpen(o); try { sessionStorage.setItem(sk, o ? "1" : "0"); } catch { /* 무시 */ } }}>
      <summary><span className="sec-title">{p.title}</span>{p.summary && <span className="sec-sum muted">{p.summary}</span>}</summary>
      {open && <div className="sec-body">{p.children}</div>}
    </details>
  );
}

/** 월별 거래 건수(본건 권역·비교 권역) 막대. 단일 축, 2개 계열 + 범례, 마우스 올리면 값 표시. */
export function MonthlyBars({ data, single }: { data: { month: string; target: number; comparator: number }[]; single?: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  if (!data.length) return <p className="muted">표시할 기간 없음</p>;
  const W = 720, H = 180, padL = 32, padB = 22, padT = 8;
  const max = Math.max(1, ...data.map((d) => Math.max(d.target, d.comparator)));
  const bw = (W - padL - 8) / data.length;
  const barW = Math.max(1, Math.min(10, bw / 2 - 1));
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / max);
  const ticks = [0, Math.ceil(max / 2), max];
  return (
    <div className="chart">
      {single ? <div className="legend muted">월별 거래 건수</div> : <div className="legend"><span className="sw s1" /> 본건 권역 <span className="sw s2" /> 비교 권역 <span className="muted">· 포함된 비교거래 건수(월)</span></div>}
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="월별 포함 비교거래 건수">
        {ticks.map((t) => <g key={t}><line x1={padL} x2={W - 4} y1={y(t)} y2={y(t)} className="grid" /><text x={padL - 4} y={y(t) + 3} className="tick" textAnchor="end">{t}</text></g>)}
        {data.map((d, i) => {
          const x = padL + i * bw;
          return (
            <g key={d.month} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={x} y={padT} width={bw} height={H - padT - padB} className="hit" />
              {d.target > 0 && <rect x={single ? x + bw / 2 - barW / 2 : x + bw / 2 - barW - 1} y={y(d.target)} width={barW} height={y(0) - y(d.target)} rx={2} className="bar s1" />}
              {d.comparator > 0 && <rect x={x + bw / 2 + 1} y={y(d.comparator)} width={barW} height={y(0) - y(d.comparator)} rx={2} className="bar s2" />}
              {(i % 6 === 0) && <text x={x + bw / 2} y={H - 6} className="tick" textAnchor="middle">{d.month}</text>}
            </g>
          );
        })}
      </svg>
      <div className="tooltip-line">{hover !== null ? (single ? `${data[hover].month}: ${data[hover].target}건` : `${data[hover].month}: 본건 권역 ${data[hover].target}건 · 비교 권역 ${data[hover].comparator}건`) : "막대에 마우스를 올리면 월별 건수 표시"}</div>
    </div>
  );
}

/** 지도: 카카오 키가 없으면 좌표 상대 위치 도식(번호 마커 + 상세 패널). 실제 지도·경로가 아님. */
export function MapPanel({ points, kakaoKey }: { points: { n: number; label: string; lat: number; lng: number; detail: string; kind: "property" | "event" }[]; kakaoKey: string | null }) {
  const [sel, setSel] = useState<number | null>(points[0]?.n ?? null);
  if (!points.length) return <p className="muted">좌표가 있는 항목이 없어 위치를 표시하지 않음</p>;
  const lats = points.map((p) => p.lat), lngs = points.map((p) => p.lng);
  const [minLat, maxLat, minLng, maxLng] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
  const W = 360, H = 260, pad = 24;
  const sx = (lng: number) => pad + ((lng - minLng) / (maxLng - minLng || 1)) * (W - 2 * pad);
  const sy = (lat: number) => H - pad - ((lat - minLat) / (maxLat - minLat || 1)) * (H - 2 * pad);
  const cur = points.find((p) => p.n === sel);
  return (
    <div className="map-wrap">
      <div>
        <p className="muted small">{kakaoKey ? "카카오맵 키 설정됨 — 지도 연동은 미검증, 좌표 도식으로 표시" : "지도 미설정(카카오맵 키 없음) — 좌표 상대 위치 도식"}</p>
        <svg viewBox={`0 0 ${W} ${H}`} className="map" role="img" aria-label="좌표 상대 위치">
          {points.map((p) => (
            <g key={p.n} onClick={() => setSel(p.n)} className={`marker ${p.kind}${p.n === sel ? " sel" : ""}`}>
              <circle cx={sx(p.lng)} cy={sy(p.lat)} r={11} />
              <text x={sx(p.lng)} y={sy(p.lat) + 4} textAnchor="middle">{p.n}</text>
            </g>
          ))}
        </svg>
      </div>
      <div className="map-detail">
        <ol>{points.map((p) => <li key={p.n} className={p.n === sel ? "sel" : ""}><button className="link" onClick={() => setSel(p.n)}>{p.n}. {p.label}</button></li>)}</ol>
        {cur && <div className="card small"><b>{cur.n}. {cur.label}</b><div>{cur.lat.toFixed(5)}, {cur.lng.toFixed(5)}</div><div className="muted">{cur.detail}</div></div>}
      </div>
    </div>
  );
}

declare const __PREVIEW__: boolean | undefined;
const IS_PREVIEW = typeof __PREVIEW__ !== "undefined" && __PREVIEW__;

/** 호스팅 미리보기(claude.ai 아티팩트)에서 제공되는 저장 기능. 없으면 null. */
let hostDownloads: Promise<any> | undefined;
function getHostDownloads(): Promise<any> {
  if (!hostDownloads) {
    const c = (window as any).claude;
    hostDownloads = c && typeof c.use === "function" ? Promise.resolve(c.use("downloads")).catch(() => null) : Promise.resolve(null);
  }
  return hostDownloads;
}

/** 파일 내려받기. 미리보기에서는 호스트 저장 기능 → 실패 시 화면 패널(복사)로 대체한다. */
export function download(filename: string, text: string, mime = "text/markdown;charset=utf-8") {
  if (IS_PREVIEW) {
    const fallback = (why?: string) => window.dispatchEvent(new CustomEvent("la:download", { detail: { filename, text, why } }));
    getHostDownloads().then((dl) => {
      if (!dl) {
        plainDownload(filename, text, mime);
        // GitHub Pages 등 단독 접속에서는 일반 내려받기로 충분. 다른 화면 안(프레임)이면 막힐 수 있어 내용 패널도 표시
        const framed = (() => { try { return window.top !== window.self; } catch { return true; } })();
        if (framed) fallback();
        return;
      }
      dl.save({ filename, data: text }).catch((e: any) => { if (e?.code !== "declined") fallback(`저장 실패(${e?.code ?? "unknown"})`); });
    });
    return;
  }
  plainDownload(filename, text, mime);
}

function plainDownload(filename: string, text: string, mime: string) {
  try {
    const blob = new Blob([text], { type: mime });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  } catch { /* 미리보기에서는 패널로 대체 */ }
}

/** 클립보드 복사(실패 시 false). */
export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fallback */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy"); ta.remove(); return ok;
  } catch { return false; }
}

export function CopyButton({ text, label = "복사", testId }: { text: string; label?: string; testId?: string }) {
  const [msg, setMsg] = useState<string | undefined>();
  return (
    <button data-testid={testId} onClick={async () => { const ok = await copyText(text); setMsg(ok ? "복사됨" : "복사 실패 — 아래 내용을 직접 선택해 복사하세요"); setTimeout(() => setMsg(undefined), 2500); }}>
      {msg ?? label}
    </button>
  );
}

/** 미리보기 전용: 내려받기 대신 내용을 보여주는 패널. */
export function DownloadFallback() {
  const [item, setItem] = useState<{ filename: string; text: string; why?: string } | undefined>();
  useEffect(() => {
    const on = (e: Event) => setItem((e as CustomEvent).detail);
    window.addEventListener("la:download", on);
    return () => window.removeEventListener("la:download", on);
  }, []);
  if (!item) return null;
  return (
    <div className="dl-fallback" role="dialog" aria-label="내려받기 내용" data-testid="dl-fallback">
      <div className="dl-head">
        <b>{item.filename}</b>
        <span className="muted small">{item.why ? `${item.why} — ` : ""}미리보기 화면에서는 파일 내려받기가 막힐 수 있어 내용을 여기에도 표시합니다.</span>
        <CopyButton text={item.text} label="전체 복사" testId="dl-copy" />
        <button onClick={() => setItem(undefined)} data-testid="dl-close">닫기</button>
      </div>
      <textarea readOnly value={item.text} />
    </div>
  );
}

/** ARCHIVE 계열 로고(마름모 안 집 모양) */
export function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 40 40" aria-hidden="true">
      <rect x="8" y="8" width="24" height="24" transform="rotate(45 20 20)" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <path d="M14.5 26.5v-7l5.5-4.5 5.5 4.5v7z" fill="none" stroke="currentColor" strokeWidth="1.1" />
      <path d="M18.2 26.5v-4h3.6v4" fill="none" stroke="currentColor" strokeWidth="1.1" />
    </svg>
  );
}

export interface RailStep { id: string; label: string; done?: boolean }
/** 왼쪽 안내 영역: 표어·제목·단계 목록. 단계를 누르면 해당 상세 영역을 펼쳐 이동 */
export function Rail({ eyebrow, title, lead, steps, current, onStep, foot }: { eyebrow: string; title: any; lead?: any; steps?: RailStep[]; current?: string; onStep?: (id: string) => void; foot?: any }) {
  return (
    <aside className="rail" data-testid="rail">
      <p className="eyebrow">{eyebrow}</p>
      <h1 className="rail-title">{title}</h1>
      {lead && <p className="rail-lead">{lead}</p>}
      {steps && (
        <ol className="steps">
          {steps.map((s, i) => (
            <li key={s.id} className={`${s.id === current ? "cur" : ""} ${s.done ? "done" : ""}`}>
              <button className="step-btn" onClick={() => onStep?.(s.id)} data-testid={`step-${s.id}`}>
                <span className="step-no">{s.done && s.id !== current ? "√" : i + 1}</span>
                <span className="step-label">{s.label}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
      {foot && <div className="rail-foot">{foot}</div>}
    </aside>
  );
}

/** 상세 영역(details)을 펼치고 그 위치로 이동 */
export function openSection(id: string) {
  const el = document.getElementById(id) as HTMLDetailsElement | null;
  if (!el) return;
  if (!el.open) el.open = true;
  requestAnimationFrame(() => el.scrollIntoView({ behavior: "smooth", block: "start" }));
}
