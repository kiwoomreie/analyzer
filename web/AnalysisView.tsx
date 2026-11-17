import { useEffect, useMemo, useRef, useState } from "react";
import { deleteTemp, getTemp, putTemp, type SessionInfo } from "./api.ts";
import { draftStore, localStore } from "./store.ts";
import { navigate, withRun } from "./nav.ts";
import { Badge, download } from "./components.tsx";
import { hashOf } from "../shared/hash.ts";
import { DATA_MODE_LABEL, newKey, ORIGIN_LABEL, titleFor, type AnalysisRecord, type WorkingInputs } from "../shared/model.ts";
import { makeBackup, scanWorking } from "../shared/importers.ts";
import { seoulNowIso, seoulToday } from "../shared/dates.ts";
import { fmtMan, fmtNum } from "../shared/units.ts";
import { InputSection } from "./sections/InputSection.tsx";
import { EventsSection } from "./sections/EventsSection.tsx";
import { MarketSection } from "./sections/MarketSection.tsx";
import { ReportSection } from "./sections/ReportSection.tsx";

export type StorageKind = "server-temporary" | "browser-local" | "draft";

export interface SectionProps {
  rec: AnalysisRecord;
  update: (fn: (w: WorkingInputs) => void) => void;
  setRec: (r: AnalysisRecord) => void;
  session: SessionInfo | null;
}

const STORAGE_LABEL: Record<StorageKind, string> = {
  "server-temporary": "서버 임시 분석(수신 대기 기능)",
  "browser-local": "이 브라우저에 저장됨",
  draft: "저장 전(이 탭에서만 유지)",
};

