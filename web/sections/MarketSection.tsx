import { ObservationPanel } from "./ObservationPanel.tsx";
import { useRef, useState } from "react";
import { Badge, ModeBadge, MonthlyBars, Num, Section, Select, Text, download } from "../components.tsx";
import { demoWorking } from "../../shared/demo.ts";

function demoCsv(): string {
  const rows = ["단지명,법정동,전용면적,층,거래금액(만원),계약일,해제여부,건축년도"];
  for (const t of demoWorking().transactions) rows.push([t.complexName, t.dong ?? "", t.exclusiveAreaM2, t.floor ?? "", Math.round(t.priceKrw / 1e4), t.contractDate, t.cancelled ? "O" : "", t.buildYear ?? ""].join(","));
  return rows.join("\n");
}
import type { SectionProps } from "../AnalysisView.tsx";
import { lookupPublicData } from "../api.ts";
import { latestRun } from "../nav.ts";
import type { ComplexInfo } from "../../shared/model.ts";
import { transactionsFromCsv } from "../../shared/importers.ts";
import { applyLookup, applyTrades, collectionStatusText, GEOCODE_STATUS_LABEL, REGION_STATUS_LABEL, TRADE_STATUS_LABEL } from "../../shared/applyData.ts";
import { migrateCollection } from "../../shared/model.ts";
import { cleanupIdenticalDuplicates, diagnoseTrades, liveCancelAmbiguity, mergeReportText } from "../../shared/tradeMerge.ts";
import type { LookupPayload } from "../../shared/applyData.ts";
import type { WorkingInputs } from "../../shared/model.ts";

/** 조회 조건(응답이 어느 입력 기준인지 확인용) */
function queryOf(w: WorkingInputs) {
  return {
    주소: w.property.address, "분석 기준일": w.asOf, 반경: String(w.options.radiusM), "시군구 코드": w.property.lawdCode ?? "", "조회 기간": String(w.options.recentMonths),
    "본건 좌표": w.property.coordinates ? `${w.property.coordinates.lat},${w.property.coordinates.lng}` : "",
  };
}
import { parseDateValue, seoulNowIso } from "../../shared/dates.ts";
import { fmtMan, fmtNum } from "../../shared/units.ts";
import type { ComplexResult, Stats } from "../../shared/analysis.ts";

const PAGE = 50;
const STATUS: Record<ComplexResult["status"], [string, "ok" | "warn" | "muted"]> = {
  selected: ["대표", "ok"], eligible: ["반경 내 후보", "muted"], needsCheck: ["확인 필요(거리 미확인)", "warn"], excluded: ["제외", "muted"],
};
const ORDER: Record<ComplexResult["status"], number> = { selected: 0, eligible: 1, needsCheck: 2, excluded: 3 };

function StatCells({ s }: { s: Stats }) {
  return s.count ? <><td>{fmtMan(s.medianPerM2)}</td><td>{fmtMan(s.p25PerM2)} ~ {fmtMan(s.p75PerM2)}</td></> : <td colSpan={2} className="muted">유효 표본 없음</td>;
}

