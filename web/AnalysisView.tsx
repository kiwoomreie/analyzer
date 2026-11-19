import { useEffect, useMemo, useRef, useState } from "react";
import { deleteTemp, getTemp, putTemp, type SessionInfo } from "./api.ts";
import { draftStore, localStore, memoryDrafts } from "./store.ts";
import { latestRun, navigate, withRun } from "./nav.ts";
import { Badge, download } from "./components.tsx";
import { CiteBtn, EvidenceDrawer, type CiteTarget } from "./evidence.tsx";
import { ObservationPanel } from "./sections/ObservationPanel.tsx";
import { ObservationDetail, RunHistory } from "./sections/ResultExtras.tsx";
import { citationIdForComplex, citationIdForEvent, OBS_CITATION_ID } from "../shared/citations.ts";
import { LABELS } from "../shared/contract.ts";
import { currentPriceView, observationView } from "../shared/priceView.ts";
import { DATA_MODE_LABEL, migrateRecord, newKey, ORIGIN_LABEL, titleFor, type AnalysisRecord, type WorkingInputs } from "../shared/model.ts";
import { makeBackup, scanWorking } from "../shared/importers.ts";
import { seoulNowIso, seoulToday } from "../shared/dates.ts";
import { fmtMan, fmtNum } from "../shared/units.ts";
import { InputSection } from "./sections/InputSection.tsx";
import { EventsSection } from "./sections/EventsSection.tsx";
import { MarketSection } from "./sections/MarketSection.tsx";
import { ReportSection } from "./sections/ReportSection.tsx";

export type StorageKind = "server-temporary" | "browser-local" | "draft";

/** 사용자가 ‘동작 줄이기’를 켰는지 */
export const reduceMotion = () => { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };

