import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { getSession, getSessionError, login, logout, lookupPublicData, type SessionInfo } from "./api.ts";
import { draftStore, localStore, memoryDrafts } from "./store.ts";
import { AnalysisView } from "./AnalysisView.tsx";
import { currentPath, navigate, PREVIEW, withRun } from "./nav.ts";
import { DateText, DownloadFallback, Num, Select, Text, download } from "./components.tsx";
import { LABELS, type MoneyUnit } from "../shared/contract.ts";
import { APP_NAME, emptyWorking, newKey, newManualRecord, ORIGIN_LABEL, type AnalysisRecord, type ReviewPrice } from "../shared/model.ts";
import { detectFile, makeBackup } from "../shared/importers.ts";
import { demoWorking } from "../shared/demo.ts";
import { seoulNowIso, seoulToday } from "../shared/dates.ts";
import { applyLookup } from "../shared/applyData.ts";

function App() {
  const [path, setPath] = useState(currentPath());
  const [sess, setSess] = useState<SessionInfo | null>(null);
  useEffect(() => {
    const on = () => setPath(currentPath());
    window.addEventListener("popstate", on);
    window.addEventListener("hashchange", on);
    window.addEventListener("la:navigate", on);
    getSession().then(setSess);
    return () => { window.removeEventListener("popstate", on); window.removeEventListener("la:navigate", on); };
  }, []);
  const m = /^\/app\/([adl])\/([A-Za-z0-9_-]+)$/.exec(path);
  return (
    <div className="app">
      <header className="top">
        {PREVIEW && <span className="badge tone-warn" data-testid="preview-badge" title="서버 없이 이 브라우저에서만 실행 — 저장도 이 브라우저에만 됨">서버 없는 웹 버전</span>}
        <a className="brand" href="/app" onClick={(e: any) => { e.preventDefault(); navigate("/app"); }}><b>{APP_NAME}</b></a>
        <span className="muted small">주소로 시작 · 입지 변화 / 실거래 비교 / 확인할 사항 · 협의체와 별도로 사용</span>
        {sess?.config.auth?.required && <HostedAuth session={sess} onChange={setSess} />}
      </header>
      {m ? <AnalysisView key={path} storage={m[1] === "a" ? "server-temporary" : m[1] === "l" ? "browser-local" : "draft"} recKey={m[2]} session={sess} /> : <Home session={sess} />}
      <DownloadFallback />
    </div>
  );
}

interface NewForm { address?: string; name?: string; area?: number; buildYear?: number; price?: number; unit: MoneyUnit; basis: ReviewPrice["basis"]; priceDate?: string; saleStart?: string; completion?: string; asOf?: string }