export function AnalysisView({ storage, recKey, session }: { storage: StorageKind; recKey: string; session: SessionInfo | null }) {
  const [rec, setRecState] = useState<AnalysisRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<string>("");
  const timer = useRef<any>(null);

  useEffect(() => {
    if (storage === "server-temporary") getTemp(recKey).then((r) => setRecState(r.record)).catch((e) => setError(e.message));
    else {
      const r = storage === "browser-local" ? localStore.get(recKey) : draftStore.get(recKey);
      r ? setRecState(r) : setError(storage === "draft" ? "저장 전 작업을 찾을 수 없음(탭을 닫으면 사라짐)" : "이 브라우저에 저장된 분석을 찾을 수 없음");
    }
  }, [storage, recKey]);

  const persist = (r: AnalysisRecord) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      if (storage === "server-temporary") {
        try { await putTemp(r); setSaveState("임시 분석에 반영됨"); } catch (e) { setSaveState(`반영 실패: ${(e as Error).message}`); }
        return;
      }
      const err = storage === "browser-local" ? localStore.put(r) : draftStore.put(r);
      setSaveState(err ?? (storage === "browser-local" ? `이 브라우저에 저장됨 ${new Date().toLocaleTimeString("ko-KR")}` : "아직 저장 전 — ‘이 브라우저에 저장’을 누르십시오"));
    }, 400);
  };
  const setRec = (r: AnalysisRecord) => { setRecState(r); persist(r); };
  const update = (fn: (w: WorkingInputs) => void) => {
    if (!rec) return;
    const w = structuredClone(rec.working);
    fn(w);
    const issues = scanWorking(w);
    if (issues.length) { setSaveState(`입력 거절: ${issues[0].path} — ${issues[0].message}`); return; }
    setRec({ ...rec, working: w, updatedAt: seoulNowIso(), title: titleFor(w) });
  };

  const lastRun = rec?.runs[rec.runs.length - 1];
  const stale = useMemo(() => (rec && lastRun ? hashOf(rec.working) !== lastRun.inputHash : false), [rec, lastRun]);

  if (error) return <main className="home"><div className="banner bad" data-testid="view-error">{error}</div><button onClick={() => navigate("/app")}>첫 화면으로</button></main>;
  if (!rec || !lastRun) return <main className="home"><p className="muted">불러오는 중…</p></main>;
  const r = lastRun.result;

  const saveToBrowser = () => {
    const local = { ...structuredClone(rec), key: newKey("lc"), updatedAt: seoulNowIso() };
    const err = localStore.put(local);
    if (err) return setSaveState(err);
    if (storage === "draft") draftStore.remove(rec.key);
    navigate(`/app/l/${local.key}`);
  };
  const remove = async () => {
    if (storage === "server-temporary") { try { await deleteTemp(rec.key); } catch (e) { return setSaveState((e as Error).message); } }
    else if (storage === "browser-local") localStore.remove(rec.key);
    else draftStore.remove(rec.key);
    navigate("/app");
  };
  const props: SectionProps = { rec, update, setRec, session };

  return (
    <main className="view">
      <div className="view-head">
        <div>
          <h1 data-testid="analysis-title">{rec.title}</h1>
          <div className="muted small">{rec.working.property.displayName ? rec.working.property.address : ""}</div>
          <div className="badges">
            <Badge tone={storage === "browser-local" ? "ok" : "warn"}>{STORAGE_LABEL[storage]}</Badge>
            <Badge tone="muted">{ORIGIN_LABEL[rec.origin.kind]}</Badge>
            {rec.origin.kind === "demo" && <Badge tone="bad">가상 자료 — 실제 판단에 사용 금지</Badge>}
          </div>
          <dl className="meta" data-testid="meta">
            <dt>분석 기준일</dt><dd data-testid="meta-asof">{rec.working.asOf}</dd>
            <dt>표시 단위</dt><dd>금액 만원(원 단위 계산) · 면적 전용㎡ · 1평=400/121㎡</dd>
            <dt>최근 분석</dt><dd data-testid="run-info">#{lastRun.runNo} · {lastRun.at}{stale && <b className="warn-text"> · 입력이 바뀌었습니다. ‘분석 다시 실행’을 누르십시오.</b>}</dd>
          </dl>
        </div>
        <div className="actions">
          <button onClick={() => setRec(withRun(rec, "manual"))} data-testid="rerun" className={stale ? "primary" : ""}>분석 다시 실행</button>
          {storage !== "browser-local" && <button onClick={saveToBrowser} data-testid="save-browser" className="primary">이 브라우저에 저장</button>}
          <button onClick={() => download(`apartment-analysis-${seoulToday()}.json`, JSON.stringify(makeBackup([rec], seoulNowIso()), null, 1), "application/json")} data-testid="export-json">JSON 내보내기</button>
          <button onClick={remove} className="danger" data-testid="delete">삭제</button>
          <small className="muted" data-testid="save-state">{saveState || (storage === "draft" ? "아직 저장 전" : "")}</small>
        </div>
      </div>

      {r.missing.length > 0 && (
        <div className="banner warn small" data-testid="missing">
          <b>추가하면 더 분석되는 항목</b> <span className="muted">(없어도 가능한 분석은 표시됨)</span>
          <ul>{r.missing.map((m) => <li key={m.field}>{m.label} — {m.affects}</li>)}</ul>
        </div>
      )}

      <div className="summary" data-testid="summary">
        <div className="card sblock" data-testid="summary-location">
          <h2>① 입지 변화</h2>
          {!r.summary.location.length ? <p className="muted">입력된 입지 사건 없음 — 아래 ‘입지 사건·근거 상세’에서 추가</p> : (
            <ul>{r.summary.location.map((l) => <li key={l.key}><b>{l.text}</b>{l.detail && <div className="muted small">{l.detail}</div>}</li>)}</ul>
          )}
        </div>
        <div className="card sblock" data-testid="summary-price">
          <h2>② 가격 영향과 근거</h2>
          <dl className="kv">
            <dt>검토가격 비교</dt><dd data-testid="price-compare">{r.price.status === "held" ? <><Badge tone="muted">보류</Badge> {r.price.text.replace(/^가격 판단 보류 — /, "")}</> : r.price.text}</dd>
            <dt>비교 근거</dt><dd>{r.summary.price.comparables}</dd>
            <dt>관찰된 변화</dt><dd>{r.summary.price.observed.replace(/^관찰된 변화: ?/, "")}</dd>
            <dt>선반영</dt><dd>{r.summary.price.prepricing}</dd>
            <dt>인과 추정 효과</dt><dd><Badge tone="muted">미추정</Badge></dd>
          </dl>
          <p className="muted small">{r.summary.price.basis}</p>
        </div>
        <div className="card sblock" data-testid="summary-uncertainty">
          <h2>③ 주요 불확실성</h2>
          {!r.summary.uncertainties.length ? <p className="muted">자료 범위 내 주요 항목 없음</p> : (
            <ul>{r.summary.uncertainties.map((f, i) => <li key={i}><Badge tone={f.level === "high" ? "bad" : "warn"}>{f.level === "high" ? "높음" : "중간"}</Badge> {f.text}</li>)}</ul>
          )}
        </div>
      </div>

      <div className="card" data-testid="comparables">
        <h2>대표 비교단지 <span className="muted small">최대 5개 · 비교하기 어려운 단지는 채우지 않음 · 최근 {r.market.recentWindow.months}개월({r.market.recentWindow.start}~{r.market.recentWindow.end}){r.market.areaFilter ? ` · 전용 ${fmtNum(r.market.areaFilter.minM2, 1)}~${fmtNum(r.market.areaFilter.maxM2, 1)}㎡` : " · 면적 필터 없음"}</span></h2>
        {!r.market.comparables.length ? <p className="muted" data-testid="no-comparables">비교 가능한 단지 없음{rec.working.transactions.length ? " — 제외 사유는 ‘실거래·비교단지 상세’에서 확인" : " — 실거래 자료 없음"}</p> : (
          <table className="tbl">
            <thead><tr><th>단지</th><th>준공연도(본건 대비)</th><th>거리</th><th>최근 거래</th><th>거래 전용면적</th><th>중위 단가(만원/전용㎡)</th><th>최근 계약</th><th>선정 이유</th><th>자료</th></tr></thead>
            <tbody>{r.market.comparables.map((c) => (
              <tr key={c.complexKey}>
                <td><b>{c.name}</b>{c.dong ? <div className="muted small">{c.dong}</div> : null}</td>
                <td>{c.buildYear ?? "미확인"}{c.differences.buildYearDiff !== null ? ` (${c.differences.buildYearDiff > 0 ? "+" : ""}${c.differences.buildYearDiff}년)` : ""}</td>
                <td>{c.distanceM === null ? <span className="warn-text">미확인</span> : `${Math.round(c.distanceM).toLocaleString("ko-KR")}m`}</td>
                <td>{c.recentTrades}건</td>
                <td>{c.recentAreaMin ? `${fmtNum(c.recentAreaMin, 2)}~${fmtNum(c.recentAreaMax, 2)}㎡` : "-"}</td>
                <td>{fmtMan(c.stats.medianPerM2).replace("만원", "")}</td>
                <td>{c.latestTrade ?? "-"}</td>
                <td className="small">{c.selectionReason}</td>
                <td className="small">{c.dataModes.map((m) => DATA_MODE_LABEL[m]).join("·")}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
        {r.price.reviewPerM2 !== null && <p className="small">본건 검토가격: {fmtMan(r.price.reviewPerM2)}/전용㎡ ({r.price.basisDate === "기준일 미입력" ? "가격 기준일 미입력" : `가격 기준일 ${r.price.basisDate}`})</p>}
      </div>

      <InputSection {...props} />
      <EventsSection {...props} />
      <MarketSection {...props} />
      <ReportSection {...props} />
    </main>
  );
}
