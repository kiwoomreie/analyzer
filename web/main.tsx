import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { getSession, getSessionError, listTemp, type SessionInfo, type TempListItem } from "./api.ts";
import { draftStore, localStore } from "./store.ts";
import { AnalysisView } from "./AnalysisView.tsx";
import { Badge, DateText, Num, Select, Text, download } from "./components.tsx";
import { LABELS, type AssetType } from "../shared/contract.ts";
import { emptyWorking, newKey, newManualRecord, recordFromContract, ORIGIN_LABEL, type AnalysisRecord } from "../shared/model.ts";
import { navigate, withRun } from "./nav.ts";
import { detectFile, makeBackup } from "../shared/importers.ts";
import { demoWorkings } from "../shared/demo.ts";
import { seoulNowIso, seoulToday } from "../shared/dates.ts";
import { hashOf } from "../shared/hash.ts";

function App() {
  const [path, setPath] = useState(location.pathname);
  const [sess, setSess] = useState<SessionInfo | null>(null);
  useEffect(() => {
    const on = () => setPath(location.pathname);
    window.addEventListener("popstate", on);
    window.addEventListener("la:navigate", on);
    getSession().then(setSess);
    return () => { window.removeEventListener("popstate", on); window.removeEventListener("la:navigate", on); };
  }, []);
  const m = /^\/app\/([adl])\/([A-Za-z0-9_-]+)$/.exec(path);
  return (
    <div className="app">
      <header className="top">
        <a className="brand" href="/app" onClick={(e: any) => { e.preventDefault(); navigate("/app"); }}>
          <b>입지 변화·가격영향 분석기</b> <span className="muted">분양가·담보가치·회수시점 검증</span>
        </a>
        <span className="muted small">협의체와 별도로 사용 가능 · 협의체 → 분석기 단방향 · 결과를 협의체에 반영하지 않음</span>
      </header>
      {m ? <AnalysisView key={path} storage={m[1] === "a" ? "server-temporary" : m[1] === "l" ? "browser-local" : "draft"} recKey={m[2]} session={sess} /> : <Home session={sess} />}
    </div>
  );
}

