// 근거 열기와 복귀: 결과 카드의 [실거래-01]·[입지-01]·[관측-01] 버튼 → 오른쪽 상세 패널(모바일은 전체 화면)
// 닫으면 누른 버튼으로 포커스·스크롤 위치를 돌려놓는다. 내용은 그 실행본에 보존된 값만 사용한다.
import { useEffect, useRef } from "react";
import type { AnalysisResult } from "../shared/analysis.ts";
import type { RunRecord } from "../shared/model.ts";
import { findCitation, type Citation } from "../shared/citations.ts";
import { fmtMan, fmtNum } from "../shared/units.ts";

export interface CiteTarget { id: string; run: RunRecord; result: AnalysisResult; fallbackTitle: string }

export function CiteBtn({ id, onOpen, testId }: { id: string; onOpen: (opener: HTMLElement) => void; testId?: string }) {
  return <button type="button" className="cite" data-testid={testId ?? `cite-${id}`} data-cite={id} onClick={(e: any) => onOpen(e.currentTarget)}>[{id}]</button>;
}

export function EvidenceDrawer({ target, onClose }: { target: CiteTarget | null; onClose: () => void }) {
  const panel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!target) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    panel.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [target]);
  if (!target) return null;
  const c = findCitation(target.result, target.id);
  return (
    <div className="drawer-wrap" data-testid="evidence-drawer">
      <div className="drawer-scrim" onClick={onClose} />
      <div className="drawer" role="dialog" aria-modal="true" aria-label={`근거 ${target.id}`} tabIndex={-1} ref={panel}>
        <div className="drawer-head">
          <div>
            <p className="eyebrow-plum">근거 · 실행 #{target.run.runNo} 시점 기록</p>
            <h2>[{target.id}] {c?.title ?? target.fallbackTitle}</h2>
            {c && <p className="muted small">{c.summary}</p>}
          </div>
          <button className="close-btn" onClick={onClose} data-testid="evidence-close">읽던 곳으로 돌아가기 ←</button>
        </div>
        {!c ? (
          <div className="banner warn" data-testid="evidence-missing">당시 근거 상세 미보존 — 이 실행본(#{target.run.runNo}, {target.run.at.slice(0, 16).replace("T", " ")})은 근거 상세 보존 기능 이전에 만들어졌습니다. 현재 입력으로 다시 채우지 않습니다.</div>
        ) : <CitationBody c={c} />}
        <p className="small muted">이 내용은 실행 #{target.run.runNo}에 보존된 값입니다. 이후 거래·사건을 수정하거나 삭제해도 바뀌지 않습니다.</p>
      </div>
    </div>
  );
}

function CitationBody({ c }: { c: Citation }) {
  if (c.kind === "trade") return (
    <div data-testid="evidence-body">
      <dl className="kv small"><dt>거리</dt><dd>{c.distanceM === null ? "미확인" : `${Math.round(c.distanceM).toLocaleString("ko-KR")}m`}</dd><dt>준공연도</dt><dd>{c.buildYear ?? "미확인"}</dd><dt>중위 단가</dt><dd>{fmtMan(c.medianPerM2)}/전용㎡</dd><dt>사용 거래</dt><dd>{c.tradeTotal}건{c.tradeTotal > c.trades.length ? ` (최근 ${c.trades.length}건 보존)` : ""}</dd></dl>
      <div className="table-scroll"><table className="tbl small" data-testid="evidence-trades"><thead><tr><th>계약일</th><th>전용㎡</th><th>층</th><th>금액(만원)</th><th>㎡당(만원)</th><th>자료</th></tr></thead>
        <tbody>{c.trades.map((t, i) => <tr key={t.key} className={i === 0 ? "hl" : ""}><td>{t.contractDate}</td><td>{fmtNum(t.areaM2, 2)}</td><td>{t.floor ?? "-"}</td><td>{fmtMan(t.priceKrw, 0).replace("만원", "")}</td><td>{fmtMan(t.perM2Krw).replace("만원", "")}</td><td>{t.dataMode === "demo" ? "[가상]" : t.source ?? "-"}</td></tr>)}</tbody></table></div>
    </div>
  );
  if (c.kind === "event") return (
    <div data-testid="evidence-body">
      <p className="small">{c.categoryLabel} · {c.stageAsOf}{c.dataMode === "demo" ? " · [가상]" : ""}</p>
      <div className="table-scroll"><table className="tbl small"><thead><tr><th>구분</th><th>예정/실제</th><th>적용일</th><th>발표일</th><th>기준일 반영</th></tr></thead>
        <tbody>{c.timeline.map((t, i) => <tr key={i}><td>{t.type}</td><td>{t.status}</td><td>{t.date}</td><td>{t.announcedOn}</td><td>{t.knownAsOf ? "반영" : "제외(기준일 이후 정보)"}</td></tr>)}</tbody></table></div>
      <p className="small muted">{c.evidenceText}</p>
    </div>
  );
  return (
    <div data-testid="evidence-body">
      <p className="small">기준 {c.anchor || "미선택"} · 전후 {c.window || "미산출"}</p>
      <div className="table-scroll"><table className="tbl small"><thead><tr><th>그룹</th><th>단지</th><th>사용</th><th>전/후</th><th>이유</th></tr></thead>
        <tbody>{c.usage.map((u, i) => <tr key={i} className={u.used ? "" : "excluded"}><td>{u.group}</td><td>{u.label}</td><td>{u.used ? "사용" : "미사용"}</td><td>{u.pre}/{u.post}</td><td>{u.reason ?? "-"}</td></tr>)}</tbody></table></div>
    </div>
  );
}