export interface SectionProps {
  rec: AnalysisRecord;
  /** 비동기 작업(조회·가져오기)이 끝난 시점의 최신 기록 — 오래된 사본으로 덮어쓰지 않기 위함 */
  getRec: () => AnalysisRecord | null;
  update: (fn: (w: WorkingInputs) => void) => void;
  setRec: (r: AnalysisRecord) => void;
  session: SessionInfo | null;
  /** 단계 화면에서 처음부터 펼쳐 둘지 */
  defaultOpen?: boolean;
  /** 실거래 영역 중 자료 입력(①) 또는 결과 상세(③) */
  part?: "data" | "results";
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
  const [step, setStep] = useState<number>(() => { try { return Number(sessionStorage.getItem(`la.step.${recKey}`)) || 1; } catch { return 1; } });
  const [cite, setCite] = useState<CiteTarget | null>(null);
  // 브라우저 ‘뒤로/앞으로’로 단계 이동(같은 분석 안에서만). 현재 단계를 첫 기록에 남겨 둠
  useEffect(() => {
    try { if (history.state?.laKey !== recKey) history.replaceState({ ...(history.state ?? {}), laStep: step, laKey: recKey }, "", location.href); } catch { /* 무시 */ }
    const on = (e: PopStateEvent) => {
      const st = e.state?.laStep;
      if (e.state?.laKey === recKey && typeof st === "number" && st >= 1 && st <= 4) { setStep(st); try { sessionStorage.setItem(`la.step.${recKey}`, String(st)); } catch { /* 무시 */ } }
    };
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, [recKey]);
  const returnTo = useRef<{ el: HTMLElement; y: number } | null>(null);
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
  const pv = currentPriceView(lr.input, r);
  const ov = observationView(r.groupObservation);
  const stale = lr.stale;

  /** 저장 대기분 취소(삭제·다른 저장소로 옮긴 뒤 화면을 떠날 때 옛 위치에 다시 쓰지 않도록) */
  const cancelPending = () => { clearTimeout(timer.current); pending.current = null; };
  const saveToBrowser = () => {
    const local = { ...structuredClone(recRef.current ?? rec), key: newKey("lc"), updatedAt: seoulNowIso() };
    const err = localStore.put(local);
    if (err) { setSaveError(err); setSaveState("저장 실패"); return; }
    cancelPending();
    if (storage === "draft") draftStore.remove(rec.key);
    try { sessionStorage.setItem(`la.step.${local.key}`, String(step)); } catch { /* 무시 */ }
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
  const rp = w0.reviewPrice;
  const runNow = () => setRec(withRun(recRef.current ?? rec, "manual"));
  const goStep = (n: number, fromHistory = false) => {
    if (n === step) return;
    // 브라우저 ‘뒤로 가기’로 이전 단계에 돌아오도록 단계마다 기록(같은 주소, 상태만 다름). 입력은 기록(rec)에 있어 그대로 남음
    if (!fromHistory) try { history.pushState({ ...(history.state ?? {}), laStep: n, laKey: recKey }, "", location.href); } catch { /* 무시 */ }
    setStep(n); try { sessionStorage.setItem(`la.step.${recKey}`, String(n)); } catch { /* 무시 */ } requestAnimationFrame(() => { const bar = document.getElementById("step-top"); if (bar && bar.getBoundingClientRect().top < 0) window.scrollTo({ top: 0, behavior: reduceMotion() ? "auto" : "smooth" }); }); };
  const openCite = (id: string, opener: HTMLElement, run = lastRun, result = r, fallbackTitle = id) => { returnTo.current = { el: opener, y: window.scrollY }; setCite({ id, run, result, fallbackTitle }); };
  const closeCite = () => { setCite(null); const t = returnTo.current; requestAnimationFrame(() => { if (t) { window.scrollTo({ top: t.y, behavior: "auto" }); t.el.focus({ preventScroll: true }); t.el.classList.add("cite-back"); setTimeout(() => t.el.classList.remove("cite-back"), 1200); } }); };
  const citeFor = (id: string | null, title: string) => id ? <CiteBtn id={id} onOpen={(el) => openCite(id, el, lastRun, r, title)} /> : null;
  const STEPS = [
    { n: 1, label: "대상·자료", eyebrow: "01 / DATA", title: "대상과 자료를 정리합니다", sub: "주소 하나로 시작합니다. 전용면적·검토가격·일정은 선택 입력이며, 없으면 그 값이 필요한 비교만 보류합니다.", done: w0.transactions.length > 0 },
    { n: 2, label: "입지·비교 조건", eyebrow: "02 / CONDITIONS", title: "입지 사건과 비교 조건을 고릅니다", sub: "사건과 실제 기준일, 전후 기간, 영향권·비교군을 직접 확인해 선택합니다. 자동 반경 선정은 하지 않습니다.", done: !!w0.observation?.impact?.length },
    { n: 3, label: "분석 결과", eyebrow: "03 / RESULT", title: "결과와 근거를 함께 봅니다", sub: "요약 세 가지를 먼저 보고, [실거래]·[입지] 근거를 열어 확인한 뒤 읽던 곳으로 돌아옵니다.", done: !stale },
    { n: 4, label: "보고서·저장", eyebrow: "04 / REPORT", title: "실행본을 저장하고 보고서로 남깁니다", sub: "분석 실행 시점의 입력·근거·결과를 함께 남기며, 이후 입력 변경이 지난 결과를 덮어쓰지 않습니다.", done: storage === "browser-local" },
  ];
  const cur = STEPS[step - 1];
  const fact = (label: string, v: string | null | undefined, testId?: string) => <span className="fact"><span className="fact-l">{label}</span> <b data-testid={testId} className={v ? "" : "miss"}>{v || "미입력"}</b></span>;

  return (
    <div className="view-wrap">
      <section className="deal-head" data-testid="hero">
        <div className="deal-inner">
          <div className="deal-main">
            <h1 data-testid="analysis-title">{rec.title}</h1>
            <div className="deal-facts" data-testid="meta">
              {fact("주소", w0.property.address)}
              {fact("사업지명", w0.property.displayName)}
              {fact("전용면적", w0.property.exclusiveAreaM2 ? `${w0.property.exclusiveAreaM2}㎡` : null)}
              {fact("검토가격", rp ? `${rp.amount.toLocaleString("ko-KR")}${LABELS.moneyUnit[rp.unit]}(${LABELS.priceBasis[rp.basis]})` : null)}
              {fact("분석 기준일", w0.asOf, "meta-asof")}
            </div>
          </div>
          <div className="deal-side">
            <div className="deal-run" data-testid="run-info">실행 #{lastRun.runNo} · {lastRun.at.slice(0, 16).replace("T", " ")}{stale ? <b className="stale-tag"> · 이전 결과 · 재분석 필요</b> : <span> · 현재 입력 기준</span>}</div>
            <div className="deal-actions">
              <button onClick={runNow} data-testid="rerun" className={stale ? "plum" : "ghost-dark"}>분석 다시 실행</button>
              {storage !== "browser-local" && <button onClick={saveToBrowser} data-testid="save-browser" className="ghost-dark">이 브라우저에 저장</button>}
              <span className="chip-dark">{STORAGE_LABEL[storage]}</span>
            </div>
            <small className="deal-save" data-testid="save-state">{saveState || (storage === "draft" ? "아직 저장 전" : "")}</small>
          </div>
        </div>
      </section>

      <main className="view stepped">
        <nav className="stepbar" aria-label="분석 단계" id="step-top">
          {STEPS.map((s) => (
            <button key={s.n} className={`stepbar-item${s.n === step ? " on" : ""}${s.done ? " done" : ""}`} aria-current={s.n === step ? "step" : undefined} onClick={() => goStep(s.n)} data-testid={`step-${s.n}`}>
              <span className="sb-no">{String(s.n).padStart(2, "0")}</span><span className="sb-label">{s.label}</span>{s.n < 4 && <span className="sb-chev" aria-hidden="true">›</span>}
            </button>
          ))}
        </nav>
        <header className="step-head">
          <p className="eyebrow-plum">{cur.eyebrow}</p>
          <h2 className="step-title">{cur.title}</h2>
          <p className="step-sub">{cur.sub}</p>
        </header>

        {saveError && <div className="banner bad" data-testid="save-error"><b>저장되지 않았습니다.</b> {saveError} <button onClick={() => download(`apartment-analysis-${seoulToday()}.json`, JSON.stringify(makeBackup([rec], seoulNowIso()), null, 1), "application/json")}>지금 JSON으로 내보내기</button></div>}
        {memoryOnly && <div className="banner warn small" data-testid="memory-only">탭 저장소를 쓸 수 없어 이 분석은 메모리에만 있습니다. 새로고침하거나 탭을 닫으면 사라지니 JSON으로 내보내십시오.</div>}
        {stale && <div className="banner bad" data-testid="stale-banner"><b>이전 결과 · 재분석 필요</b> — 아래 결과와 보고서는 #{lastRun.runNo} 실행({lastRun.at}) 당시 입력 기준입니다. 이후 입력이 바뀌었으니 ‘분석 다시 실행’을 누르십시오.</div>}
        {r.missing.length > 0 && (
        <div className="banner warn small" data-testid="missing">
          <b>추가하면 더 분석되는 항목</b> <span className="muted">(없어도 가능한 분석은 표시됨)</span>
          <ul>{r.missing.map((m) => <li key={m.field}>{m.label} — {m.affects}</li>)}</ul>
        </div>
      )}


        <div className="step-panel" data-step="1" hidden={step !== 1}>
          <div className="chips">
            <span className="chip">{ORIGIN_LABEL[rec.origin.kind]}</span>
            {rec.origin.kind === "demo" && <Badge tone="bad">가상 자료 — 실제 판단에 사용 금지</Badge>}
            <span className="chip">금액 만원(원 단위 계산) · 면적 전용㎡ · 1평=400/121㎡</span>
          </div>
          <InputSection {...props} defaultOpen />
          <MarketSection {...props} part="data" />
        </div>

        <div className="step-panel" data-step="2" hidden={step !== 2}>
          <EventsSection {...props} defaultOpen />
          <div className="card"><ObservationPanel rec={rec} update={update} /></div>
        </div>

        <div className="step-panel" data-step="3" hidden={step !== 3}>
      <div className="summary" data-testid="summary">
        <div className="card sblock" data-testid="summary-location">
          <p className="step-eyebrow">01</p><h2>입지 변화 {stale && <Badge tone="bad">이전 결과</Badge>}</h2>
          {!r.summary.location.length ? <p className="muted">입력된 입지 사건 없음 — 아래 ‘입지 사건·근거 상세’에서 추가</p> : (
            <ul>{r.summary.location.map((l) => <li key={l.key}><b>{l.text}</b> {l.key === "supply" ? r.events.filter((e) => e.category === "supply").map((e) => <span key={e.key}>{citeFor(citationIdForEvent(r, e.key), e.name)} </span>) : citeFor(citationIdForEvent(r, l.key), l.text)}{l.detail && <div className="muted small">{l.detail}</div>}</li>)}</ul>
          )}
        </div>
        <div className="card sblock" data-testid="summary-price">
          <p className="step-eyebrow">02</p><h2>가격 영향과 근거 {stale && <Badge tone="bad">이전 결과</Badge>}</h2>
          <h3 className="sub-h">현재 검토가격 비교</h3>
          <dl className="kv" data-testid="price-current">
            <dt>검토가격</dt><dd>{lr.input.reviewPrice ? <>{pv.review.status === "held" && <Badge tone="muted">보류</Badge>} 세대당 총액 {pv.review.household} · {pv.review.perPyeong}<div className="muted small">{pv.review.perM2} · {pv.review.label} · 기준일 {pv.review.basisDate}{pv.review.note ? ` — ${pv.review.note}` : ""}</div></> : <><Badge tone="muted">미입력</Badge> <span className="small">검토가격이 없어 가격 비교만 보류</span></>}</dd>
            <dt>인근 유사 거래</dt><dd>{pv.market.complexes ? <>대표 비교단지 {pv.market.complexes}곳(최대 5곳, 부족해도 채우지 않음) · {pv.market.count}건 중위 {pv.market.perPyeong} <span className="cites">{r.market.comparables.map((c) => <span key={c.complexKey}>{citeFor(citationIdForComplex(r, c.complexKey), c.name)}</span>)}</span><div className="muted small">{pv.market.perM2} · 세대당 환산 {pv.market.householdEquiv} · 단지별 중위 범위 {pv.market.range} · {pv.market.window} · {pv.market.area}</div></> : <span className="small">조건에 맞는 대표 비교단지 없음 — 거리 확인·거래 수·면적·준공연도 기준을 충족한 단지가 없어 채우지 않음 <span className="muted">({pv.market.window} · {pv.market.area})</span></span>}</dd>
            <dt>검토가격 비교</dt><dd data-testid="price-compare">{r.price.status === "held" ? <><Badge tone="muted">보류</Badge> {r.price.text.replace(/^가격 판단 보류 — /, "")}</> : r.price.text}</dd>
          </dl>
          <p className="muted small">{pv.disclaimer}</p>
          <h3 className="sub-h">입지 사건 전후 관측 {ov.demo && <Badge tone="bad">가상 자료</Badge>}</h3>
          <div data-testid="obs-summary">
            {!ov.configured ? (
              <p className="small">영향권·비교군 미설정 — ‘실거래·비교단지 상세’에서 사건·실제 기준일·전후 기간·단지를 선택하고 분석을 다시 실행하십시오.<span className="muted"> 참고(대표 비교단지 발표 전후 단일값): {r.summary.price.observed.replace(/^관찰된 변화: ?/, "")}</span></p>
            ) : (
              <>
                <p className="small muted">{ov.headline} {citeFor(OBS_CITATION_ID, "수동 확인 그룹 관측")}</p>
                <ul className="obs-lines"><li>{ov.impact}</li><li>{ov.control}</li></ul>
                {ov.difference ? <p className="obs-diff" data-testid="obs-diff"><b>{ov.difference}</b> <span className="muted small">(인과효과 아님 · 관측된 차이)</span></p>
                  : <p className="small warn-text" data-testid="obs-diff-hidden">유효한 비교가 아니어서 비교군 대비 차이를 표시하지 않습니다.</p>}
                {ov.flags.length > 0 && <ul className="obs-flags small" data-testid="obs-flags">{ov.flags.map((f, i) => <li key={i}>{f}</li>)}</ul>}
              </>
            )}
          </div>
          <dl className="kv">
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
            <thead><tr><th>근거</th><th>단지</th><th>준공연도(본건 대비)</th><th>거리</th><th>최근 거래</th><th>거래 전용면적</th><th>중위 단가(만원/전용㎡)</th><th>최근 계약</th><th>선정 이유</th><th>자료</th></tr></thead>
            <tbody>{r.market.comparables.map((c) => (
              <tr key={c.complexKey}>
                <td>{citeFor(citationIdForComplex(r, c.complexKey), c.name)}</td>
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


          <ObservationDetail r={r} onCite={(el) => openCite(OBS_CITATION_ID, el, lastRun, r, "수동 확인 그룹 관측")} />
          <MarketSection {...props} part="results" />
        </div>

        <div className="step-panel" data-step="4" hidden={step !== 4}>
          <div className="card">
            <h3 className="card-title">저장·내보내기</h3>
            <div className="toolbar">
              <button onClick={runNow} className={stale ? "primary" : ""} data-testid="rerun-4">분석 다시 실행</button>
              {storage !== "browser-local" && <button onClick={saveToBrowser} className="primary" data-testid="save-browser-4">이 브라우저에 저장</button>}
              <button onClick={() => download(`apartment-analysis-${seoulToday()}.json`, JSON.stringify(makeBackup([rec], seoulNowIso()), null, 1), "application/json")} data-testid="export-json">JSON 내보내기</button>
              <button onClick={remove} className="danger" data-testid="delete">삭제</button>
            </div>
            <p className="small muted">저장된 실행 결과는 자동으로 덮어쓰지 않습니다. 입력을 바꾸면 ‘이전 결과 · 재분석 필요’로 표시되고, ‘분석 다시 실행’을 눌러야 새 실행본이 추가됩니다.</p>
          </div>
          <RunHistory rec={rec} onCite={(id, el, run) => openCite(id, el, run, run.result, id)} />
          <ReportSection {...props} defaultOpen />
        </div>

        <nav className="step-nav" aria-label="단계 이동">
          {step > 1 ? <button className="ghost" onClick={() => goStep(step - 1)} data-testid="step-prev">← 이전 단계</button> : <span />}
          <span className="step-count" data-testid="step-count">{String(step).padStart(2, "0")} / 04</span>
          {step === 1 && <button className="navy" onClick={() => goStep(2)} data-testid="step-next">입지·비교 조건으로 →</button>}
          {step === 2 && <button className="navy" onClick={() => { runNow(); goStep(3); }} data-testid="step-next">분석 실행하고 결과 보기 →</button>}
          {step === 3 && <button className="navy" onClick={() => goStep(4)} data-testid="step-next">보고서·저장으로 →</button>}
          {step === 4 && <button className="navy" onClick={() => goStep(3)} data-testid="step-next">결과로 돌아가기 ←</button>}
        </nav>
        <footer className="view-foot">
          <span>[가상] 표시는 가상 사례 · 금액 만원(원 단위 계산) · 관측 차이는 인과효과가 아니며 적정가격을 산정하지 않음</span>
          <span className="vf-step">{String(step).padStart(2, "0")} / 04</span>
        </footer>
      </main>
      <EvidenceDrawer target={cite} onClose={closeCite} />
    </div>
  );
}
