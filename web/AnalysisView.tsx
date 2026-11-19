import { useEffect, useMemo, useRef, useState } from "react";
import { deleteTemp, getTemp, putTemp, type SessionInfo } from "./api.ts";
import { draftStore, localStore, memoryDrafts } from "./store.ts";
import { latestRun, navigate, withRun } from "./nav.ts";
import { Badge, download, openSection, Rail } from "./components.tsx";
import { DATA_MODE_LABEL, migrateRecord, newKey, ORIGIN_LABEL, titleFor, type AnalysisRecord, type WorkingInputs } from "../shared/model.ts";
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
  /** 비동기 작업(조회·가져오기)이 끝난 시점의 최신 기록 — 오래된 사본으로 덮어쓰지 않기 위함 */
  getRec: () => AnalysisRecord | null;
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
  const [saveError, setSaveError] = useState<string | null>(null);
  const [memoryOnly, setMemoryOnly] = useState(false);
  const [railCur, setRailCur] = useState<string | undefined>();
  const timer = useRef<any>(null);
  /** 항상 최신 기록을 가리킴(비동기 응답이 오래된 화면 상태로 덮어쓰지 않도록) */
  const recRef = useRef<AnalysisRecord | null>(null);
  const load = (r: AnalysisRecord) => { recRef.current = r; setRecState(r); };

  useEffect(() => {
    if (storage === "server-temporary") getTemp(recKey).then((r) => load(migrateRecord(r.record))).catch((e) => setError(e.message));
    else {
      let r = storage === "browser-local" ? localStore.get(recKey) : draftStore.get(recKey);
      if (!r && storage === "draft" && memoryDrafts.has(recKey)) { r = memoryDrafts.get(recKey)!; setMemoryOnly(true); }
      r ? load(r) : setError(storage === "draft" ? "저장 전 작업을 찾을 수 없음(탭을 닫았거나 새로고침으로 사라짐)" : !localStore.available() ? "이 브라우저 저장소를 사용할 수 없어 저장된 분석을 열 수 없음" : "이 브라우저에 저장된 분석을 찾을 수 없음");
    }
  }, [storage, recKey]);

  /** 저장 대기 중인 기록(0.4초 묶음 저장). 새로고침·탭 닫기·화면 이동 시 즉시 저장해 마지막 수정이 사라지지 않게 함 */
  const pending = useRef<AnalysisRecord | null>(null);
  const memoryOnlyRef = useRef(memoryOnly);
  memoryOnlyRef.current = memoryOnly;
  const save = (r: AnalysisRecord) => {
    if (storage === "server-temporary") {
      putTemp(r).then(() => setSaveState("임시 분석에 반영됨")).catch((e) => setSaveState(`반영 실패: ${(e as Error).message}`));
      return;
    }
    if (storage === "draft" && memoryOnlyRef.current) { memoryDrafts.set(r.key, r); setSaveState("메모리에만 있음 — 새로고침하면 사라짐"); return; }
    const err = storage === "browser-local" ? localStore.put(r) : draftStore.put(r);
    if (err) {
      if (storage === "draft") { memoryDrafts.set(r.key, r); setMemoryOnly(true); }
      setSaveError(err);
      setSaveState("저장 실패");
      return;
    }
    setSaveError(null);
    setSaveState(storage === "browser-local" ? `이 브라우저에 저장됨 ${new Date().toLocaleTimeString("ko-KR")}` : "아직 저장 전 — ‘이 브라우저에 저장’을 누르십시오");
  };
  const flush = () => {
    clearTimeout(timer.current);
    const r = pending.current;
    pending.current = null;
    if (r) save(r);
  };
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    const onHide = () => flushRef.current();
    const onVis = () => { if (document.visibilityState === "hidden") flushRef.current(); };
    window.addEventListener("pagehide", onHide);
    window.addEventListener("beforeunload", onHide);
    document.addEventListener("visibilitychange", onVis);
    return () => { window.removeEventListener("pagehide", onHide); window.removeEventListener("beforeunload", onHide); document.removeEventListener("visibilitychange", onVis); flushRef.current(); };
  }, []);
  const persist = (r: AnalysisRecord) => {
    clearTimeout(timer.current);
    pending.current = r;
    timer.current = setTimeout(flush, 400);
  };
  const setRec = (r: AnalysisRecord) => { recRef.current = r; setRecState(r); persist(r); };
  /** 최신 기록(recRef)에 변경을 적용 — 응답 대기 중 사용자가 바꾼 값이 사라지지 않음 */
  const update = (fn: (w: WorkingInputs) => void) => {
    const cur = recRef.current;
    if (!cur) return;
    const w = structuredClone(cur.working);
    fn(w);
    const issues = scanWorking(w);
    if (issues.length) { setSaveState(`입력 거절: ${issues[0].path} — ${issues[0].message}`); return; }
    setRec({ ...cur, working: w, updatedAt: seoulNowIso(), title: titleFor(w) });
  };

  const lr = useMemo(() => (rec ? latestRun(rec) : null), [rec]);

  if (error) return <main className="home"><div className="banner bad" data-testid="view-error">{error}</div><button onClick={() => navigate("/app")}>첫 화면으로</button></main>;
  if (!rec || !lr?.run || !lr.result) return <main className="home"><p className="muted">불러오는 중…</p></main>;
  const lastRun = lr.run;
  const r = lr.result;
  const stale = lr.stale;

  /** 저장 대기분 취소(삭제·다른 저장소로 옮긴 뒤 화면을 떠날 때 옛 위치에 다시 쓰지 않도록) */
  const cancelPending = () => { clearTimeout(timer.current); pending.current = null; };
  const saveToBrowser = () => {
    const local = { ...structuredClone(recRef.current ?? rec), key: newKey("lc"), updatedAt: seoulNowIso() };
    const err = localStore.put(local);
    if (err) { setSaveError(err); setSaveState("저장 실패"); return; }
    cancelPending();
    if (storage === "draft") draftStore.remove(rec.key);
    navigate(`/app/l/${local.key}`);
  };
  const remove = async () => {
    cancelPending();
    if (storage === "server-temporary") { try { await deleteTemp(rec.key); } catch (e) { return setSaveState((e as Error).message); } }
    else if (storage === "browser-local") localStore.remove(rec.key);
    else draftStore.remove(rec.key);
    navigate("/app");
  };
  const props: SectionProps = { rec, getRec: () => recRef.current, update, setRec, session };

  const w0 = rec.working;
  const steps = [
    { id: "sec-input", label: "입력·세부 설정", done: !!w0.property.exclusiveAreaM2 },
    { id: "sec-events", label: "입지 사건·근거", done: w0.events.length > 0 },
    { id: "sec-market", label: "실거래·비교단지", done: w0.transactions.length > 0 },
    { id: "sec-report", label: "보고서", done: rec.runs.length > 0 && !stale },
  ];
  return (
    <div className="workspace">
    <Rail eyebrow="PRECISION. PERSPECTIVE. CONFIDENCE." title={<>근거를 놓고,<br />차분히 봅니다.</>}
      lead={<>요약 세 가지를 먼저 보고<br />필요한 단계만 펼쳐 확인합니다.</>}
      steps={steps} current={railCur} onStep={(id) => { setRailCur(id); openSection(id); }}
      foot={<>관찰된 변화는 인과효과가 아닙니다.<br />적정가격·예상 상승률을 산정하지 않습니다.</>} />
    <main className="view">
      <div className="hero" data-testid="hero">
        <div className="hero-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 20V6l7-3v17M11 20V9l9 3v8M4 20h17M7 9h1M7 12h1M7 15h1M14 14h1M17 14h1M14 17h1M17 17h1" fill="none" stroke="currentColor" strokeWidth="1.3" /></svg></div>
        <div className="hero-main">
          <div className="hero-eyebrow">검토 중인 분석 · {STORAGE_LABEL[storage]}</div>
          <h1 data-testid="analysis-title">{rec.title}</h1>
          <div className="hero-sub">{rec.working.property.displayName ? `${rec.working.property.address} · ` : ""}전용 {rec.working.property.exclusiveAreaM2 ? `${rec.working.property.exclusiveAreaM2}㎡` : "미입력"} · 기준일 {rec.working.asOf}</div>
        </div>
        <button className="hero-link" onClick={() => { setRailCur("sec-input"); openSection("sec-input"); }}>입력 수정</button>
      </div>
      <div className="view-head">
        <div>
          <div className="chips">
            <span className="chip">{ORIGIN_LABEL[rec.origin.kind]}</span>
            <span className="chip">{STORAGE_LABEL[storage]}</span>
            {rec.origin.kind === "demo" && <Badge tone="bad">가상 자료 — 실제 판단에 사용 금지</Badge>}
            {stale && <span className="chip chip-warn">재분석 필요 · 입력 변경</span>}
          </div>
          <dl className="meta" data-testid="meta">
            <dt>분석 기준일</dt><dd data-testid="meta-asof">{rec.working.asOf}</dd>
            <dt>표시 단위</dt><dd>금액 만원(원 단위 계산) · 면적 전용㎡ · 1평=400/121㎡</dd>
            <dt>최근 분석</dt><dd data-testid="run-info">#{lastRun.runNo} · {lastRun.at}{stale && <b className="warn-text"> · 입력이 바뀌었습니다. ‘분석 다시 실행’을 누르십시오.</b>}</dd>
          </dl>
        </div>
        <div className="actions">
          <button onClick={() => setRec(withRun(recRef.current ?? rec, "manual"))} data-testid="rerun" className={stale ? "primary" : ""}>분석 다시 실행</button>
          {storage !== "browser-local" && <button onClick={saveToBrowser} data-testid="save-browser" className="primary">이 브라우저에 저장</button>}
          <button onClick={() => download(`apartment-analysis-${seoulToday()}.json`, JSON.stringify(makeBackup([rec], seoulNowIso()), null, 1), "application/json")} data-testid="export-json">JSON 내보내기</button>
          <button onClick={remove} className="danger" data-testid="delete">삭제</button>
          <small className="muted" data-testid="save-state">{saveState || (storage === "draft" ? "아직 저장 전" : "")}</small>
        </div>
      </div>

      {saveError && <div className="banner bad" data-testid="save-error"><b>저장되지 않았습니다.</b> {saveError} <button onClick={() => download(`apartment-analysis-${seoulToday()}.json`, JSON.stringify(makeBackup([rec], seoulNowIso()), null, 1), "application/json")}>지금 JSON으로 내보내기</button></div>}
      {memoryOnly && <div className="banner warn small" data-testid="memory-only">탭 저장소를 쓸 수 없어 이 분석은 메모리에만 있습니다. 새로고침하거나 탭을 닫으면 사라지니 JSON으로 내보내십시오.</div>}
      {stale && <div className="banner bad" data-testid="stale-banner"><b>이전 결과 · 재분석 필요</b> — 아래 결과와 보고서는 #{lastRun.runNo} 실행({lastRun.at}) 당시 입력 기준입니다. 이후 입력이 바뀌었으니 ‘분석 다시 실행’을 누르십시오.</div>}
      {r.missing.length > 0 && (
        <div className="banner warn small" data-testid="missing">
          <b>추가하면 더 분석되는 항목</b> <span className="muted">(없어도 가능한 분석은 표시됨)</span>
          <ul>{r.missing.map((m) => <li key={m.field}>{m.label} — {m.affects}</li>)}</ul>
        </div>
      )}

      <div className="summary" data-testid="summary">
        <div className="card sblock" data-testid="summary-location">
          <p className="step-eyebrow">01</p><h2>입지 변화 {stale && <Badge tone="bad">이전 결과</Badge>}</h2>
          {!r.summary.location.length ? <p className="muted">입력된 입지 사건 없음 — 아래 ‘입지 사건·근거 상세’에서 추가</p> : (
            <ul>{r.summary.location.map((l) => <li key={l.key}><b>{l.text}</b>{l.detail && <div className="muted small">{l.detail}</div>}</li>)}</ul>
          )}
        </div>
        <div className="card sblock" data-testid="summary-price">
          <p className="step-eyebrow">02</p><h2>가격 영향과 근거 {stale && <Badge tone="bad">이전 결과</Badge>}</h2>
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
          <p className="step-eyebrow">03</p><h2>주요 불확실성 {stale && <Badge tone="bad">이전 결과</Badge>}</h2>
          {!r.summary.uncertainties.length ? <p className="muted">자료 범위 내 주요 항목 없음</p> : (
            <ul>{r.summary.uncertainties.map((f, i) => <li key={i}><Badge tone={f.level === "high" ? "bad" : "warn"}>{f.level === "high" ? "높음" : "중간"}</Badge> {f.text}</li>)}</ul>
          )}
        </div>
      </div>

      <div className="card" data-testid="comparables">
        <h2>대표 비교단지 {stale && <Badge tone="bad">이전 결과</Badge>} <span className="muted small">최대 5개 · 비교하기 어려운 단지는 채우지 않음 · 최근 {r.market.recentWindow.months}개월({r.market.recentWindow.start}~{r.market.recentWindow.end}){r.market.areaFilter ? ` · 전용 ${fmtNum(r.market.areaFilter.minM2, 1)}~${fmtNum(r.market.areaFilter.maxM2, 1)}㎡` : " · 면적 필터 없음"}</span></h2>
        {!r.market.comparables.length ? <p className="muted" data-testid="no-comparables">반경 내 거리가 확인된 비교 가능 단지 없음{lr.input.transactions.length ? " — 제외·확인 필요 사유는 ‘실거래·비교단지 상세’에서 확인" : " — 실거래 자료 없음"}</p> : (
          <table className="tbl">
            <thead><tr><th>단지</th><th>준공연도(본건 대비)</th><th>거리</th><th>최근 거래</th><th>거래 전용면적</th><th>중위 단가(만원/전용㎡)</th><th>최근 계약</th><th>선정 이유</th><th>자료</th></tr></thead>
            <tbody>{r.market.comparables.map((c) => (
              <tr key={c.complexKey}>
                <td className="name-cell"><b>{c.name}</b>{c.dong ? <div className="muted small">{c.dong}</div> : null}</td>
                <td>{c.buildYear ?? "미확인"}{c.differences.buildYearDiff !== null ? ` (${c.differences.buildYearDiff > 0 ? "+" : ""}${c.differences.buildYearDiff}년)` : ""}</td>
                <td>{`${Math.round(c.distanceM!).toLocaleString("ko-KR")}m`}</td>
                <td>{c.recentTrades}건</td>
                <td>{c.recentAreaMin ? `${fmtNum(c.recentAreaMin, 2)}~${fmtNum(c.recentAreaMax, 2)}㎡` : "-"}</td>
                <td>{fmtMan(c.stats.medianPerM2).replace("만원", "")}</td>
                <td>{c.latestTrade ?? "-"}</td>
                <td className="small wide-cell">{c.selectionReason}</td>
                <td className="small">{c.dataModes.map((m) => DATA_MODE_LABEL[m]).join("·")}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
        {r.market.needsCheck.length > 0 && <p className="small warn-text" data-testid="needs-check">거리 미확인 확인 필요 후보 {r.market.needsCheck.length}곳(대표 통계 제외): {r.market.needsCheck.slice(0, 8).map((c) => c.name).join(", ")}{r.market.needsCheck.length > 8 ? " 외" : ""}</p>}
        {r.collection && <p className="small muted">{r.collection.text}</p>}
        {r.price.reviewPerM2 !== null && <p className="small">본건 검토가격: {fmtMan(r.price.reviewPerM2)}/전용㎡ ({r.price.basisDate === "기준일 미입력" ? "가격 기준일 미입력" : `가격 기준일 ${r.price.basisDate}`})</p>}
      </div>

      <InputSection {...props} />
      <EventsSection {...props} />
      <MarketSection {...props} />
      <ReportSection {...props} />
    </main>
    </div>
  );
}
