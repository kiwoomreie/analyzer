// 결과 단계 보조: 실행본 기준 관측 상세(월별·사용/제외), 보고서 단계: 실행 기록과 실행별 인용 근거
import type { AnalysisResult } from "../../shared/analysis.ts";
import type { AnalysisRecord, RunRecord } from "../../shared/model.ts";
import { fmtMan } from "../../shared/units.ts";
import { CiteBtn } from "../evidence.tsx";
import { eventCitationId, tradeCitationId, OBS_CITATION_ID } from "../../shared/citations.ts";

/** 실행본에 저장된 그룹 관측의 월별 표·사용/제외 이유(현재 작업본이 아니라 결과 기준) */
export function ObservationDetail({ r, onCite }: { r: AnalysisResult; onCite: (el: HTMLElement) => void }) {
  const g = r.groupObservation;
  if (!g) return null;
  return (
    <details className="section card-like" id="sec-obs-detail" data-testid="obs-detail">
      <summary><span className="sec-title">입지 사건 전후 관측 상세</span><span className="sec-sum muted">월별 표 · 사용/제외 단지와 이유 · 실행본 기준</span></summary>
      <div className="sec-body">
        <p className="small muted">기준 {g.anchorLabel} {g.anchor} · 전 [{g.start || "—"}, 기준일) / 후 [기준일, {g.end || "—"}) · 가격 기준 전용㎡당 거래가(원 단위 계산) · 면적 {g.basis.area ? `본건 ${g.basis.area.m2}㎡ ±${g.basis.area.bandPct}%` : "미입력"} · 같은 단지 × 전용 {g.basis.stratumM2}㎡ 구간에 전·후 양쪽 거래가 있는 표본 <CiteBtn id={OBS_CITATION_ID} onOpen={onCite} testId="cite-obs-detail" /></p>
        <div className="table-scroll"><table className="tbl small"><thead><tr><th>그룹</th><th>단지</th><th>사용</th><th>전/후 건수</th><th>면적구간</th><th>제외·미사용 이유</th></tr></thead>
          <tbody>{(g.usage ?? []).map((u) => <tr key={u.group + u.key} className={u.used ? "" : "excluded"}><td>{u.group === "impact" ? "영향권" : "비교군"}</td><td className="name-cell">{u.label}</td><td>{u.used ? "사용" : "미사용"}</td><td>{u.pre}/{u.post}</td><td>{u.strata}</td><td className="wide-cell">{[u.reason, ...Object.entries(u.excluded ?? {}).map(([k, n]) => `${k} ${n}건`)].filter(Boolean).join(" · ") || "-"}</td></tr>)}</tbody></table></div>
        <div className="table-scroll"><table className="tbl small"><thead><tr><th>월</th><th>영향권 중위/건수</th><th>비교군 중위/건수</th></tr></thead>
          <tbody>{g.monthly.map((m) => <tr key={m.month}><td>{m.month}</td><td>{fmtMan(m.impact)} / {m.impactN}건</td><td>{fmtMan(m.control)} / {m.controlN}건</td></tr>)}</tbody></table></div>
        <p className="small muted">경계 월은 일부 날짜만 포함 · 거래 없는 달은 0원이 아닌 미산출</p>
      </div>
    </details>
  );
}

/** 실행 기록: 실행별로 보존된 인용 근거를 다시 열 수 있음(과거 실행은 그 시점 값) */
export function RunHistory({ rec, onCite }: { rec: AnalysisRecord; onCite: (id: string, el: HTMLElement, run: RunRecord) => void }) {
  const runs = [...rec.runs].reverse();
  return (
    <div className="card" data-testid="run-history">
      <h3 className="card-title">실행 기록 <span className="muted small">각 실행의 결과·근거는 그 시점 값으로 보존</span></h3>
      <div className="table-scroll"><table className="tbl small"><thead><tr><th>실행</th><th>시각</th><th>방식</th><th>인용 근거</th></tr></thead>
        <tbody>{runs.map((run) => {
          const ids = run.result.citations ? run.result.citations.items.map((c) => c.id) : [...run.result.market.comparables.map((_, i) => tradeCitationId(i)), ...run.result.events.map((_, i) => eventCitationId(i))];
          return (
            <tr key={run.runNo} data-testid={`run-row-${run.runNo}`}>
              <td>#{run.runNo}</td><td>{run.at.slice(0, 16).replace("T", " ")}</td><td>{run.trigger === "manual" ? "직접 실행" : run.trigger === "auto-create" ? "시작 시 자동" : "자동 실행"}</td>
              <td className="wide-cell">{!run.result.citations && <span className="muted small">당시 근거 상세 미보존 · </span>}{ids.map((id) => <CiteBtn key={id} id={id} testId={`run-${run.runNo}-cite-${id}`} onOpen={(el) => onCite(id, el, run)} />)}</td>
            </tr>
          );
        })}</tbody></table></div>
    </div>
  );
}
