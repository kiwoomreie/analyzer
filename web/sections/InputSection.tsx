import { Check, DateText, ModeBadge, Num, Section, Select, Text } from "../components.tsx";
import type { SectionProps } from "../AnalysisView.tsx";
import { LABELS, type MoneyUnit } from "../../shared/contract.ts";
import type { ReviewPrice } from "../../shared/model.ts";
import { diffWorking } from "../../shared/report.ts";
import { fmtMan, fmtNum } from "../../shared/units.ts";

const UNITS = Object.entries(LABELS.moneyUnit) as [MoneyUnit, string][];
const BASES: [ReviewPrice["basis"], string][] = [["household", "세대당(비교 타입 1세대)"], ["perExclusiveM2", "전용㎡당"], ["perExclusivePyeong", "전용평당"]];

export function parseCoord(s: string): { lat: number; lng: number } | null {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(s);
  if (!m) return null;
  const lat = Number(m[1]), lng = Number(m[2]);
  return lat >= 33 && lat <= 39 && lng >= 124 && lng <= 132 ? { lat, lng } : null;
}

/** 위도·경도를 함께 입력할 때만 반영(임의 기본값을 만들지 않음). */
export function CoordField({ value, onChange, label = "좌표(위도, 경도)", hint }: { value?: { lat: number; lng: number }; onChange: (c: { lat: number; lng: number } | undefined) => void; label?: string; hint?: string }) {
  const shown = value ? `${value.lat}, ${value.lng}` : "";
  return (
    <label className="field">
      <span>{label}</span>
      <input key={shown} defaultValue={shown} placeholder="37.4120, 127.1260" data-testid="coord-input" onBlur={(e: any) => {
        const t = e.target.value.trim();
        if (t === "") return value && onChange(undefined);
        const c = parseCoord(t);
        if (c && (c.lat !== value?.lat || c.lng !== value?.lng)) onChange(c);
      }} />
      <small className="muted">{hint ?? (value ? "입력 후 칸을 벗어나면 반영" : "미입력 — 거리 계산 보류")}</small>
    </label>
  );
}

