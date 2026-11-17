import { useState } from "react";
import { Badge, DateText, ModeBadge, MonthlyBars, Num, Section, Select, Text } from "../components.tsx";
import type { SectionProps } from "../AnalysisView.tsx";
import { fetchAptTrades } from "../api.ts";
import { newKey } from "../../shared/model.ts";
import { transactionsFromCsv } from "../../shared/importers.ts";
import { fmtMan, fmtNum, fmtPct, fmtPp } from "../../shared/units.ts";
import type { Stats } from "../../shared/analysis.ts";

const PAGE = 50;

function StatRow({ label, s }: { label: string; s: Stats }) {
  return (
    <tr>
      <td>{label}</td><td>{s.count}</td><td>{s.complexes}</td>
      {s.count ? <><td>{fmtMan(s.medianPerM2)}</td><td>{fmtMan(s.p25PerM2)} ~ {fmtMan(s.p75PerM2)}</td><td>{fmtMan(s.meanPerM2)}</td></> : <td colSpan={3} className="muted">유효 표본 없음 — 표시하지 않음</td>}
    </tr>
  );
}

export function CompsSection({ rec, update, session }: SectionProps) {
  const w = rec.working;
  const r = rec.runs[rec.runs.length - 1].result;
  const c = r.comps;
  const [filter, setFilter] = useState<"all" | "included" | "excluded" | "target" | "comparator">("all");
  const [page, setPage] = useState(0);
  const [msg, setMsg] = useState("");
  const rowByKey = new Map((c?.rows ?? []).map((x) => [x.key, x]));
  const filtered = w.transactions.filter((t) => {
    const row = rowByKey.get(t.key);
    if (filter === "included") return row?.included;
    if (filter === "excluded") return row && !row.included;
    if (filter === "target" || filter === "comparator") return t.group === filter;
    return true;
  });
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const shown = filtered.slice(page * PAGE, page * PAGE + PAGE);

  const importCsv = async (f: File) => {
    if (f.size > 4 * 1024 * 1024) return setMsg("4MB 초과");
    const res = transactionsFromCsv(await f.text(), "user");
    if (!res.ok) return setMsg(`거절: ${res.errors.slice(0, 3).join(" / ")}`);
    update((x) => { x.transactions.push(...res.items); });
    setMsg(`비교거래 ${res.items.length}건 가져옴${res.skipped ? `, ${res.skipped}행 건너뜀` : ""}. ‘분석 다시 실행’으로 결과 갱신`);
  };

  const fetchPublic = async () => {
    if (!w.property.lawdCode) return setMsg("시군구 코드(①)를 먼저 입력");
    const [y, m] = w.asOf.split("-").map(Number);
    const months = Array.from({ length: 6 }, (_, i) => { const t = y * 12 + m - 1 - i; return `${Math.floor(t / 12)}${String((t % 12) + 1).padStart(2, "0")}`; });
    try {
      const res: any = await fetchAptTrades(w.property.lawdCode, months);
      update((x) => { x.transactions.push(...res.items); });
      setMsg(`공식 API 응답 ${res.items.length}건${res.errors?.length ? ` · 오류 ${res.errors.join(", ")}` : ""}`);
    } catch (e) { setMsg((e as any).body?.message ?? (e as Error).message); }
  };

  return (
    <Section id="sec-comps" title="③ 거래·비교 분석" summary={c ? `포함 ${c.target.all.count + c.comparator.all.count}건 / 전체 ${w.transactions.length}건 · ${c.observed.text}` : "비교거래 없음"}>
      <div className="toolbar">
        <label className="filebtn">CSV 가져오기<input type="file" accept=".csv" data-testid="csv-import" onChange={(e: any) => { const f = e.target.files?.[0]; if (f) importCsv(f); e.target.value = ""; }} /></label>
        <button onClick={() => update((x) => { x.transactions.push({ key: newKey("tx"), complexName: "단지명", exclusiveAreaM2: x.property.exclusiveAreaM2 ?? 84, priceKrw: 1, contractDate: x.asOf, cancelled: false, group: "target", dataMode: "user" }); })}>거래 직접 추가</button>
        <button onClick={fetchPublic} disabled={session?.config.publicData !== "configured"} title={session?.config.publicData !== "configured" ? "공공데이터 키 미설정" : ""}>공식 실거래 조회(최근 6개월)</button>
        {session?.config.publicData !== "configured" && <Badge tone="muted">공공데이터 키 미설정</Badge>}
        {msg && <span className="small" data-testid="comps-msg">{msg}</span>}
      </div>
      <p className="muted small">CSV 필수 열: 단지명, 전용면적, 거래금액(만원) 또는 거래금액(원), 계약일(YYYY-MM-DD) 또는 계약년월. 선택: 층, 해제여부, 해제사유발생일, 권역(본건/비교), 건축년도. 공개 자료는 취소·정정·신고 지연이 있을 수 있으며 분석 기준일의 자료 상태로 보관됩니다.</p>

      {c && (
        <div className="card sub">
          <div className="small">기준: <b>{c.anchor.label}</b> {c.anchor.date.raw} · 비교기간 {c.window.start.raw} ~ {c.window.end.raw}(전 {c.window.monthsBefore}·후 {c.window.monthsAfter}개월{c.window.endCappedByAsOf ? ", 기준일까지로 제한" : ""}) · 면적 {c.areaBand ? `${fmtNum(c.areaBand.minM2, 1)}~${fmtNum(c.areaBand.maxM2, 1)}㎡` : "필터 없음"}</div>
          <div className="small">자료 범위 {c.dataCoverage.firstMonth ?? "없음"} ~ {c.dataCoverage.lastMonth ?? "없음"} {c.dataCoverage.shortOfWindow && <Badge tone="warn">비교기간보다 짧음 — 빈 기간을 채우지 않음</Badge>} · 거래 없는 달 {c.emptyMonths}개</div>
          <div className="small">제외 사유: {Object.entries(c.exclusionCounts).map(([k, v]) => `${k} ${v}건`).join(" · ") || "없음"}</div>
          <table className="tbl small" data-testid="comps-stats">
            <thead><tr><th>구분</th><th>건수</th><th>단지 수</th><th>중위 ㎡당</th><th>사분위 범위</th><th>평균 ㎡당</th></tr></thead>
            <tbody>
              <StatRow label="본건 권역 전체" s={c.target.all} />
              <StatRow label="본건 권역 사건 전" s={c.target.pre} />
              <StatRow label="본건 권역 사건 후" s={c.target.post} />
              <StatRow label="비교 권역 전체" s={c.comparator.all} />
              <StatRow label="비교 권역 사건 전" s={c.comparator.pre} />
              <StatRow label="비교 권역 사건 후" s={c.comparator.post} />
            </tbody>
          </table>
          <dl className="kv small">
            <dt>관찰된 변화</dt><dd data-testid="observed">{c.observed.text}</dd>
            <dt>비교대상과의 차이</dt><dd>{c.observed.diffPp !== null ? `상승률 차이 ${fmtPp(c.observed.diffPp)}, 상대 종가지수 격차 ${fmtPct(c.observed.relativeGapPct, 2)}` : "미산출"}</dd>
            <dt>제시 가격과의 차이</dt><dd data-testid="proposed-diff">{c.proposedComparison.text}</dd>
            <dt>인과 추정 효과</dt><dd>미추정</dd>
          </dl>
          <p className="muted small">같은 단지·면적·유사층 거래를 같은 호실의 반복거래로 보지 않습니다. 건수가 많아도 통계적 타당성이 보장되지 않습니다. 발표·착공·개통 단계별 상승률이나 여러 사건의 효과를 합산하지 않습니다.</p>
          <MonthlyBars data={c.monthly} />
          <details><summary className="small">월별 표 보기</summary>
            <table className="tbl small"><thead><tr><th>월</th><th>본건 권역</th><th>비교 권역</th><th>본건 중위 ㎡당</th></tr></thead>
              <tbody>{c.monthly.map((m) => <tr key={m.month}><td>{m.month}</td><td>{m.target}</td><td>{m.comparator}</td><td>{m.targetMedianPerM2 === null ? "-" : fmtMan(m.targetMedianPerM2)}</td></tr>)}</tbody></table>
          </details>
        </div>
      )}

      <h4>비교거래 목록</h4>
      <div className="toolbar small">
        <Select label="보기" value={filter} options={[["all", "전체"], ["included", "포함"], ["excluded", "제외"], ["target", "본건 권역"], ["comparator", "비교 권역"]]} onChange={(v) => { setFilter(v); setPage(0); }} />
        <span>{filtered.length}건 · {page + 1}/{pages}쪽</span>
        <button disabled={page === 0} onClick={() => setPage(page - 1)}>이전</button>
        <button disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>다음</button>
        {w.transactions.length > 0 && <button className="danger" onClick={() => update((x) => { x.transactions = []; })}>거래 전체 삭제</button>}
      </div>
      <table className="tbl small" data-testid="tx-table">
        <thead><tr><th>단지</th><th>전용㎡</th><th>층</th><th>금액</th><th>계약일</th><th>해제</th><th>권역</th><th>포함 여부·사유</th><th>사용자 제외 사유</th><th>자료</th></tr></thead>
        <tbody>
          {shown.map((t) => {
            const i = w.transactions.findIndex((x) => x.key === t.key);
            const row = rowByKey.get(t.key);
            return (
              <tr key={t.key} className={row && !row.included ? "excluded" : ""}>
                <td>{t.complexName}</td><td>{fmtNum(t.exclusiveAreaM2)}</td><td>{t.floor ?? "-"}</td><td>{fmtMan(t.priceKrw, 0)}</td><td>{t.contractDate}</td>
                <td>{t.cancelled ? "해제" : ""}</td><td>{t.group === "target" ? "본건" : "비교"}</td>
                <td>{row ? (row.included ? "포함" : row.reasons.join(", ")) : "재실행 필요"}</td>
                <td><Text label="" value={t.manualExclusion} onChange={(v) => update((x) => { x.transactions[i].manualExclusion = v; })} /></td>
                <td><ModeBadge mode={t.dataMode} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h4>지수 비교 <span className="muted small">입력한 두 지수의 관찰된 차이(인과효과 아님)</span></h4>
      <table className="tbl small">
        <thead><tr><th>이름</th><th>기간</th><th>대상 시작→끝</th><th>비교 시작→끝</th><th>출처</th><th>결과</th><th /></tr></thead>
        <tbody>
          {w.indexComparisons.map((ic, i) => {
            const res = r.indexComparisons.find((x) => x.key === ic.key);
            return (
              <tr key={ic.key}>
                <td><Text label="" value={ic.label} onChange={(v) => update((x) => { x.indexComparisons[i].label = v ?? ""; })} /></td>
                <td><DateText label="" value={ic.periodStart} onChange={(v) => update((x) => { x.indexComparisons[i].periodStart = v; })} /><DateText label="" value={ic.periodEnd} onChange={(v) => update((x) => { x.indexComparisons[i].periodEnd = v; })} /></td>
                <td><Num label="" value={ic.targetStart} onChange={(v) => v !== undefined && update((x) => { x.indexComparisons[i].targetStart = v; })} /><Num label="" value={ic.targetEnd} onChange={(v) => v !== undefined && update((x) => { x.indexComparisons[i].targetEnd = v; })} /></td>
                <td><Num label="" value={ic.comparatorStart} onChange={(v) => v !== undefined && update((x) => { x.indexComparisons[i].comparatorStart = v; })} /><Num label="" value={ic.comparatorEnd} onChange={(v) => v !== undefined && update((x) => { x.indexComparisons[i].comparatorEnd = v; })} /></td>
                <td><Text label="" value={ic.source} onChange={(v) => update((x) => { x.indexComparisons[i].source = v ?? ""; })} /> <ModeBadge mode={ic.dataMode} /></td>
                <td data-testid={`index-result-${i}`}>{res ? <>상승률 차이 {fmtPp(res.diffPp, 1)} · 상대 격차 {fmtPct(res.relativeGapPct, 4)}</> : "재실행 필요"}</td>
                <td><button className="link" onClick={() => update((x) => { x.indexComparisons.splice(i, 1); })}>삭제</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <button onClick={() => update((x) => { x.indexComparisons.push({ key: newKey("idx"), label: "지수 비교", targetStart: 100, targetEnd: 100, comparatorStart: 100, comparatorEnd: 100, source: "출처 입력", dataMode: "user" }); })}>지수 비교 추가</button>
    </Section>
  );
}
