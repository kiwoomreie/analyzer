import { useState } from "react";
import { Badge, ModeBadge, MonthlyBars, Num, Section, Select, Text } from "../components.tsx";
import type { SectionProps } from "../AnalysisView.tsx";
import { lookupPublicData } from "../api.ts";
import { complexKeyOf, type ComplexInfo } from "../../shared/model.ts";
import { transactionsFromCsv } from "../../shared/importers.ts";
import { parseDateValue, seoulNowIso } from "../../shared/dates.ts";
import { fmtMan, fmtNum } from "../../shared/units.ts";
import type { Stats } from "../../shared/analysis.ts";

const PAGE = 50;

function StatCells({ s }: { s: Stats }) {
  return s.count ? <><td>{s.count}</td><td>{fmtMan(s.medianPerM2)}</td><td>{fmtMan(s.p25PerM2)} ~ {fmtMan(s.p75PerM2)}</td></> : <><td>0</td><td colSpan={2} className="muted">유효 표본 없음 — 표시하지 않음</td></>;
}

export function MarketSection({ rec, update, session }: SectionProps) {
  const w = rec.working;
  const r = rec.runs[rec.runs.length - 1].result;
  const m = r.market;
  const [filter, setFilter] = useState<"all" | "included" | "excluded">("all");
  const [page, setPage] = useState(0);
  const [msg, setMsg] = useState("");
  const rowByKey = new Map(m.txRows.map((x) => [x.key, x]));
  const filtered = w.transactions.filter((t) => filter === "all" || (filter === "included" ? rowByKey.get(t.key)?.included : !rowByKey.get(t.key)?.included));
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const shown = filtered.slice(page * PAGE, page * PAGE + PAGE);

  const setInfo = (ck: string, fn: (i: ComplexInfo) => void) => update((x) => {
    let i = x.complexInfo.find((c) => c.complexKey === ck);
    if (!i) { i = { complexKey: ck }; x.complexInfo.push(i); }
    fn(i);
  });

  const importCsv = async (f: File) => {
    if (f.size > 4 * 1024 * 1024) return setMsg("4MB 초과 — 거절");
    const res = transactionsFromCsv(await f.text(), "user", `사용자 CSV(${f.name.slice(0, 60)})`);
    if (!res.ok) return setMsg(`거절: ${res.errors.slice(0, 3).join(" / ")}`);
    update((x) => { x.transactions.push(...res.items); x.dataLog.push({ at: seoulNowIso(), source: `사용자 CSV(${f.name.slice(0, 60)})`, detail: `거래 ${res.items.length}건${res.skipped ? `, ${res.skipped}행 건너뜀` : ""}` }); });
    setMsg(`거래 ${res.items.length}건 가져옴${res.skipped ? `, ${res.skipped}행 건너뜀` : ""} — ‘분석 다시 실행’으로 결과 갱신`);
  };

  const lookup = async () => {
    try {
      const res = await lookupPublicData({ address: w.property.address, lawdCode: w.property.lawdCode, asOf: w.asOf, months: w.options.recentMonths });
      update((x) => {
        if (res.geocode && !x.property.coordinates) x.property.coordinates = { lat: res.geocode.lat, lng: res.geocode.lng, source: res.geocode.source };
        if (res.geocode?.lawdCode && !x.property.lawdCode) x.property.lawdCode = res.geocode.lawdCode;
        x.transactions.push(...res.trades);
        x.dataLog.push({ at: seoulNowIso(), source: "공공·지도 API", detail: res.log.join(" / ") });
      });
      setMsg(res.log.join(" / "));
    } catch (e) { setMsg((e as any).body?.message ?? (e as Error).message); }
  };

  // 대표 비교단지 월별 거래(최근 기간)
  const sel = new Set(m.comparables.map((c) => c.complexKey));
  const monthly = new Map<string, number>();
  for (let cur = parseDateValue(m.recentWindow.start)!, i = 0; i < m.recentWindow.months; i++) {
    const t = cur.y * 12 + cur.m - 1 + i;
    monthly.set(`${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`, 0);
  }
  m.txRows.filter((x) => x.included).forEach((x) => { const t = w.transactions.find((y) => y.key === x.key)!; const k = t.contractDate.slice(0, 7); if (monthly.has(k)) monthly.set(k, monthly.get(k)! + 1); });
  const configured = session?.config.publicData === "configured" || session?.config.geocoder === "configured";

  return (
    <Section id="sec-market" title="실거래·비교단지 상세" summary={`거래 ${w.transactions.length}건 · 단지 ${m.complexes.length}곳 · 대표 ${m.comparables.length}곳`}>
      <div className="toolbar">
        <label className="filebtn">실거래 CSV 가져오기<input type="file" accept=".csv" data-testid="csv-import" onChange={(e: any) => {  const f = e.target.files?.[0]; if (f) importCsv(f); e.target.value = ""; }} /></label>
        <button onClick={lookup} disabled={!configured} data-testid="public-lookup">주소로 좌표·실거래 자동 조회</button>
        {!configured && <Badge tone="muted">공공데이터·지도 키 미설정 — 자동 조회 불가</Badge>}
        {msg && <span className="small" data-testid="market-msg">{msg}</span>}
      </div>
      <p className="muted small">CSV 필수 열: 단지명, 전용면적, 거래금액(만원) 또는 거래금액(원), 계약일(YYYY-MM-DD) 또는 계약년월. 선택: 법정동, 층, 해제여부, 해제사유발생일, 건축년도. 공개 실거래는 취소·정정·신고 지연이 있을 수 있으며 가져온 시점의 자료로 보관됩니다.</p>

      <h4>단지별 선정 결과 <span className="muted small">기준: 최근 {m.recentWindow.months}개월({m.recentWindow.start}~{m.recentWindow.end}) · {m.areaFilter ? `전용 ${fmtNum(m.areaFilter.minM2, 1)}~${fmtNum(m.areaFilter.maxM2, 1)}㎡` : "면적 필터 없음"} · 반경 {w.options.radiusM.toLocaleString("ko-KR")}m · 준공연도 ±{w.options.buildYearBand}년 · 단지별 {w.options.minComplexTrades}건 이상</span></h4>
      <table className="tbl small" data-testid="complex-table">
        <thead><tr><th>상태</th><th>단지</th><th>준공(출처)</th><th>거리(출처)</th><th>최근 거래</th><th>중위 단가/전용㎡</th><th>사분위</th><th>사유</th><th>거리 입력(m)</th><th>준공연도 입력</th><th>지정</th></tr></thead>
        <tbody>
          {m.complexes.sort((a, b) => (a.status === "selected" ? 0 : a.status === "eligible" ? 1 : 2) - (b.status === "selected" ? 0 : b.status === "eligible" ? 1 : 2)).map((c) => {
            const info = w.complexInfo.find((i) => i.complexKey === c.complexKey);
            return (
              <tr key={c.complexKey} className={c.status === "excluded" ? "excluded" : ""}>
                <td>{c.status === "selected" ? <Badge tone="ok">대표</Badge> : c.status === "eligible" ? <Badge tone="muted">후보</Badge> : <Badge tone="muted">제외</Badge>}</td>
                <td>{c.name}{c.dong ? <div className="muted">{c.dong}</div> : null}</td>
                <td>{c.buildYear ?? "미확인"}<div className="muted">{c.buildYearSource}</div></td>
                <td>{c.distanceM === null ? "미확인" : `${Math.round(c.distanceM).toLocaleString("ko-KR")}m`}<div className="muted">{c.distanceSource}</div></td>
                <StatCells s={{ ...c.stats, count: c.recentTrades } as Stats} />
                <td>{c.status === "selected" ? c.selectionReason : c.reasons.join(", ")}</td>
                <td><Num label="" integer value={info?.distanceM} onChange={(v) => setInfo(c.complexKey, (i) => { i.distanceM = v; i.distanceSource = v === undefined ? undefined : "사용자 입력"; })} /></td>
                <td><Num label="" integer value={info?.buildYear} onChange={(v) => setInfo(c.complexKey, (i) => { i.buildYear = v; })} /></td>
                <td><Select label="" value={info?.userDecision ?? ""} options={[["", "자동"], ["include", "포함"], ["exclude", "제외"]]} onChange={(v) => setInfo(c.complexKey, (i) => { i.userDecision = (v || undefined) as any; })} /></td>
              </tr>
            );
          })}
          {!m.complexes.length && <tr><td colSpan={11} className="muted">거래 자료 없음</td></tr>}
        </tbody>
      </table>

      <h4>대표 비교단지 최근 거래 건수(월별)</h4>
      <MonthlyBars data={[...monthly].map(([month, n]) => ({ month, target: n, comparator: 0 }))} single />

      <h4>입지 사건 전후 관찰 <span className="muted small">대표 비교단지의 유사면적 거래 · 인과효과 아님</span></h4>
      <table className="tbl small">
        <thead><tr><th>기준</th><th>기간</th><th>구분</th><th>건수</th><th>중위 단가/전용㎡</th><th>사분위</th></tr></thead>
        <tbody>
          <tr><td rowSpan={2}>{r.observed.anchor}</td><td rowSpan={2}>{r.observed.window}</td><td>발표 전</td><StatCells s={r.observed.pre} /></tr>
          <tr><td>발표 후</td><StatCells s={r.observed.post} /></tr>
        </tbody>
      </table>
      <p className="small">{r.observed.text}</p>
      {r.events.filter((e) => e.prepricing).map((e) => <p key={e.key} className="small"><b>{e.name} 선반영</b>: {e.prepricing!.text}</p>)}

      <h4>거래 내역 <span className="muted small">출처: {m.sources.join(", ") || "없음"}</span></h4>
      <div className="toolbar small">
        <Select label="보기" value={filter} options={[["all", "전체"], ["included", "대표 비교 포함"], ["excluded", "제외"]]} onChange={(v) => { setFilter(v); setPage(0); }} />
        <span>{filtered.length}건 · {page + 1}/{pages}쪽</span>
        <button disabled={page === 0} onClick={() => setPage(page - 1)}>이전</button>
        <button disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>다음</button>
        {w.transactions.length > 0 && <button className="danger" onClick={() => update((x) => { x.transactions = []; })}>거래 전체 삭제</button>}
      </div>
      <table className="tbl small" data-testid="tx-table">
        <thead><tr><th>단지</th><th>전용㎡</th><th>층</th><th>금액(만원)</th><th>㎡당(만원)</th><th>계약일</th><th>해제</th><th>포함 여부·사유</th><th>사용자 제외 사유</th><th>자료·출처</th></tr></thead>
        <tbody>
          {shown.map((t) => {
            const i = w.transactions.findIndex((x) => x.key === t.key);
            const row = rowByKey.get(t.key);
            return (
              <tr key={t.key} className={row && !row.included ? "excluded" : ""}>
                <td>{t.complexName}</td><td>{fmtNum(t.exclusiveAreaM2)}</td><td>{t.floor ?? "-"}</td><td>{(t.priceKrw / 1e4).toLocaleString("ko-KR")}</td>
                <td>{row?.perM2 ? fmtNum(row.perM2 / 1e4, 1) : "-"}</td><td>{t.contractDate}</td><td>{t.cancelled ? "해제" : ""}</td>
                <td>{row ? (row.included ? "포함" : row.reasons.join(", ")) : "재실행 필요"}</td>
                <td><Text label="" value={t.manualExclusion} onChange={(v) => update((x) => { x.transactions[i].manualExclusion = v; })} /></td>
                <td><ModeBadge mode={t.dataMode} /> <span className="muted">{t.source}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {w.dataLog.length > 0 && (
        <details><summary className="small">자료 조회·가져오기 기록</summary><ul className="small">{w.dataLog.map((d, i) => <li key={i}>{d.at} · {d.source} · {d.detail}</li>)}</ul></details>
      )}
    </Section>
  );
}

export { complexKeyOf };
