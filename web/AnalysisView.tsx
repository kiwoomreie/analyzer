import { useEffect, useMemo, useRef, useState } from "react";
import { deleteTemp, getTemp, putTemp, type SessionInfo } from "./api.ts";
import { draftStore, localStore } from "./store.ts";
import { navigate, withRun } from "./nav.ts";
import { Badge, download } from "./components.tsx";
import { hashOf } from "../shared/hash.ts";
import { newKey, ORIGIN_LABEL, type AnalysisRecord, type WorkingInputs } from "../shared/model.ts";
import { makeBackup } from "../shared/importers.ts";
import { seoulNowIso, seoulToday } from "../shared/dates.ts";
import { LABELS } from "../shared/contract.ts";
import { PropertySection } from "./sections/PropertySection.tsx";
import { EventsSection } from "./sections/EventsSection.tsx";
import { CompsSection } from "./sections/CompsSection.tsx";
import { SupplySection } from "./sections/SupplySection.tsx";
import { CalcSection } from "./sections/CalcSection.tsx";
import { ReportSection } from "./sections/ReportSection.tsx";
import { scanWorking } from "../shared/importers.ts";

export type Storage = "server-temporary" | "browser-local" | "draft";

export interface SectionProps {
  rec: AnalysisRecord;
  update: (fn: (w: WorkingInputs) => void) => void;
  setRec: (r: AnalysisRecord) => void;
  session: SessionInfo | null;
}

const STORAGE_LABEL: Record<Storage, string> = {
  "server-temporary": "서버 임시 분석",
  "browser-local": "이 브라우저에 저장됨",
  draft: "저장 전(이 탭에서만 유지)",
};