function Home({ session }: { session: SessionInfo | null }) {
  const [temps, setTemps] = useState<TempListItem[]>([]);
  const [locals, setLocals] = useState<AnalysisRecord[]>(() => localStore.list());
  const [drafts, setDrafts] = useState<AnalysisRecord[]>(() => draftStore.list());
  const [msg, setMsg] = useState<{ tone: "ok" | "bad" | "info"; text: string; list?: string[] } | null>(null);
  const [form, setForm] = useState<{ name?: string; address?: string; assetType: AssetType; area?: number; asOf?: string }>({ assetType: "apartment", asOf: seoulToday() });
  useEffect(() => { listTemp().then(setTemps); }, [session]);
  const refresh = () => { setLocals(localStore.list()); setDrafts(draftStore.list()); listTemp().then(setTemps); };

  const createManual = () => {
    if (!form.asOf || !/^\d{4}-\d{2}-\d{2}$/.test(form.asOf)) return setMsg({ tone: "bad", text: "분석 기준일(YYYY-MM-DD)을 입력하십시오" });
    const w = emptyWorking(form.asOf, form.assetType);
    w.property = { assetType: form.assetType, displayName: form.name, address: form.address, exclusiveAreaM2: form.area };
    const rec = withRun(newManualRecord(newKey("dr"), w, "manual"), "auto-create");
    const err = draftStore.put(rec);
    if (err) setMsg({ tone: "bad", text: err });
    navigate(`/app/d/${rec.key}`);
  };

  const onFile = async (file: File) => {
    if (file.size > 4 * 1024 * 1024) return setMsg({ tone: "bad", text: "파일이 4MB를 넘어 거절함" });
    const text = await file.text();
    const d = detectFile(file.name, text);
    if (d.type === "committee-import") {
      const v = d.validation;
      if (!v.ok) return setMsg({ tone: "bad", text: v.safetyRejected ? "금지 항목(인증·콜백·주소·비밀값 등)이 있어 파일 전체를 거절함. 원문은 저장하지 않았음." : "협의체 반출 파일 형식 오류", list: v.issues.slice(0, 12).map((i) => `${i.path} — ${i.message}`) });
      const doc = v.doc as any;
      const existing = localStore.findByExportId(doc.exportId) ?? draftStore.findByExportId(doc.exportId);
      if (existing) {
        if (existing.origin.payloadHash === hashOf(doc)) { setMsg({ tone: "info", text: "같은 exportId·같은 내용의 파일 — 새 사본을 만들지 않고 기존 사본을 엽니다" }); return navigate(`/app/${localStore.get(existing.key) ? "l" : "d"}/${existing.key}`); }
        return setMsg({ tone: "bad", text: `같은 exportId(${doc.exportId})에 다른 내용 — 충돌로 처리, 기존 사본은 변경하지 않았음` });
      }
      const rec = withRun(recordFromContract(doc, { key: newKey("dr"), kind: "committee-import" }), "auto-create");
      draftStore.put(rec);
      return navigate(`/app/d/${rec.key}`);
    }
    if (d.type === "launch-document") return setMsg({ tone: "bad", text: "시동(location-analysis-launch) 문서는 버튼 전송 전용입니다. 파일로 전달할 때는 location-analysis-import 형식(exportId·exportedAt)을 사용하십시오." });
    if (d.type === "backup") {
      if (!d.records.length) return setMsg({ tone: "bad", text: "복구할 수 있는 분석이 없음", list: d.errors });
      const errs = d.records.map((r) => localStore.put({ ...r, key: localStore.get(r.key) ? newKey("lc") : r.key })).filter(Boolean) as string[];
      refresh();
      return setMsg({ tone: errs.length ? "bad" : "ok", text: `백업에서 ${d.records.length}건을 이 브라우저에 복구함${d.errors.length ? ` (거절 ${d.errors.length}건)` : ""}`, list: [...d.errors, ...errs] });
    }
    if (d.type === "general-json" || d.type === "csv") return setMsg({ tone: "info", text: "일반 JSON·CSV(사건·근거·비교거래)는 분석을 연 뒤 ② 입지 사건·근거 또는 ③ 거래·비교 분석에서 가져오십시오." });
    setMsg({ tone: "bad", text: d.errors.join(" ") });
  };

  const loadDemo = () => {
    const recs = demoWorkings().map(({ working }) => withRun(newManualRecord(newKey("lc"), working, "demo"), "auto-create"));
    const errs = recs.map((r) => localStore.put(r)).filter(Boolean);
    refresh();
    setMsg(errs.length ? { tone: "bad", text: String(errs[0]) } : { tone: "ok", text: "가상 데모 사업장 5건을 이 브라우저에 저장함(모든 자료는 가상)" });
  };

  const fmtTime = (ms: number) => new Date(ms).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" });
  return (
    <main className="home">
      {!session && getSessionError() && <div className="banner warn">{getSessionError()}</div>}
      {msg && <div className={`banner ${msg.tone === "bad" ? "bad" : msg.tone === "ok" ? "ok" : "info"}`} data-testid="home-message">{msg.text}{msg.list?.length ? <ul>{msg.list.map((l, i) => <li key={i}><code>{l}</code></li>)}</ul> : null}</div>}
      <section className="card">
        <h2>새 분석 시작</h2>
        <p className="muted">협의체 로그인·사업장 ID·접속 없이 사용할 수 있습니다. 첫 버전은 <b>아파트</b>만 분석합니다.</p>
        <div className="grid3">
          <div>
            <h3>직접 입력</h3>
            <div className="form">
              <Text label="표시명(선택)" value={form.name} onChange={(v) => setForm({ ...form, name: v })} testId="new-name" />
              <Text label="주소(선택)" value={form.address} onChange={(v) => setForm({ ...form, address: v })} />
              <Select label="자산유형" value={form.assetType} options={Object.entries(LABELS.assetType) as [AssetType, string][]} onChange={(v) => setForm({ ...form, assetType: v })} />
              <Num label="비교 타입 전용면적" suffix="㎡" value={form.area} onChange={(v) => setForm({ ...form, area: v })} testId="new-area" />
              <DateText label="분석 기준일" value={form.asOf} onChange={(v) => setForm({ ...form, asOf: v })} dayOnly testId="new-asof" />
              <button className="primary" onClick={createManual} data-testid="create-manual">새 분석 시작</button>
            </div>
          </div>
          <div>
            <h3>파일 가져오기</h3>
            <p className="small">협의체 반출 파일(<code>location-analysis-import</code> JSON), 새 앱 백업(JSON)을 불러옵니다. 모든 파일에 같은 안전 검사를 적용하며 파일 속 주소·HTML·수식을 실행하지 않습니다.</p>
            <input type="file" accept=".json,.csv" data-testid="file-import" onChange={(e: any) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
          </div>
          <div>
            <h3>가상 데모</h3>
            <p className="small">가상 사업장 5건·입지 사건 4건(교통·업무·공급 2). 사용 흐름 시험용이며 통계적 타당성을 보장하지 않습니다.</p>
            <button onClick={loadDemo} data-testid="load-demo">가상 데모 불러오기</button>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>협의체에서 받은 임시 분석 <span className="muted small">(이 브라우저 세션 · {session?.config.tempAnalysisTtlHours ?? 24}시간 후 자동 정리)</span></h2>
        {!temps.length ? <p className="muted">받은 시동 자료 없음</p> : (
          <table className="tbl"><thead><tr><th>사업장</th><th>출처</th><th>수신</th><th>만료</th><th /></tr></thead>
            <tbody>{temps.map((t) => <tr key={t.key}><td>{t.title} {!t.supported && <Badge tone="warn">미지원 자산</Badge>}</td><td>{ORIGIN_LABEL[t.origin as keyof typeof ORIGIN_LABEL] ?? t.origin}</td><td>{fmtTime(t.createdAt)}</td><td>{fmtTime(t.expiresAt)}</td><td><button className="link" onClick={() => navigate(`/app/a/${t.key}`)}>열기</button></td></tr>)}</tbody></table>
        )}
      </section>

      <section className="card">
        <h2>이 브라우저에 저장한 분석</h2>
        <p className="small muted">브라우저 데이터를 지우거나 다른 기기에서는 자동으로 복구되지 않습니다. 보관이 필요하면 JSON 백업을 내려받으십시오. 서버 계정별 영구 보관은 새 앱 로그인·권한 정책 결정 전까지 비활성입니다.</p>
        {!localStore.available() && <div className="banner warn">이 브라우저는 로컬 저장을 허용하지 않음 — JSON 내보내기만 사용 가능</div>}
        {!locals.length ? <p className="muted">저장한 분석 없음</p> : (
          <table className="tbl" data-testid="local-list"><thead><tr><th>사업장</th><th>출처</th><th>기준일</th><th>수정</th><th /></tr></thead>
            <tbody>{locals.map((r) => <tr key={r.key}><td>{r.title}</td><td>{ORIGIN_LABEL[r.origin.kind]}</td><td>{r.working.asOf}</td><td>{r.updatedAt.slice(0, 16).replace("T", " ")}</td><td><button className="link" onClick={() => navigate(`/app/l/${r.key}`)}>열기</button></td></tr>)}</tbody></table>
        )}
        {locals.length > 0 && <button onClick={() => download(`location-analyzer-backup-${seoulToday()}.json`, JSON.stringify(makeBackup(locals, seoulNowIso()), null, 1), "application/json")}>전체 백업(JSON) 내려받기</button>}
      </section>

      {drafts.length > 0 && (
        <section className="card">
          <h2>저장 전 작업 <span className="muted small">(이 탭을 닫으면 사라짐)</span></h2>
          <ul>{drafts.map((r) => <li key={r.key}><button className="link" onClick={() => navigate(`/app/d/${r.key}`)}>{r.title}</button> <span className="muted small">{ORIGIN_LABEL[r.origin.kind]}</span></li>)}</ul>
        </section>
      )}

      <section className="card small">
        <h2>설정 상태</h2>
        <ul className="status-list">
          <li>공공데이터(실거래) 키: <b>{session?.config.publicData === "configured" ? "설정됨(실제 호출 미검증)" : "미설정"}</b></li>
          <li>카카오맵 키: <b>{session?.config.kakaoJsKey ? "설정됨" : "미설정"}</b></li>
          <li>서버 영구 보관: <b>비활성</b>(브라우저 저장·JSON 백업 사용) · 외부 생성형 AI: <b>비활성</b></li>
          <li>새 앱 서버 연결: <b>{session ? "연결됨" : "연결 안 됨"}</b></li>
        </ul>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