function Home({ session }: { session: SessionInfo | null }) {
  const [locals, setLocals] = useState<AnalysisRecord[]>(() => localStore.list());
  const [drafts] = useState<AnalysisRecord[]>(() => draftStore.list());
  const [msg, setMsg] = useState<{ tone: "ok" | "bad" | "info"; text: string; list?: string[] } | null>(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [health, setHealth] = useState(() => localStore.health());
  const [exported, setExported] = useState(false);
  const [f, setF] = useState<NewForm>({ unit: "KRW_100M", basis: "household", asOf: seoulToday() });
  const autoLookup = session?.config.publicData === "configured" || session?.config.geocoder === "configured";

  const start = async () => {
    if (!f.address?.trim()) return setMsg({ tone: "bad", text: "주소를 입력하십시오" });
    if (!f.asOf || !/^\d{4}-\d{2}-\d{2}$/.test(f.asOf)) return setMsg({ tone: "bad", text: "분석 기준일(YYYY-MM-DD)을 확인하십시오" });
    const w = emptyWorking(f.address.trim(), f.asOf);
    w.property = { address: f.address.trim(), displayName: f.name, exclusiveAreaM2: f.area, buildYear: f.buildYear };
    if (f.price !== undefined) w.reviewPrice = { amount: f.price, unit: f.unit, basis: f.basis, basisDate: f.priceDate, label: "검토가격", dataMode: "user" };
    w.schedule = { saleStart: f.saleStart, completion: f.completion };
    if (autoLookup) {
      setBusy(true);
      try {
        const res = await lookupPublicData({ address: w.property.address, asOf: w.asOf, months: w.options.recentMonths, radiusM: w.options.radiusM });
        applyLookup(w, res, seoulNowIso());
      } catch (e) {
        w.dataLog.push({ at: seoulNowIso(), source: "공공·지도 API", detail: `자동 조회 실패: ${(e as Error).message}` });
      } finally { setBusy(false); }
    }
    openDraft(withRun(newManualRecord(newKey("dr"), w, "manual"), "auto-create"));
  };

  /** 탭 저장소가 막혀도 분석은 열되, 메모리에만 있다는 사실을 화면에 표시 */
  const openDraft = (rec: AnalysisRecord) => {
    if (draftStore.put(rec)) memoryDrafts.set(rec.key, rec);
    navigate(`/app/d/${rec.key}`);
  };

  const onFile = async (file: File) => {
    if (file.size > 8 * 1024 * 1024) return setMsg({ tone: "bad", text: "파일이 8MB를 넘어 거절함" });
    const d = detectFile(file.name, await file.text());
    if (d.type === "backup") {
      if (!d.records.length) return setMsg({ tone: "bad", text: "복구할 수 있는 분석이 없음", list: d.errors });
      if (!localStore.available()) return setMsg({ tone: "bad", text: "이 브라우저 저장소를 사용할 수 없어 복구하지 못했습니다(차단). 백업 파일은 그대로 보관하십시오." });
      let saved = 0, same = 0, copies = 0;
      const errs: string[] = [];
      for (const r of d.records) {
        const res = localStore.putIfAbsent(r);
        if (res.error) errs.push(res.error);
        else if (res.result === "saved") saved++;
        else if (res.result === "same") same++;
        else { const e2 = localStore.put({ ...r, key: newKey("lc"), title: `${r.title} (복구 사본)` }); e2 ? errs.push(e2) : copies++; }
      }
      setLocals(localStore.list());
      return setMsg({ tone: errs.length ? "bad" : "ok", text: `백업 ${d.records.length}건: 새로 복구 ${saved} · 이미 같은 내용 ${same} · 같은 식별자의 다른 내용은 기존 기록을 덮어쓰지 않고 사본으로 복구 ${copies}${d.errors.length ? ` · 거절 ${d.errors.length}` : ""}${errs.length ? ` · 저장 실패 ${errs.length}` : ""}`, list: [...d.errors, ...errs] });
    }
    if (d.type === "csv" || d.type === "general-json") return setMsg({ tone: "info", text: "실거래 CSV·사건 JSON은 분석을 시작한 뒤 상세 영역에서 가져오십시오." });
    if (d.type === "committee-import" || d.type === "launch-document") return setMsg({ tone: "info", text: "협의체 연동 파일은 입력 규격 확정 전까지 대기 상태입니다. 주소로 새 분석을 시작하십시오." });
    setMsg({ tone: "bad", text: d.errors.join(" ") });
  };

  const loadDemo = () => openDraft(withRun(newManualRecord(newKey("dr"), demoWorking(), "demo"), "auto-create"));

  return (
    <main className="home">
      {!session && getSessionError() && <div className="banner warn">{getSessionError()}</div>}
      {health.state === "unreadable" && (
        <div className="banner bad" data-testid="store-unreadable">
          <b>저장된 분석 원문을 읽을 수 없습니다.</b> {health.message} 새 저장은 원문 보호를 위해 차단되며, 원문은 자동으로 지우지 않습니다.
          <div className="toolbar">
            <button onClick={() => { download(`apartment-analyzer-storage-raw-${seoulToday()}.txt`, localStore.exportRaw() ?? "", "text/plain;charset=utf-8"); setExported(true); }} data-testid="export-raw">원문 내보내기(그대로)</button>
            <button disabled={!exported} title={exported ? "" : "먼저 원문을 내보내십시오"} onClick={() => { const r = localStore.quarantineAndReset(); setMsg(r.error ? { tone: "bad", text: r.error } : { tone: "ok", text: `손상 원문을 보관 키(${r.quarantineKey})에 복사·확인한 뒤 새 저장소로 시작했습니다. 원문은 지우지 않았습니다.` }); setHealth(localStore.health()); setLocals(localStore.list()); }} data-testid="quarantine">손상 원문 보관 후 새로 시작</button>
          </div>
        </div>
      )}
      {health.state === "partial" && (
        <div className="banner warn" data-testid="store-partial">
          {health.message}
          <div className="toolbar"><button onClick={() => download(`apartment-analyzer-damaged-records-${seoulToday()}.json`, JSON.stringify(localStore.exportBad(), null, 1), "application/json")} data-testid="export-bad">손상 기록 원문 내보내기</button></div>
        </div>
      )}
      {msg && <div className={`banner ${msg.tone}`} data-testid="home-message">{msg.text}{msg.list?.length ? <ul>{msg.list.map((l, i) => <li key={i}><code>{l}</code></li>)}</ul> : null}</div>}
      <section className="card start">
        <h2>새 분석</h2>
        <p className="muted small">아파트 또는 사업지 주소만으로 시작할 수 있습니다. 전용면적과 검토가격은 가격 비교가 필요할 때 추가하십시오(없으면 가격 판단만 보류).</p>
        <div className="addr-row">
          <input className="addr" placeholder="예: 서울특별시 ○○구 ○○로 123" value={f.address ?? ""} onChange={(e: any) => setF({ ...f, address: e.target.value })} onKeyDown={(e: any) => e.key === "Enter" && start()} data-testid="new-address" />
          <button className="primary" onClick={start} disabled={busy} data-testid="start">{busy ? "조회 중…" : "분석 시작"}</button>
        </div>
        <p className="small muted">{autoLookup ? "주소로 좌표·인근 실거래를 자동 조회합니다(새 앱 서버의 고정 공공 API만 사용)." : "자동 조회 미설정(공공데이터·지도 키 없음) — 시작 후 실거래 CSV·입지 사건을 직접 추가하거나 가상 데모로 사용 흐름을 확인하십시오."}</p>
        <button className="link" onClick={() => setMore(!more)} data-testid="more-toggle">{more ? "선택 입력 닫기" : "선택 입력(전용면적·검토가격·일정) 열기"}</button>
        {more && (
          <div className="form grid">
            <Text label="표시명" value={f.name} onChange={(v) => setF({ ...f, name: v })} />
            <Num label="전용면적" suffix="㎡" value={f.area} onChange={(v) => setF({ ...f, area: v })} testId="new-area" />
            <Num label="준공(예정)연도" integer value={f.buildYear} onChange={(v) => setF({ ...f, buildYear: v })} testId="new-buildyear" />
            <Num label="검토가격" value={f.price} onChange={(v) => setF({ ...f, price: v })} testId="new-price" />
            <Select label="금액 단위" value={f.unit} options={Object.entries(LABELS.moneyUnit) as [MoneyUnit, string][]} onChange={(v) => setF({ ...f, unit: v })} />
            <Select label="가격 기준" value={f.basis} options={[["household", "세대당"], ["perExclusiveM2", "전용㎡당"], ["perExclusivePyeong", "전용평당"]]} onChange={(v) => setF({ ...f, basis: v as ReviewPrice["basis"] })} />
            <DateText label="가격 기준일" value={f.priceDate} onChange={(v) => setF({ ...f, priceDate: v })} />
            <DateText label="분양(예정)" value={f.saleStart} onChange={(v) => setF({ ...f, saleStart: v })} />
            <DateText label="준공(예정)" value={f.completion} onChange={(v) => setF({ ...f, completion: v })} />
            <DateText label="분석 기준일" value={f.asOf} dayOnly onChange={(v) => setF({ ...f, asOf: v })} testId="new-asof" />
          </div>
        )}
      </section>

      <section className="card">
        <h2>저장한 분석 <span className="muted small">이 브라우저에 저장</span></h2>
        <p className="small muted">브라우저 데이터를 지우거나 다른 기기에서는 자동 복구되지 않습니다. 필요하면 JSON 백업을 내려받으십시오.</p>
        {!localStore.available() && <div className="banner bad" data-testid="storage-blocked">이 브라우저 저장소를 사용할 수 없습니다(차단·개인정보 보호 모드 등). ‘이 브라우저에 저장’이 동작하지 않으니 분석 화면의 ‘JSON 내보내기’로 파일을 보관하고, 다시 볼 때 ‘백업 복구’ 대신 파일을 보관해 두십시오.</div>}
        {!locals.length ? <p className="muted">저장한 분석 없음</p> : (
          <table className="tbl" data-testid="local-list"><thead><tr><th>대상</th><th>입력</th><th>기준일</th><th>수정</th><th /></tr></thead>
            <tbody>{locals.map((r) => <tr key={r.key}><td>{r.title}</td><td>{ORIGIN_LABEL[r.origin.kind]}</td><td>{r.working.asOf}</td><td>{r.updatedAt.slice(0, 16).replace("T", " ")}</td><td><button className="link" onClick={() => navigate(`/app/l/${r.key}`)} data-testid="open-local">열기</button></td></tr>)}</tbody></table>
        )}
        <div className="toolbar">
          {locals.length > 0 && <button onClick={() => download(`apartment-analysis-backup-${seoulToday()}.json`, JSON.stringify(makeBackup(locals, seoulNowIso()), null, 1), "application/json")}>전체 백업(JSON)</button>}
          <label className="filebtn">백업 복구(JSON)<input type="file" accept=".json" data-testid="file-import" onChange={(e: any) => { const x = e.target.files?.[0]; if (x) onFile(x); e.target.value = ""; }} /></label>
          <button onClick={loadDemo} data-testid="load-demo">가상 데모로 사용해 보기</button>
        </div>
        {drafts.length > 0 && <p className="small">저장 전 작업: {drafts.map((r) => <button key={r.key} className="link" onClick={() => navigate(`/app/d/${r.key}`)}>{r.title}</button>)}</p>}
      </section>

      <KeyLimits session={session} />

      <section className="card small">
        <h2>설정 상태</h2>
        <ul className="status-list">
          <li>주소→좌표 변환(카카오 로컬): <b>{session?.config.geocoder === "configured" ? "설정됨(실제 호출 미검증)" : "미설정"}</b></li>
          <li>국토교통부 아파트 실거래가: <b>{session?.config.publicData === "configured" ? "설정됨(실제 호출 미검증)" : "미설정"}</b></li>
          <li>입지 뉴스·고시 자동 수집: <b>미구현</b> — 입지 사건·근거는 모두 사용자 입력으로 표시</li>
          <li>협의체 시동 수신(/launch): <b>{session?.config.launchReceiver === "enabled" ? "활성" : "대기(비활성)"}</b> · 외부 생성형 AI: <b>비활성</b></li>
        </ul>
      </section>
    </main>
  );
}

/** 서버리스 배포: 자동 조회용 접속 비밀번호 로그인(분석·저장·보고서는 로그인 없이도 사용) */
function HostedAuth({ session, onChange }: { session: SessionInfo; onChange: (s: SessionInfo | null) => void }) {
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const a = session.config.auth!;
  if (!a.ready) return <span className="badge tone-warn" data-testid="auth-state">자동 조회 꺼짐(서버에 접속 비밀번호 미설정)</span>;
  if (a.signedIn) return <span className="auth-bar" data-testid="auth-state"><span className="badge tone-ok">자동 조회 로그인됨</span> <button className="link" data-testid="logout" onClick={async () => onChange(await logout())}>로그아웃</button></span>;
  return (
    <form className="auth-bar" data-testid="auth-form" onSubmit={async (e: any) => { e.preventDefault(); if (!pw) return; setBusy(true); setMsg(null); try { onChange(await login(pw)); setPw(""); } catch (err) { setMsg((err as Error).message); } finally { setBusy(false); } }}>
      <input type="password" autoComplete="current-password" placeholder="자동 조회 접속 비밀번호" aria-label="자동 조회 접속 비밀번호" value={pw} onChange={(e: any) => setPw(e.target.value)} data-testid="auth-password" />
      <button type="submit" disabled={busy || !pw} data-testid="auth-login">{busy ? "확인 중…" : "로그인"}</button>
      {msg && <span className="bad-text small" data-testid="auth-error">{msg}</span>}
    </form>
  );
}

/** 국토부·카카오 키가 없을 때 제한되는 기능(미리보기에서도 항상 표시) */
export function KeyLimits({ session }: { session: SessionInfo | null }) {
  const molit = session?.config.publicData === "configured";
  const kakao = session?.config.geocoder === "configured";
  if (molit && kakao) return null;
  return (
    <section className="card small" data-testid="key-limits">
      <h2>API 키가 없어 제한되는 기능 {!session && <span className="badge tone-warn">서버 없이 미리보기 중</span>}</h2>
      <table className="tbl">
        <thead><tr><th>기능</th><th>필요한 키</th><th>상태</th><th>대신 할 수 있는 방법</th></tr></thead>
        <tbody>
          <tr><td>주소 → 좌표 자동 변환</td><td>카카오 로컬(REST)</td><td>{kakao ? "설정됨" : "사용 불가"}</td><td>‘입력·세부 설정’에서 본건 좌표 직접 입력</td></tr>
          <tr><td>인근 아파트 실거래 자동 수집(전 페이지·건수 대사)</td><td>국토교통부 실거래가(공공데이터포털)</td><td>{molit ? "설정됨" : "사용 불가"}</td><td>실거래 CSV 가져오기(국토부 실거래가 공개시스템에서 내려받은 자료 등)</td></tr>
          <tr><td>반경 주변 시군구 탐색(17개 표본 지점)</td><td>카카오 로컬(REST)</td><td>{kakao ? "설정됨" : "사용 불가"}</td><td>CSV에 주변 시군구 거래를 함께 넣기</td></tr>
          <tr><td>비교단지 좌표·거리 확인</td><td>카카오 로컬(REST)</td><td>{kakao ? "설정됨" : "사용 불가"}</td><td>‘실거래·비교단지 상세’에서 단지별 거리(m) 직접 입력 — 거리 미확인 단지는 대표 통계에서 제외</td></tr>
          <tr><td>지도 표시</td><td>카카오 지도(JavaScript)</td><td>{session?.config.kakaoJsKey ? "설정됨" : "좌표 도식으로 대체"}</td><td>번호 마커 도식(실제 지도 아님)</td></tr>
        </tbody>
      </table>
      <p className="muted">분석·저장·보고서는 키 없이도 동작합니다. 입지 뉴스·고시 자동 수집 기능은 키와 무관하게 없습니다(사용자 입력).</p>
    </section>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
