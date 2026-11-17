import { Badge, DateText, ModeBadge, Num, Section, Select, Text } from "../components.tsx";
import type { SectionProps } from "../AnalysisView.tsx";
import { newKey, SUPPLY_STAGE_LABEL, type SupplyStage } from "../../shared/model.ts";

const yn = (v: "yes" | "no" | "unknown") => (v === "yes" ? <Badge tone="warn">겹침</Badge> : v === "no" ? <span className="muted">아님</span> : <span className="muted">판단 불가</span>);

export function SupplySection({ rec, update }: SectionProps) {
  const w = rec.working;
  const r = rec.runs[rec.runs.length - 1].result;
  const supplies = w.events.map((e, i) => ({ e, i })).filter(({ e }) => e.category === "supply");
  return (
    <Section id="sec-supply" title="④ 경쟁 공급" summary={r.supply.text}>
      <div className="form grid">
        <Text label="본건 수요층(쉼표로 구분)" value={(w.property.targetDemand ?? []).join(", ")} onChange={(v) => update((x) => { x.property.targetDemand = v ? v.split(",").map((s) => s.trim()).filter(Boolean) : []; })} wide />
      </div>
      <p className="muted small">계획·인허가·착공·분양·입주를 구분합니다. 시기는 본건 분양 12개월 전부터 예상 처분(없으면 만기)까지와 겹치는지 봅니다. 공개 거래량을 분양률·매각 소요기간으로 바꾸지 않습니다.</p>
      <table className="tbl small" data-testid="supply-table">
        <thead><tr><th>공급</th><th>단계</th><th>세대</th><th>면적(㎡)</th><th>㎡당 가격대(원)</th><th>분양 / 입주</th><th>수요층</th><th>시기</th><th>면적</th><th>가격대</th><th>수요층</th><th /></tr></thead>
        <tbody>
          {supplies.map(({ e, i }) => {
            const s = e.supply ?? { stage: "plan" as SupplyStage };
            const res = r.supply.rows.find((x) => x.key === e.key);
            const set = (fn: (s: NonNullable<typeof e.supply>) => void) => update((x) => { x.events[i].supply = x.events[i].supply ?? { stage: "plan" }; fn(x.events[i].supply!); });
            return (
              <tr key={e.key}>
                <td><Text label="" value={e.name} onChange={(v) => update((x) => { x.events[i].name = v ?? ""; })} /> <ModeBadge mode={e.dataMode} /></td>
                <td><Select label="" value={s.stage} options={Object.entries(SUPPLY_STAGE_LABEL) as [SupplyStage, string][]} onChange={(v) => set((t) => { t.stage = v; })} /></td>
                <td><Num label="" value={s.households} integer onChange={(v) => set((t) => { t.households = v; })} /></td>
                <td><Num label="" value={s.areaMinM2} onChange={(v) => set((t) => { t.areaMinM2 = v; })} /><Num label="" value={s.areaMaxM2} onChange={(v) => set((t) => { t.areaMaxM2 = v; })} /></td>
                <td><Num label="" value={s.priceMinPerM2Krw} onChange={(v) => set((t) => { t.priceMinPerM2Krw = v; })} /><Num label="" value={s.priceMaxPerM2Krw} onChange={(v) => set((t) => { t.priceMaxPerM2Krw = v; })} /></td>
                <td><DateText label="" value={s.saleDate} onChange={(v) => set((t) => { t.saleDate = v; })} /><DateText label="" value={s.occupancyDate} onChange={(v) => set((t) => { t.occupancyDate = v; })} /></td>
                <td><Text label="" value={(s.demandGroups ?? []).join(", ")} onChange={(v) => set((t) => { t.demandGroups = v ? v.split(",").map((z) => z.trim()).filter(Boolean) : []; })} /></td>
                {res ? <><td>{yn(res.timing)}</td><td>{yn(res.area)}</td><td>{yn(res.price)}</td><td>{yn(res.demand)}</td></> : <td colSpan={4} className="muted">재실행 필요</td>}
                <td><button className="link" onClick={() => update((x) => { x.events.splice(i, 1); })}>삭제</button></td>
              </tr>
            );
          })}
          {!supplies.length && <tr><td colSpan={12} className="muted">경쟁 공급 없음</td></tr>}
        </tbody>
      </table>
      <button onClick={() => update((x) => { x.events.push({ key: newKey("ev"), category: "supply", name: "새 경쟁 공급", direction: "adverse", milestones: [], evidenceKeys: [], dataMode: "user", supply: { stage: "plan" } }); })}>경쟁 공급 추가</button>
      {r.supply.rows.some((s) => s.notes.length) && (
        <ul className="small muted">{r.supply.rows.filter((s) => s.notes.length).map((s) => <li key={s.key}>{s.name}: {s.notes.join(", ")}</li>)}</ul>
      )}
    </Section>
  );
}