export function InputSection({ rec, update, defaultOpen }: SectionProps) {
  const w = rec.working;
  const r = rec.runs[rec.runs.length - 1].result;
  const diff = diffWorking(rec.original.working, w);
  const rp = w.reviewPrice;
  return (
    <Section id="sec-input" defaultOpen={defaultOpen} title="입력·세부 설정" summary={`${w.property.address} · 전용 ${w.property.exclusiveAreaM2 ? `${w.property.exclusiveAreaM2}㎡` : "미입력"} · 검토가격 ${rp ? `${rp.amount}${LABELS.moneyUnit[rp.unit]}` : "미입력"}`}>
      <h4>대상</h4>
      <div className="form grid">
        <Text label="주소" value={w.property.address} onChange={(v) => update((x) => { if (x.property.address !== v) { delete x.property.coordinates; delete x.property.lawdCode; } x.property.address = v ?? ""; })} wide testId="f-address" />
        <Text label="표시명(선택)" value={w.property.displayName} onChange={(v) => update((x) => { x.property.displayName = v; })} />
        <CoordField value={w.property.coordinates} hint={w.property.coordinates ? `출처: ${w.property.coordinates.source}` : undefined} onChange={(c) => update((x) => { x.property.coordinates = c ? { ...c, source: "사용자 입력" } : undefined; })} />
        <Num label="전용면적(비교 타입)" suffix="㎡" value={w.property.exclusiveAreaM2} onChange={(v) => update((x) => { x.property.exclusiveAreaM2 = v; })} testId="f-area" hint={r.property.exclusivePyeong ? `${fmtNum(r.property.exclusivePyeong)}전용평` : "없으면 가격 판단 보류"} />
        <Num label="준공(예정)연도" integer value={w.property.buildYear} onChange={(v) => update((x) => { x.property.buildYear = v; })} testId="f-buildyear" hint="비교단지 연식 차이 비교용" />
        <Text label="시군구 코드(5자리, 실거래 조회용)" value={w.property.lawdCode} onChange={(v) => update((x) => { x.property.lawdCode = v; })} />
        <DateText label="분석 기준일" value={w.asOf} dayOnly onChange={(v) => v && update((x) => { x.asOf = v; })} />
      </div>

      <h4>검토가격 <span className="muted small">금액 단위와 가격 기준을 따로 지정 · 내부 계산은 원·전용㎡</span></h4>
      <Check label="검토가격 입력" checked={!!rp} onChange={(v) => update((x) => { x.reviewPrice = v ? { amount: 1, unit: "KRW_100M", basis: "household", dataMode: "user" } : null; })} testId="price-toggle" />
      {rp && (
        <div className="form grid">
          <Text label="이름(예: 제시 분양가)" value={rp.label} onChange={(v) => update((x) => { x.reviewPrice!.label = v; })} />
          <Num label="금액" value={rp.amount} onChange={(v) => v !== undefined && update((x) => { x.reviewPrice!.amount = v; })} testId="f-price" />
          <Select label="금액 단위" value={rp.unit} options={UNITS} onChange={(v) => update((x) => { x.reviewPrice!.unit = v; })} testId="f-price-unit" />
          <Select label="가격 기준" value={rp.basis} options={BASES} onChange={(v) => update((x) => { x.reviewPrice!.basis = v; })} />
          <DateText label="가격 기준일" value={rp.basisDate} onChange={(v) => update((x) => { x.reviewPrice!.basisDate = v; })} />
          <div className="small">{r.price.reviewPerM2 !== null ? <>전용㎡당 {fmtMan(r.price.reviewPerM2)} · 전용평당 {fmtMan(r.price.reviewPerPyeong)}</> : <span className="muted">{r.price.reason ?? "분석 다시 실행 후 표시"}</span>} <ModeBadge mode={rp.dataMode} /></div>
        </div>
      )}
      <Text label="가격 근거 문서의 입지 반영 설명(직접 읽은 내용, 선택)" value={w.appraisalNote} onChange={(v) => update((x) => { x.appraisalNote = v; })} wide />

      <h4>본건 일정 <span className="muted small">입력한 경우에만 입지 변화 예정 시점과 비교 · YYYY-MM은 월 정밀도로 보존</span></h4>
      <div className="form grid">
        <DateText label="분양(예정)" value={w.schedule.saleStart} onChange={(v) => update((x) => { x.schedule.saleStart = v; })} />
        <DateText label="준공(예정)" value={w.schedule.completion} onChange={(v) => update((x) => { x.schedule.completion = v; })} />
      </div>

      <details className="sub-details">
        <summary className="small">세부 설정(기본값 사용 권장)</summary>
        <div className="form grid">
          <Num label="비교단지 반경" suffix="m" integer value={w.options.radiusM} onChange={(v) => v && update((x) => { x.options.radiusM = v; })} />
          <Num label="유사면적 범위" suffix="±%" value={w.options.areaBandPct} onChange={(v) => v !== undefined && update((x) => { x.options.areaBandPct = v; })} />
          <Num label="준공연도 차이 한도" suffix="년" integer value={w.options.buildYearBand} onChange={(v) => v !== undefined && update((x) => { x.options.buildYearBand = v; })} />
          <Num label="최근 거래 기간" suffix="개월" integer value={w.options.recentMonths} onChange={(v) => v && update((x) => { x.options.recentMonths = v; })} />
          <Num label="단지별 최소 거래" suffix="건" integer value={w.options.minComplexTrades} onChange={(v) => v && update((x) => { x.options.minComplexTrades = v; })} />
          <Num label="사건 전 비교기간" suffix="개월" integer value={w.options.comparisonMonthsBefore} onChange={(v) => v && update((x) => { x.options.comparisonMonthsBefore = v; })} />
          <Num label="사건 후 비교기간" suffix="개월" integer value={w.options.comparisonMonthsAfter} onChange={(v) => v && update((x) => { x.options.comparisonMonthsAfter = v; })} />
          <Num label="전후 비교 최소 표본" suffix="건" integer value={w.options.minSample} onChange={(v) => v && update((x) => { x.options.minSample = v; })} />
        </div>
      </details>

      <h4>최초 입력과 현재 작업본 비교 <span className="muted small">({diff.length}개 항목)</span></h4>
      {!diff.length ? <p className="muted small">변경 없음</p> : (
        <details><summary className="small">변경 항목 보기</summary>
          <div className="table-scroll"><table className="tbl small" data-testid="diff-table"><thead><tr><th>항목</th><th>최초</th><th>현재</th></tr></thead>
            <tbody>{diff.slice(0, 80).map((d) => <tr key={d.path}><td><code>{d.path}</code></td><td>{d.before}</td><td>{d.after}</td></tr>)}</tbody></table></div>
        </details>
      )}
    </Section>
  );
}
