import { Badge, Check, Section, Select, Text } from "../components.tsx";
import type { SectionProps } from "../AnalysisView.tsx";
import { LABELS, type PriceKind } from "../../shared/contract.ts";
import { formatDateValue } from "../../shared/dates.ts";
import { fmtEok, fmtPct } from "../../shared/units.ts";

export function CalcSection({ rec, update }: SectionProps) {
  const w = rec.working;
  const r = rec.runs[rec.runs.length - 1].result;
  const l = r.ltv;
  return (
    <Section id="sec-calc" title="⑤ 가격 변화에 따른 참고계산" summary="선반영 검토 · 사용자 스트레스 가정 · 일정 비교 · LTV 참고값(판정 없음)">
      <h4>선반영 검토</h4>
      <Text label="평가서의 해당 기대 반영 설명(직접 읽은 내용)" value={w.appraisalNote} onChange={(v) => update((x) => { x.appraisalNote = v; })} wide />
      <table className="tbl small" data-testid="prepricing">
        <thead><tr><th>사건</th><th>발표</th><th>평가 기준일</th><th>발표 후 계약 비중</th><th>검토</th><th>정량</th></tr></thead>
        <tbody>
          {r.events.filter((e) => e.prepricing).map((e) => (
            <tr key={e.key}>
              <td>{e.name}</td><td>{e.prepricing!.announcement}</td><td>{e.prepricing!.appraisalBasisDate}</td>
              <td>{e.prepricing!.compsAfterAnnouncementShare === null ? "미산출" : fmtPct(e.prepricing!.compsAfterAnnouncementShare * 100, 0)}</td>
              <td>{e.prepricing!.assessment === "possible" ? <Badge tone="warn">반영 가능성 있음</Badge> : e.prepricing!.assessment === "unclear" ? "판단 근거 부족" : "검토 불가"}</td>
              <td><Badge tone="muted">{e.prepricing!.quantification}</Badge></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">발표 후 거래라는 사실만으로 기대가 전부 반영됐다고 보지 않으며, 과거 상대가격 차이를 현재 평가액에 자동 가산하지 않습니다.</p>

      <h4>입지 일정과 본건 일정</h4>
      <table className="tbl small" data-testid="schedule-table">
        <thead><tr><th>사건</th><th>개통·개장</th><th>분양 대비</th><th>준공 대비</th><th>만기 대비</th><th>지연 가정</th></tr></thead>
        <tbody>
          {r.events.filter((e) => e.category !== "supply").map((e) => {
            const g = (k: string) => e.scheduleGaps.find((x) => x.against === k)?.text ?? "-";
            return (
              <tr key={e.key}>
                <td>{e.name}</td><td>{formatDateValue(e.expectedOpening)}</td><td>{g("saleStart")}</td><td>{g("completion")}</td>
                <td data-testid={`gap-maturity-${e.key}`}>{g("maturity")}</td>
                <td>{e.delayedScenario ? `+${e.delayedScenario.delayMonths}개월 → ${formatDateValue(e.delayedScenario.opening)}${e.delayedScenario.gapToMaturity !== null ? ` (만기보다 ${e.delayedScenario.gapToMaturity}개월 ${e.delayedScenario.gapToMaturity >= 0 ? "뒤" : "앞"})` : ""}` : "-"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted small">만기 후 개통이라도 현재 가격 영향을 0으로 단정하지 않습니다. 현재 기대의 반영과 실제 이용 편익의 발생 시점을 구분합니다.</p>

      <h4>사용자 스트레스 가정 <span className="muted small">(① 시나리오에서 수정 · 전망 아님)</span></h4>
      <ul className="small">
        <li>가격 하락률: {r.stress.priceDeclinePct === null ? "미입력" : `${r.stress.priceDeclinePct}%`}{r.stress.stressedValueKrw !== null && ` → 사업 전체 ${LABELS.priceKind[w.ltvChecks.valueKind]} ${fmtEok(r.stress.stressedValueKrw)}`}</li>
        <li>처분 일정: {r.stress.disposal ? `${r.stress.disposal.base}${r.stress.disposal.delayed ? ` → 지연 ${r.stress.disposal.delayMonths}개월 ${r.stress.disposal.delayed}` : ""} · ${r.stress.disposal.text}` : "예상 처분일 미입력"}</li>
      </ul>

      <h4>LTV 참고계산 <span className="muted small">가정 비교용 산술 · 판정하지 않음</span></h4>
      <div className="form grid">
        <Select label="분모(사업 전체 기준 가격)" value={w.ltvChecks.valueKind} options={Object.entries(LABELS.priceKind) as [PriceKind, string][]} onChange={(v) => update((x) => { x.ltvChecks.valueKind = v; })} />
        <Check label="가격과 채권의 담보 범위가 같음을 확인" checked={w.ltvChecks.collateralScopeConfirmed} onChange={(v) => update((x) => { x.ltvChecks.collateralScopeConfirmed = v; })} testId="ltv-scope" />
        <Check label="가격·채권 기준일 차이를 확인(같으면 불필요)" checked={w.ltvChecks.basisDateConfirmed} onChange={(v) => update((x) => { x.ltvChecks.basisDateConfirmed = v; })} />
      </div>
      {l.status === "notComputable" ? (
        <div className="banner muted small" data-testid="ltv-na">미산출: {l.reasons.join(" · ")}{l.seniorText ? ` · ${l.seniorText}` : ""}</div>
      ) : (
        <>
          <div className="small">분자: {l.definition} {fmtEok(l.numeratorOwnKrw)} (기준일 {l.debtBasisDate ?? "미입력"}) · {l.seniorText} · 분모: {l.valueLabel} (기준일 {l.valueBasisDate ?? "미입력"})</div>
          <table className="tbl small" data-testid="ltv-table">
            <thead><tr><th>가정</th><th>가치</th><th>본건 채권 기준</th><th>통합 담보부담</th></tr></thead>
            <tbody>{l.rows.map((row) => <tr key={row.label}><td>{row.label}</td><td>{fmtEok(row.valueKrw)}</td><td>{fmtPct(row.ownLtvPct)}</td><td>{row.combinedLtvPct === null ? "미산출(선순위 미확인)" : fmtPct(row.combinedLtvPct)}</td></tr>)}</tbody>
          </table>
        </>
      )}
      <p className="muted small">{l.note || "회수 가능·불가, 승인·보류·거절, 본PF 전환·상환가능성을 판정하지 않습니다."} CF·인출·이자·상환·워터폴은 이 앱의 범위가 아닙니다.</p>
    </Section>
  );
}