export function MarketSection({ rec, getRec, update, setRec, session }: SectionProps) {
  const w = rec.working;
  const { input, result: r, stale } = latestRun(rec);
  const m = r!.market;
  const [filter, setFilter] = useState<"all" | "included" | "excluded">("all");
  const [page, setPage] = useState(0);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const [held, setHeld] = useState<{ res: LookupPayload; changed: string[] } | null>(null);
  const rowByKey = new Map(m.txRows.map((x) => [x.key, x]));
  const filtered = w.transactions.filter((t) => filter === "all" || (filter === "included" ? rowByKey.get(t.key)?.included : !rowByKey.get(t.key)?.included));
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const curPage = Math.min(page, pages - 1);
  const shown = filtered.slice(curPage * PAGE, curPage * PAGE + PAGE);
  const ambLive = liveCancelAmbiguity(w.transactions);

  const setInfo = (ck: string, fn: (i: ComplexInfo) => void) => update((x) => {
    let i = x.complexInfo.find((c) => c.complexKey === ck);
    if (!i) { i = { complexKey: ck }; x.complexInfo.push(i); }
    fn(i);
  });

  const importCsv = async (f: File) => {
    if (f.size > 4 * 1024 * 1024) return setMsg("4MB 초과 — 거절");
    const src = `사용자 CSV(${f.name.slice(0, 60)})`;
    const res = transactionsFromCsv(await f.text(), "user", src);
    if (!res.ok) return setMsg(`거절: ${res.errors.slice(0, 3).join(" / ")}`);
    let text = "";
    update((x) => { const rep = applyTrades(x, res.items, seoulNowIso(), src); text = mergeReportText(rep) + (rep.notes.length ? ` · ${rep.notes.join(" · ")}` : ""); }); // 최신 작업본에 병합
    setMsg(`${text}${res.skipped ? ` · 형식 오류 ${res.skipped}행 건너뜀` : ""} — ‘분석 다시 실행’으로 결과 갱신`);
  };

  const applyRes = (res: LookupPayload) => {
    let text = "";
    update((x) => { const rep = applyLookup(x, res, seoulNowIso()); text = `${collectionStatusText(rep)}${rep.merge ? ` · ${mergeReportText(rep.merge)}` : ""}`; });
    setMsg(text);
  };

  const lookup = async () => {
    const start = getRec();
    if (!start) return;
    const my = ++seq.current;
    const q = queryOf(start.working);
    setBusy(true);
    setHeld(null);
    try {
      const sw = start.working;
      const res = await lookupPublicData({ address: sw.property.address, lawdCode: sw.property.lawdCode, asOf: sw.asOf, months: sw.options.recentMonths, radiusM: sw.options.radiusM, center: sw.property.coordinates ? { lat: sw.property.coordinates.lat, lng: sw.property.coordinates.lng } : undefined });
      if (my !== seq.current) { setMsg("이전 조회의 응답 — 더 최근 조회가 있어 적용하지 않음"); return; }
      const now = queryOf(getRec()!.working);
      const changed = (Object.keys(q) as (keyof typeof q)[]).filter((k) => q[k] !== now[k]);
      if (changed.length) {
        setHeld({ res, changed });
        setMsg(`조회 이후 ${changed.join("·")}이(가) 바뀌어 이전 조건의 결과 적용을 보류했습니다.`);
        return;
      }
      applyRes(res); // 최신 작업본에 병합(대기 중 편집 보존)
    } catch (e) { if (my === seq.current) setMsg((e as any).body?.message ?? (e as Error).message); }
    finally { if (my === seq.current) setBusy(false); }
  };

  /** 미리보기용 가상 예시: 거래·단지 좌표를 추가(기존 입력은 바꾸지 않음, 본건 좌표는 비어 있을 때만 [가상] 표시로 채움) */
  const addSample = () => {
    const demo = demoWorking();
    let text = "";
    update((x) => {
      const rep = applyTrades(x, demo.transactions, seoulNowIso(), "[가상] 예시 거래");
      demo.complexInfo.forEach((c) => { if (!x.complexInfo.some((i) => i.complexKey === c.complexKey)) x.complexInfo.push(c); });
      if (!x.property.coordinates) x.property.coordinates = { ...demo.property.coordinates!, source: "[가상] 예시 좌표 — 실제 주소와 무관" };
      text = `[가상] ${mergeReportText(rep)} — 실제 판단에 사용하지 마십시오. ‘분석 다시 실행’으로 결과 갱신`;
    });
    setMsg(text);
  };

  const diag = diagnoseTrades(w.transactions);
  const cleanable = diag.identicalGroups.filter((g) => g.cleanable).reduce((a, g) => a + g.keys.length - 1, 0);
  const cleanup = () => {
    const cur = getRec();
    if (!cur) return;
    const at = seoulNowIso();
    const { transactions, removed } = cleanupIdenticalDuplicates(cur.working.transactions, at);
    if (!removed) return;
    const w2 = { ...structuredClone(cur.working), transactions };
    w2.dataLog.push({ at, source: "사용자", detail: `같은 ID·같은 내용 사본 ${removed}건 정리(정리 전 작업본은 버전으로 보관)` });
    setRec({ ...cur, versions: [...cur.versions, { versionNo: cur.versions.length + 1, at, note: "거래 진단 정리 전 자동 보관", working: structuredClone(cur.working) }], working: w2, updatedAt: at });
    setMsg(`같은 내용 사본 ${removed}건 정리 — 정리 전 작업본은 ‘보고서·변경 이력’의 버전으로 보관`);
  };

  // 대표 비교단지 월별 거래 — 결과를 만든 입력 스냅샷 기준
  const snapTx = new Map(input.transactions.map((t) => [t.key, t]));
  const monthly = new Map<string, number>();
  const ws = parseDateValue(m.recentWindow.start);
  if (ws) for (let i = 0; i < m.recentWindow.months; i++) { const t = ws.y * 12 + ws.m - 1 + i; monthly.set(`${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`, 0); }
  m.txRows.filter((x) => x.included).forEach((x) => { const t = snapTx.get(x.key); const k = t?.contractDate.slice(0, 7); if (k && monthly.has(k)) monthly.set(k, monthly.get(k)! + 1); });
  const configured = session?.config.publicData === "configured" || session?.config.geocoder === "configured";
  const lastCol = (w.collections ?? [])[0] ? migrateCollection((w.collections ?? [])[0]) : undefined;
  const complexes = [...m.complexes].sort((a, b) => ORDER[a.status] - ORDER[b.status] || (a.distanceM ?? 1e9) - (b.distanceM ?? 1e9));

  return (
    <Section id="sec-market" title="실거래·비교단지 상세" summary={`거래 ${w.transactions.length}건 · 결과 기준 단지 ${m.complexes.length}곳(대표 ${m.comparables.length}, 확인 필요 ${m.needsCheck.length})`}>
      <div className="toolbar">
        <label className="filebtn">실거래 CSV 가져오기<input type="file" accept=".csv" data-testid="csv-import" onChange={(e: any) => { const f = e.target.files?.[0]; if (f) importCsv(f); e.target.value = ""; }} /></label>
        <button onClick={lookup} disabled={!configured || busy} data-testid="public-lookup">{busy ? "조회 중…" : "주소로 좌표·실거래 자동 조회"}</button>
        {!configured && <Badge tone="muted">공공데이터·지도 키 미설정 — 자동 조회 불가(CSV·직접 입력 사용)</Badge>}
        <button onClick={addSample} data-testid="add-sample">가상 예시 거래 넣기</button>
        <button onClick={() => download(`demo-nearby-trades.csv`, demoCsv(), "text/csv;charset=utf-8")}>가상 예시 CSV 내려받기</button>
      </div>
      {msg && <div className="banner info small" data-testid="market-msg">{msg}</div>}
      {held && (
        <div className="banner warn small" data-testid="lookup-held">
          조회 이후 {held.changed.join("·")}이(가) 바뀌어 이전 조건의 결과(거래 {held.res.trades.length}건) 적용을 보류했습니다. 현재 입력과 조건이 다른 결과입니다.
          <div className="toolbar"><button onClick={() => { applyRes(held.res); setHeld(null); }} data-testid="lookup-apply-anyway">그래도 적용(현재 입력 유지, 거래만 병합)</button><button onClick={() => { setHeld(null); setMsg("보류한 조회 결과를 버렸습니다."); }} data-testid="lookup-discard">버리기</button></div>
        </div>
      )}
      {(diag.identicalGroups.length > 0 || diag.conflictGroups.length > 0) && (
        <div className="banner warn small" data-testid="trade-diagnosis">
          <b>거래 진단</b>: 같은 출처·ID·같은 내용 사본 묶음 {diag.identicalGroups.length}개(정리 가능 {cleanable}건) · 같은 ID에 다른 내용 {diag.conflictGroups.length}개(확인 필요, 자동 정리 안 함). 통계에서 사본은 1건으로, 충돌 묶음은 제외하고 계산합니다.
          {cleanable > 0 && <div className="toolbar"><button onClick={cleanup} data-testid="cleanup-duplicates">같은 내용 사본 정리(정리 전 버전 자동 보관)</button></div>}
        </div>
      )}
      <p className="muted small">같은 자료를 여러 번·다른 순서로 가져와도 같은 거래는 한 번만 집계합니다(식별: 원천 거래 식별자 → 없으면 단지·면적·층·동·계약일·금액이 같은 ‘동조건 묶음’ 단위로 건수·해제 건수만 대사, 입력 순서는 쓰지 않음). 금액만 다른 같은 조건 거래는 자동 정정하지 않고 둘 다 보존해 ‘별도 거래/정정 확인 필요’로 표시합니다. CSV 필수 열: 단지명, 전용면적, 거래금액(만원) 또는 거래금액(원), 계약일 또는 계약년월. 선택 열: 단지코드, 시군구코드, 법정동, 지번, 동, 층, 해제여부, 해제사유발생일, 건축년도, 거래ID, ID출처(거래ID를 발급한 기관·시스템 — 없으면 ‘출처 미지정’으로 보아 ID 값 변경을 자동 반영하지 않음).</p>

      {lastCol && (
        <details className="sub-details" data-testid="collection-report" open={lastCol.trades.status !== "complete" || lastCol.regionDiscovery.status !== "sampled" || lastCol.complexGeocode.status !== "complete"}>
          <summary className="small">최근 공공 API 수집({lastCol.at.slice(0, 16).replace("T", " ")}) — 상태 3가지를 따로 표시</summary>
          <table className="tbl small" data-testid="collection-status">
            <tbody>
              <tr><th>거래 응답 수집·건수 대사</th><td className={lastCol.trades.status === "complete" ? "" : "warn-text"}>거래 응답 수집·건수 대사: {TRADE_STATUS_LABEL[lastCol.trades.status]}</td><td>월 {lastCol.trades.monthsOk}/{lastCol.trades.monthsTotal}{lastCol.trades.capped ? " · 페이지 상한 도달" : ""} · {lastCol.trades.note}</td><td className="muted">미완료면 일부 거래 누락 → 단지별 표본·중위 단가와 대표 비교단지 선정이 달라질 수 있음</td></tr>
              <tr><th>주변 행정구역 탐색</th><td className={lastCol.regionDiscovery.status === "sampled" && !lastCol.regionDiscovery.capped ? "" : "warn-text"}>주변 행정구역 탐색: {REGION_STATUS_LABEL[lastCol.regionDiscovery.status]}</td><td>{lastCol.regionDiscovery.note}</td><td className="muted">빠진 시군구가 있으면 반경 안 단지가 누락돼 대표 비교단지가 가장 가까운 단지가 아닐 수 있음</td></tr>
              <tr><th>단지 좌표 확인</th><td className={lastCol.complexGeocode.status === "complete" ? "" : "warn-text"}>단지 좌표 확인: {GEOCODE_STATUS_LABEL[lastCol.complexGeocode.status]}</td><td>{lastCol.complexGeocode.located}/{lastCol.complexGeocode.total}곳{lastCol.complexGeocode.capped ? " · 상한 도달" : ""}</td><td className="muted">좌표 미확인 단지는 확인 필요 후보로 분리되어 대표 비교단지 선정에서 빠짐</td></tr>
            </tbody>
          </table>
          <p className="small muted">{collectionStatusText(lastCol)}</p>
          <table className="tbl small"><thead><tr><th>시군구</th><th>계약월</th><th>전체 건수</th><th>수집</th><th>페이지</th><th>대사</th></tr></thead>
            <tbody>{lastCol.months.map((x, i) => <tr key={i}><td>{x.lawdCode}</td><td>{x.yearMonth}</td><td>{x.totalCount ?? "확인 불가"}</td><td>{x.collected}</td><td>{x.pagesFetched}/{x.pagesExpected ?? "?"}</td><td>{x.ok ? "일치" : <span className="warn-text">{x.error ?? "미완료"}</span>}</td></tr>)}</tbody></table>
          {lastCol.notes.length > 0 && <ul className="small">{lastCol.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>}
        </details>
      )}

      <h4>단지별 선정 결과 {stale && <Badge tone="bad">이전 결과</Badge>} <span className="muted small">최근 {m.recentWindow.months}개월({m.recentWindow.start}~{m.recentWindow.end}) · {m.areaFilter ? `전용 ${fmtNum(m.areaFilter.minM2, 1)}~${fmtNum(m.areaFilter.maxM2, 1)}㎡` : "면적 필터 없음"} · 반경 {input.options.radiusM.toLocaleString("ko-KR")}m(거리 확인된 단지만) · 준공연도 ±{input.options.buildYearBand}년 · 단지별 {input.options.minComplexTrades}건 이상</span></h4>
      <div className="table-scroll">
        <table className="tbl small" data-testid="complex-table">
          <thead><tr><th>상태</th><th>단지·식별</th><th>준공(출처)</th><th>거리(출처)</th><th>거래 표본</th><th>중위 단가/전용㎡</th><th>사분위</th><th>사유·근거</th><th>거리 입력(m)</th><th>준공연도 입력</th><th>지정</th></tr></thead>
          <tbody>
            {complexes.map((c) => {
              const info = w.complexInfo.find((i) => i.complexKey === c.complexKey);
              return (
                <tr key={c.complexKey} className={c.status === "excluded" ? "excluded" : ""} data-status={c.status}>
                  <td><Badge tone={STATUS[c.status][1]}>{STATUS[c.status][0]}</Badge></td>
                  <td>{c.name}{c.sameNameCount > 1 && <Badge tone="warn">동명 {c.sameNameCount}곳</Badge>}<div className="muted">{c.identityBasis}</div>{c.address && <div className="muted">{c.address}</div>}</td>
                  <td>{c.buildYear ?? "미확인"}<div className="muted">{c.buildYearSource}</div></td>
                  <td>{c.distanceM === null ? <span className="warn-text">미확인</span> : `${Math.round(c.distanceM).toLocaleString("ko-KR")}m`}<div className="muted">{c.distanceSource}</div></td>
                  <td>전체 {c.samples.total} · 해제 {c.samples.cancelled}<br />기간 내 {c.samples.inWindow} · 유사면적 {c.samples.areaMatched}</td>
                  <StatCells s={c.stats} />
                  <td className="wide-cell">{c.status === "selected" ? c.selectionReason : c.reasons.join(", ")}</td>
                  <td><Num label="" integer value={info?.distanceM} onChange={(v) => setInfo(c.complexKey, (i) => { i.distanceM = v; i.distanceSource = v === undefined ? undefined : "사용자 입력 거리"; })} /></td>
                  <td><Num label="" integer value={info?.buildYear} onChange={(v) => setInfo(c.complexKey, (i) => { i.buildYear = v; })} /></td>
                  <td><Select label="" value={info?.userDecision ?? ""} options={[["", "자동"], ["include", "포함(표본·연식 완화)"], ["exclude", "제외"]]} onChange={(v) => setInfo(c.complexKey, (i) => { i.userDecision = (v || undefined) as any; })} /></td>
                </tr>
              );
            })}
            {!complexes.length && <tr><td colSpan={11} className="muted">결과에 거래 자료 없음</td></tr>}
          </tbody>
        </table>
      </div>

      <h4>대표 비교단지 최근 거래 건수(월별)</h4>
      <MonthlyBars data={[...monthly].map(([month, n]) => ({ month, target: n, comparator: 0 }))} single />

      <ObservationPanel rec={rec} update={update} />

      <h4>거래 내역(현재 입력) <span className="muted small">출처: {[...new Set(w.transactions.map((t) => t.source ?? "미기재"))].slice(0, 4).join(", ") || "없음"}</span></h4>
      <div className="toolbar small">
        <Select label="보기" value={filter} options={[["all", "전체"], ["included", "대표 비교 포함"], ["excluded", "제외·미분석"]]} onChange={(v) => { setFilter(v); setPage(0); }} />
        <span>{filtered.length}건 · {curPage + 1}/{pages}쪽</span>
        <button disabled={curPage === 0} onClick={() => setPage(curPage - 1)}>이전</button>
        <button disabled={curPage >= pages - 1} onClick={() => setPage(curPage + 1)}>다음</button>
        {w.transactions.length > 0 && <button className="danger" data-testid="delete-all-tx" onClick={() => { update((x) => { x.transactions = []; x.dataLog.push({ at: seoulNowIso(), source: "사용자", detail: "거래 전체 삭제" }); }); setPage(0); setMsg("거래를 모두 삭제했습니다. 위 결과는 삭제 전 입력 기준(이전 결과)이며, ‘분석 다시 실행’으로 갱신하십시오."); }}>거래 전체 삭제</button>}
      </div>
      <div className="table-scroll">
        <table className="tbl small" data-testid="tx-table">
          <thead><tr><th>단지</th><th>전용㎡</th><th>층</th><th>금액(만원)</th><th>㎡당(만원)</th><th>계약일</th><th>해제·정정</th><th>결과 반영</th><th>사용자 제외 사유</th><th>자료·출처</th></tr></thead>
          <tbody>
            {shown.map((t) => {
              const i = w.transactions.findIndex((x) => x.key === t.key);
              const row = rowByKey.get(t.key);
              return (
                <tr key={t.key} className={row && !row.included ? "excluded" : ""}>
                  <td>{t.complexName}{t.dong ? <div className="muted">{t.dong} {t.jibun ?? ""}</div> : null}</td><td>{fmtNum(t.exclusiveAreaM2)}</td><td>{t.floor ?? "-"}</td><td>{(t.priceKrw / 1e4).toLocaleString("ko-KR")}</td>
                  <td>{fmtNum(t.priceKrw / t.exclusiveAreaM2 / 1e4, 1)}</td><td>{t.contractDate}</td>
                  <td>{t.cancelled ? "해제" : ""}{t.reviewFlag && <div title={t.reviewFlag.note}><Badge tone="warn">{t.reviewFlag.kind === "idConflict" ? "ID 충돌 확인 필요" : t.reviewFlag.kind === "idChangeUnconfirmed" ? "ID 값 변경 보류" : "별도 거래/정정 확인 필요"}</Badge></div>}{t.idKey && ambLive.has(t.idKey) && <div className="muted" data-testid="amb-note">같은 조건 {ambLive.get(t.idKey)!.size}건 중 해제 {ambLive.get(t.idKey)!.cancelled}건(대상 특정 불가)</div>}{t.officialId && <div className="muted">ID {t.officialId}·출처 {t.idScope ?? "미지정"}</div>}{(t.sameKeyCount ?? 1) > 1 && <div className="muted">같은 조건 {t.sameKeyCount}건(구별 불가)</div>}{t.revisions?.length ? <div className="muted">{t.revisions.map((v) => v.change).join(" / ")}</div> : null}</td>
                  <td className="wide-cell">{row ? (row.included ? "포함" : row.reasons.join(", ")) : <span className="warn-text">결과 이후 추가 — 재분석 필요</span>}</td>
                  <td><Text label="" value={t.manualExclusion} onChange={(v) => update((x) => { if (i >= 0) x.transactions[i].manualExclusion = v; })} /></td>
                  <td><ModeBadge mode={t.dataMode} /> <span className="muted">{t.source}</span></td>
                </tr>
              );
            })}
            {!shown.length && <tr><td colSpan={10} className="muted">현재 입력에 거래 없음</td></tr>}
          </tbody>
        </table>
      </div>
      {w.dataLog.length > 0 && (
        <details><summary className="small">자료 조회·가져오기 기록</summary><ul className="small" data-testid="data-log">{w.dataLog.map((d, i) => <li key={i}>{d.at} · {d.source} · {d.detail}</li>)}</ul></details>
      )}
    </Section>
  );
}