export function AnalysisView({ storage, recKey, session }: { storage: Storage; recKey: string; session: SessionInfo | null }) {
  const [rec, setRecState] = useState<AnalysisRecord | null>(null);
  const [meta, setMeta] = useState<{ expiresAt?: number; lastDuplicateAt?: number | null }>({});
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<string>("");
  const timer = useRef<any>(null);

  useEffect(() => {
    if (storage === "server-temporary") {
      getTemp(recKey).then((r) => { setRecState(r.record); setMeta({ expiresAt: r.expiresAt, lastDuplicateAt: r.lastDuplicateAt }); }).catch((e) => setError(e.message));
    } else {
      const r = storage === "browser-local" ? localStore.get(recKey) : draftStore.get(recKey);
      r ? setRecState(r) : setError(storage === "draft" ? "저장 전 작업을 찾을 수 없음(탭을 닫으면 사라짐)" : "이 브라우저에 저장된 분석을 찾을 수 없음");
    }
  }, [storage, recKey]);

  const persist = (r: AnalysisRecord) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      if (storage === "server-temporary") {
        try { await putTemp(r); setSaveState(`서버 임시 분석에 반영됨 ${new Date().toLocaleTimeString("ko-KR")}`); }
        catch (e) { setSaveState(`반영 실패: ${(e as Error).message}`); }
      } else {
        const err = storage === "browser-local" ? localStore.put(r) : draftStore.put(r);
        setSaveState(err ?? (storage === "browser-local" ? `이 브라우저에 저장됨 ${new Date().toLocaleTimeString("ko-KR")}` : "탭 임시 보관됨"));
      }
    }, 500);
  };

  const setRec = (r: AnalysisRecord) => { setRecState(r); persist(r); };
  const update = (fn: (w: WorkingInputs) => void) => {
    if (!rec) return;
    const w = structuredClone(rec.working);
    fn(w);
    const issues = scanWorking(w);
    if (issues.length) { setSaveState(`입력 거절: ${issues[0].path} — ${issues[0].message}`); return; }
    setRec({ ...rec, working: w, updatedAt: seoulNowIso(), title: w.property.displayName || w.property.address || rec.title });
  };

  const lastRun = rec?.runs[rec.runs.length - 1];
  const result = lastRun?.result;
  const stale = useMemo(() => (rec && lastRun ? hashOf(rec.working) !== lastRun.inputHash : false), [rec, lastRun]);

  if (error) return <main className="home"><div className="banner bad" data-testid="view-error">{error}</div><button onClick={() => navigate("/app")}>첫 화면으로</button></main>;
  if (!rec || !result) return <main className="home"><p className="muted">불러오는 중…</p></main>;

  const supported = result.assetSupported;
  const saveToBrowser = () => {
    const local = { ...structuredClone(rec), key: storage === "browser-local" ? rec.key : newKey("lc"), updatedAt: seoulNowIso() };
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
  const run = () => setRec(withRun(rec, "manual"));
  const fmt = (ms?: number) => (ms ? new Date(ms).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" }) : "-");

  return (
    <main className="view">
      <div className="view-head">
        <div>
          <h1 data-testid="analysis-title">{rec.title}</h1>
          <div className="badges">
            <Badge tone={storage === "browser-local" ? "ok" : "info"}>{STORAGE_LABEL[storage]}</Badge>
            <Badge tone="muted">{ORIGIN_LABEL[rec.origin.kind]}</Badge>
            <Badge tone="muted">{LABELS.assetType[rec.working.property.assetType]}</Badge>
            {rec.origin.kind === "demo" && <Badge tone="warn">가상 자료</Badge>}
            {!supported && <Badge tone="bad">현재 아파트만 지원</Badge>}
          </div>
          <dl className="meta" data-testid="meta">
            <dt>자료 기준일</dt><dd data-testid="meta-asof">{rec.working.asOf}</dd>
            {rec.origin.senderCreatedAt && <><dt>사본 생성</dt><dd>{rec.origin.senderCreatedAt}</dd></>}
            {rec.origin.receivedAt && <><dt>수신</dt><dd>{rec.origin.receivedAt}</dd></>}
            {rec.origin.sourceLabel && <><dt>출처 문구</dt><dd>{rec.origin.sourceLabel}</dd></>}
            {(rec.origin.kind === "launch" || rec.origin.kind === "committee-import") && <><dt>원본 최신 여부</dt><dd>미확인 — 협의체 원본과 자동 동기화하지 않음</dd></>}
            {storage === "server-temporary" && <><dt>임시 보관 만료</dt><dd>{fmt(meta.expiresAt)}</dd></>}
          </dl>
        </div>
        <div className="actions">
          <button onClick={run} data-testid="rerun" className={stale ? "primary" : ""}>분석 다시 실행</button>
          {supported && storage !== "browser-local" && <button onClick={saveToBrowser} data-testid="save-browser">이 브라우저에 저장</button>}
          <button onClick={() => download(`analysis-${seoulToday()}.json`, JSON.stringify(makeBackup([rec], seoulNowIso()), null, 1), "application/json")} data-testid="export-json">JSON 내보내기</button>
          <button onClick={remove} className="danger" data-testid="delete">삭제</button>
          <small className="muted" data-testid="save-state">{saveState}</small>
        </div>
      </div>

      {meta.lastDuplicateAt && <div className="banner info">같은 시동 자료가 다시 수신되어({fmt(meta.lastDuplicateAt)}) 새 사본을 만들지 않고 기존 사본을 열었습니다.</div>}
      <div className="banner info small" data-testid="run-info">
        최근 분석: #{lastRun.runNo} · {lastRun.trigger === "auto-launch" ? "시동 수신 시 자동 실행" : lastRun.trigger === "auto-create" ? "생성 시 자동 실행" : "수동 실행"} · {lastRun.at}
        {stale && <b> · 작업본이 바뀌었습니다. 결과를 갱신하려면 ‘분석 다시 실행’을 누르십시오.</b>}
      </div>

      {!supported ? (
        <div className="card">
          <p data-testid="unsupported">{result.unsupportedMessage}</p>
          <p className="muted small">자동으로 영구 보관하지 않습니다. 필요하면 JSON으로 내보내거나 삭제하십시오.</p>
        </div>
      ) : (
        <>
          {result.missing.length > 0 && (
            <div className="banner warn small" data-testid="missing">
              <b>보완하면 추가로 분석되는 항목</b>
              <ul>{result.missing.map((m) => <li key={m.field}>{m.label} — {m.affects}</li>)}</ul>
            </div>
          )}
          <Summary rec={rec} />
          <PropertySection rec={rec} update={update} setRec={setRec} session={session} />
          <EventsSection rec={rec} update={update} setRec={setRec} session={session} />
          <CompsSection rec={rec} update={update} setRec={setRec} session={session} />
          <SupplySection rec={rec} update={update} setRec={setRec} session={session} />
          <CalcSection rec={rec} update={update} setRec={setRec} session={session} />
          <ReportSection rec={rec} update={update} setRec={setRec} session={session} />
        </>
      )}
      {!supported && <ReportSection rec={rec} update={update} setRec={setRec} session={session} />}
    </main>
  );
}

function Summary({ rec }: { rec: AnalysisRecord }) {
  const r = rec.runs[rec.runs.length - 1].result;
  return (
    <div className="summary" data-testid="summary">
      <div className="card sblock">
        <h2>입지 변화</h2>
        {!r.summary.location.length ? <p className="muted">입지 사건 미입력 — ② 입지 사건·근거에서 추가</p> : (
          <ul>{r.summary.location.map((l) => <li key={l.key}><b>{l.text}</b>{l.detail && <div className="muted small">{l.detail}</div>}</li>)}</ul>
        )}
      </div>
      <div className="card sblock" data-testid="summary-price">
        <h2>가격 영향과 근거</h2>
        <dl className="kv">
          <dt>관찰된 가격 변화</dt><dd>{r.summary.price.observed.replace(/^관찰된 변화: ?/, "")}</dd>
          <dt>비교대상과의 차이</dt><dd>{r.summary.price.comparison.replace(/^비교대상과의 차이: ?/, "")}</dd>
          <dt>인과 추정 효과</dt><dd><Badge tone="muted">미추정</Badge> <span className="muted small">검증된 통계 모델 미적용</span></dd>
          <dt>사용자 스트레스 가정</dt><dd>{r.summary.price.stress.replace(/^사용자 스트레스 가정: ?/, "")}</dd>
          <dt>근거</dt><dd>{r.summary.price.evidence}</dd>
        </dl>
      </div>
      <div className="card sblock">
        <h2>주요 불확실성</h2>
        {!r.summary.uncertainties.length ? <p className="muted">자료 범위 내 주요 항목 없음</p> : (
          <ul>{r.summary.uncertainties.map((f, i) => <li key={i}><Badge tone={f.level === "high" ? "bad" : "warn"}>{f.level === "high" ? "높음" : "중간"}</Badge> {f.text}</li>)}</ul>
        )}
      </div>
    </div>
  );
}
