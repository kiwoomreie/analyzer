import { Check, DateText, ModeBadge, Num, Section, Select, Text } from "../components.tsx";
import type { SectionProps } from "../AnalysisView.tsx";
import { LABELS, type AssetType, type DebtDefinition, type MoneyUnit, type PriceBasis, type PriceKind, type SeniorStatus } from "../../shared/contract.ts";
import { newKey } from "../../shared/model.ts";
import { diffWorking } from "../../shared/report.ts";
import { fmtMan, fmtNum } from "../../shared/units.ts";

const opts = <T extends string>(m: Record<T, string>) => Object.entries(m) as [T, string][];

export function PropertySection({ rec, update }: SectionProps) {
  const w = rec.working;
  const r = rec.runs[rec.runs.length - 1].result;
  const diff = diffWorking(rec.original.working, w);
  const doc = rec.original.document;
  return (
    <Section id="sec-property" title="① 사업장·가정" summary={`${w.property.address ?? "주소 미입력"} · 전용 ${w.property.exclusiveAreaM2 ? `${w.property.exclusiveAreaM2}㎡` : "미입력"} · 가격 ${w.prices.length}건`}>
      {doc && (
        <div className="card sub">
          <h3>전달받은 가정 요약 <span className="muted small">(최초 수신 사본 · 수정 불가)</span></h3>
          <ul className="small">
            <li>대상: {doc.property.displayName ?? "표시명 없음"} · {doc.property.address ?? "주소 없음"} · {LABELS.assetType[doc.property.assetType]}</li>
            <li>좌표: {doc.property.coordinates ? `${doc.property.coordinates.lat}, ${doc.property.coordinates.lng} — ${doc.property.coordinates.senderVerified ? "협의체에서 확인한 좌표(새 앱 미검증)" : "협의체 확인 여부 미표시"}` : "미전달"}</li>
            <li>가격: {(doc.selectedPrices?.prices ?? []).map((p) => `${LABELS.priceKind[p.kind]} ${p.amount.toLocaleString("ko-KR")}${LABELS.moneyUnit[p.unit]}(${LABELS.priceBasis[p.basis]}${p.basisDate ? `, ${p.basisDate}` : ""})`).join(" / ") || "미전달"}</li>
            <li>채권정보: {doc.selectedPrices?.debt ? `포함(사용자 선택) — ${LABELS.debtDefinition[doc.selectedPrices.debt.definition]} ${doc.selectedPrices.debt.amount.toLocaleString("ko-KR")}${LABELS.moneyUnit[doc.selectedPrices.debt.unit]}, ${LABELS.seniorStatus[doc.selectedPrices.debt.seniorStatus]}` : "미포함(기본값)"}</li>
            <li>일정: {Object.entries(doc.schedule ?? {}).map(([k, v]) => `${({ saleStart: "분양", completion: "준공", maturity: "만기", expectedDisposal: "예상 처분" } as any)[k]} ${v}`).join(" · ") || "미전달"}</li>
            <li>시나리오: {doc.scenario?.name ?? "이름 없음"}{doc.scenario?.priceDeclinePct !== undefined ? ` · 하락률 ${doc.scenario.priceDeclinePct}%` : ""}{doc.scenario?.eventDelayMonths !== undefined ? ` · 사건 지연 ${doc.scenario.eventDelayMonths}개월` : ""}{doc.scenario?.disposalDelayMonths !== undefined ? ` · 처분 지연 ${doc.scenario.disposalDelayMonths}개월` : ""}</li>
          </ul>
        </div>
      )}

      <h3>대상·규모</h3>
      <div className="form grid">
        <Text label="표시명" value={w.property.displayName} onChange={(v) => update((x) => { x.property.displayName = v; })} testId="f-name" />
        <Text label="주소" value={w.property.address} onChange={(v) => update((x) => { x.property.address = v; })} wide />
        <Select label="자산유형" value={w.property.assetType} options={opts(LABELS.assetType) as [AssetType, string][]} onChange={(v) => update((x) => { x.property.assetType = v; })} />
        <CoordField value={w.property.coordinates} onChange={(c) => update((x) => { x.property.coordinates = c; })} />
        <Num label="비교 타입 전용면적" suffix="㎡" value={w.property.exclusiveAreaM2} onChange={(v) => update((x) => { x.property.exclusiveAreaM2 = v; })} testId="f-area" hint={r.property.exclusivePyeong ? `${fmtNum(r.property.exclusivePyeong)}전용평` : undefined} />
        <Num label="사업 전체 전용면적 합계" suffix="㎡" value={w.property.totalExclusiveAreaM2} onChange={(v) => update((x) => { x.property.totalExclusiveAreaM2 = v; })} hint="사업 전체 가격을 ㎡당으로 환산할 때만 사용" />
        <Text label="비교 타입" value={w.property.comparisonType} onChange={(v) => update((x) => { x.property.comparisonType = v; })} />
        <Num label="세대수(참고)" value={w.property.householdCount} integer onChange={(v) => update((x) => { x.property.householdCount = v; })} hint="가격 환산에 쓰지 않음" />
        <Text label="시군구 코드(5자리)" value={w.property.lawdCode} onChange={(v) => update((x) => { x.property.lawdCode = v; })} />
        <DateText label="분석 기준일" value={w.asOf} dayOnly onChange={(v) => v && update((x) => { x.asOf = v; })} />
      </div>

      <h3>가격 <span className="muted small">금액 단위와 가격 기준은 별도 항목 · 내부 계산은 원·전용㎡ 기준</span></h3>
      <table className="tbl">
        <thead><tr><th>종류</th><th>금액</th><th>단위</th><th>가격 기준</th><th>기준일</th><th>환산(전용㎡당 / 전용평당)</th><th>자료</th><th /></tr></thead>
        <tbody>
          {w.prices.map((p, i) => {
            const pr = r.prices.find((x) => x.key === p.key);
            return (
              <tr key={p.key}>
                <td><Select label="" value={p.kind} options={opts(LABELS.priceKind) as [PriceKind, string][]} onChange={(v) => update((x) => { x.prices[i].kind = v; })} /></td>
                <td><Num label="" value={p.amount} onChange={(v) => v !== undefined && update((x) => { x.prices[i].amount = v; })} testId={`price-amount-${i}`} /></td>
                <td><Select label="" value={p.unit} options={opts(LABELS.moneyUnit) as [MoneyUnit, string][]} onChange={(v) => update((x) => { x.prices[i].unit = v; })} /></td>
                <td><Select label="" value={p.basis} options={opts(LABELS.priceBasis) as [PriceBasis, string][]} onChange={(v) => update((x) => { x.prices[i].basis = v; })} /></td>
                <td><DateText label="" value={p.basisDate} onChange={(v) => update((x) => { x.prices[i].basisDate = v; })} /></td>
                <td className="small">{pr?.unit ? <>{fmtMan(pr.unit.perM2Krw)} / {fmtMan(pr.unit.perPyeongKrw)}<div className="muted">{pr.unit.conversionNote}</div></> : "분석 재실행 후 표시"}</td>
                <td><ModeBadge mode={p.dataMode} /></td>
                <td><button className="link" onClick={() => update((x) => { x.prices.splice(i, 1); })}>삭제</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button onClick={() => update((x) => { x.prices.push({ key: newKey("price"), kind: "proposedSalePrice", amount: 1, unit: "KRW_100M", basis: "household", dataMode: "user" }); })} data-testid="add-price">가격 추가</button>

      <h3>일정 <span className="muted small">전달·입력된 고정 날짜를 사용(오늘 기준 자동 변경 없음). YYYY-MM은 월 정밀도로 보존</span></h3>
      <div className="form grid">
        <DateText label="분양" value={w.schedule.saleStart} onChange={(v) => update((x) => { x.schedule.saleStart = v; })} />
        <DateText label="준공" value={w.schedule.completion} onChange={(v) => update((x) => { x.schedule.completion = v; })} />
        <DateText label="만기" value={w.schedule.maturity} onChange={(v) => update((x) => { x.schedule.maturity = v; })} testId="f-maturity" />
        <DateText label="예상 처분" value={w.schedule.expectedDisposal} onChange={(v) => update((x) => { x.schedule.expectedDisposal = v; })} />
      </div>

      <h3>시나리오·분석 기준 <span className="muted small">명시적으로 입력한 숫자만 사용</span></h3>
      <div className="form grid">
        <Text label="시나리오 이름" value={w.scenario.name} onChange={(v) => update((x) => { x.scenario.name = v; })} />
        <Num label="가격 하락률" suffix="%" value={w.scenario.priceDeclinePct} onChange={(v) => update((x) => { x.scenario.priceDeclinePct = v; })} />
        <Num label="입지사건 지연" suffix="개월" integer value={w.scenario.eventDelayMonths} onChange={(v) => update((x) => { x.scenario.eventDelayMonths = v; })} />
        <Num label="처분 지연" suffix="개월" integer value={w.scenario.disposalDelayMonths} onChange={(v) => update((x) => { x.scenario.disposalDelayMonths = v; })} />
        <Num label="사건 전 비교기간" suffix="개월" integer value={w.options.comparisonMonthsBefore} onChange={(v) => v && update((x) => { x.options.comparisonMonthsBefore = v; })} />
        <Num label="사건 후 비교기간" suffix="개월" integer value={w.options.comparisonMonthsAfter} onChange={(v) => v && update((x) => { x.options.comparisonMonthsAfter = v; })} />
        <Num label="비교 면적 범위" suffix="±%" value={w.options.areaBandPct} onChange={(v) => v !== undefined && update((x) => { x.options.areaBandPct = v; })} />
        <Num label="전후 비교 최소 표본" suffix="건" integer value={w.options.minSample} onChange={(v) => v && update((x) => { x.options.minSample = v; })} />
        <Text label="검토 목적" value={w.options.purpose} onChange={(v) => update((x) => { x.options.purpose = v; })} wide />
      </div>

      <h3>채권정보 <span className="muted small">선택 항목 · 없어도 입지·가격 분석은 정상 실행</span></h3>
      <Check label="채권정보 입력(이 앱에서 직접)" checked={!!w.debt} onChange={(v) => update((x) => { x.debt = v ? { amount: 1, unit: "KRW_100M", definition: "loanBalance", seniorStatus: "unknown", dataMode: "user" } : null; })} testId="debt-toggle" />
      {w.debt && (
        <div className="form grid">
          <Num label="채권액" value={w.debt.amount} onChange={(v) => v !== undefined && update((x) => { x.debt!.amount = v; })} />
          <Select label="단위" value={w.debt.unit} options={opts(LABELS.moneyUnit) as [MoneyUnit, string][]} onChange={(v) => update((x) => { x.debt!.unit = v; })} />
          <Select label="정의" value={w.debt.definition} options={opts(LABELS.debtDefinition) as [DebtDefinition, string][]} onChange={(v) => update((x) => { x.debt!.definition = v; })} />
          <Select label="선순위" value={w.debt.seniorStatus} options={opts(LABELS.seniorStatus) as [SeniorStatus, string][]} onChange={(v) => update((x) => { x.debt!.seniorStatus = v; if (v !== "confirmedAmount") delete x.debt!.seniorAmount; })} />
          {w.debt.seniorStatus === "confirmedAmount" && <Num label="선순위 금액(같은 단위)" value={w.debt.seniorAmount} onChange={(v) => update((x) => { x.debt!.seniorAmount = v; })} />}
          <DateText label="기준일" value={w.debt.basisDate} onChange={(v) => update((x) => { x.debt!.basisDate = v; })} />
          <div><ModeBadge mode={w.debt.dataMode} /></div>
        </div>
      )}

      <h3>최초 사본과 작업본 비교 <span className="muted small">({diff.length}개 항목 변경)</span></h3>
      {!diff.length ? <p className="muted">변경 없음</p> : (
        <table className="tbl small" data-testid="diff-table"><thead><tr><th>항목</th><th>최초 사본</th><th>작업본</th></tr></thead>
          <tbody>{diff.slice(0, 60).map((d) => <tr key={d.path}><td><code>{d.path}</code></td><td>{d.before}</td><td>{d.after}</td></tr>)}</tbody></table>
      )}
    </Section>
  );
}

export function parseCoord(s: string): { lat: number; lng: number } | null {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(s);
  if (!m) return null;
  const lat = Number(m[1]), lng = Number(m[2]);
  return lat >= 33 && lat <= 39 && lng >= 124 && lng <= 132 ? { lat, lng } : null;
}

/** 좌표 입력. 위도·경도 둘 다 있을 때만 반영(임의 기본값을 만들지 않음). 직접 수정하면 협의체 확인 표시는 해제. */
export function CoordField({ value, onChange, label = "좌표(위도, 경도)" }: { value?: { lat: number; lng: number; senderVerified?: boolean }; onChange: (c: { lat: number; lng: number; senderVerified: boolean } | undefined) => void; label?: string }) {
  const shown = value ? `${value.lat}, ${value.lng}` : "";
  return (
    <label className="field">
      <span>{label}</span>
      <input key={shown} defaultValue={shown} placeholder="37.4120, 127.1260" onBlur={(e: any) => {
        const t = e.target.value.trim();
        if (t === "") return onChange(undefined);
        const c = parseCoord(t);
        if (c && (c.lat !== value?.lat || c.lng !== value?.lng)) onChange({ ...c, senderVerified: false });
      }} />
      <small className="muted">{value ? (value.senderVerified ? "협의체에서 확인한 좌표(새 앱 미검증)" : "확인 표시 없는 좌표") : "미입력 — 입력 후 칸을 벗어나면 반영"}</small>
    </label>
  );
}
