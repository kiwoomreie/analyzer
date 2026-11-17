// 보고서 출력(Markdown). 숫자는 runAnalysis 결과에서만 가져오며 새로 추정하지 않는다.
import type { AnalysisResult, ComplexResult } from "./analysis.ts";
import { APP_NAME, DATA_MODE_LABEL, EVIDENCE_STATUS_LABEL, ORIGIN_LABEL, type AnalysisRecord, type WorkingInputs } from "./model.ts";
import { stableStringify } from "./hash.ts";
import { fmtMan, fmtNum } from "./units.ts";

const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
const dist = (m: number | null) => (m === null ? "미확인" : `${Math.round(m).toLocaleString("ko-KR")}m`);
const yd = (d: number | null) => (d === null ? "-" : `${d > 0 ? "+" : ""}${d}년`);

function header(rec: AnalysisRecord, r: AnalysisResult, title: string): string[] {
  return [
    `# ${title}`, "",
    `- 대상: ${esc(rec.working.property.displayName ? `${rec.working.property.displayName} (${rec.working.property.address})` : rec.working.property.address)}`,
    `- 분석 기준일: ${r.asOf} · 금액 단위: 만원(원 단위 계산) · 면적: 전용㎡ · 입력: ${ORIGIN_LABEL[rec.origin.kind]}`,
    `- 작성: ${APP_NAME} 엔진 ${r.engineVersion} · 입력 해시 ${r.inputHash.slice(0, 12)}`, "",
  ];
}

export function comparablesTable(cs: ComplexResult[]): string[] {
  if (!cs.length) return ["- 비교 가능한 단지 없음"];
  return [
    "| 단지 | 준공(본건 대비) | 거리 | 최근 거래(유사면적) | 거래 면적 | 중위 단가(전용㎡) | 최근 계약 | 선정 이유 | 자료 |",
    "|---|---|---|---|---|---|---|---|---|",
    ...cs.map((c) => `| ${esc(c.name)} | ${c.buildYear ?? "미확인"}(${yd(c.differences.buildYearDiff)}) | ${dist(c.distanceM)} | ${c.recentTrades}건 | ${c.recentAreaMin ? `${fmtNum(c.recentAreaMin, 2)}~${fmtNum(c.recentAreaMax, 2)}㎡` : "-"} | ${fmtMan(c.stats.medianPerM2)} | ${c.latestTrade ?? "-"} | ${esc(c.selectionReason)} | ${c.dataModes.map((m) => DATA_MODE_LABEL[m]).join("·")} |`),
  ];
}

export function reportSummary(rec: AnalysisRecord, r: AnalysisResult): string {
  const L = header(rec, r, "아파트 입지·가격 검토 요약 (1페이지)");
  L.push("## 1. 입지 변화");
  if (!r.summary.location.length) L.push("- 입력된 입지 사건 없음");
  r.summary.location.forEach((l) => L.push(`- ${esc(l.text)}${l.detail ? `  \n  ${esc(l.detail)}` : ""}`));
  L.push("", "## 2. 가격 영향과 근거");
  L.push(`- 검토가격 비교: ${r.price.text}`, `- ${r.summary.price.comparables}`, `- ${r.summary.price.observed}`, `- ${r.summary.price.prepricing}`, `- ${r.summary.price.causal}`, `- 기준: ${r.summary.price.basis}`, "");
  L.push(...comparablesTable(r.market.comparables));
  L.push("", "## 3. 주요 불확실성");
  if (!r.summary.uncertainties.length) L.push("- 자료 범위 내 주요 항목 없음");
  r.summary.uncertainties.forEach((f) => L.push(`- [${f.level === "high" ? "높음" : "중간"}] ${esc(f.text)}`));
  if (r.missing.length) L.push("", "## 보완하면 추가로 분석되는 항목", ...r.missing.map((m) => `- ${m.label}: ${m.affects}`));
  L.push("", "> 관찰된 변화·비교 차이는 인과효과가 아님. 적정가격·예상 상승률을 산정하지 않았음.", "", "---", "", appendix(rec, r));
  return L.join("\n");
}

function appendix(rec: AnalysisRecord, r: AnalysisResult): string {
  const w = rec.working;
  const L = ["## 근거 부록", "", "### A. 근거 자료", "", "| 발행기관 | 문서명 | 발표일 | 확인일 | 페이지·절 | 확인한 사실 | 상태 | 자료 |", "|---|---|---|---|---|---|---|---|"];
  if (!w.evidence.length) L.push("| - | 등록된 근거 없음 | | | | | | |");
  w.evidence.forEach((e) => L.push(`| ${esc(e.publisher)} | ${esc(e.title)}${e.sourceRef ? ` (${esc(e.sourceRef)})` : ""} | ${e.publishedOn ?? "-"} | ${e.checkedOn ?? "-"} | ${esc(e.pageOrSection ?? "-")} | ${esc(e.fact)} | ${EVIDENCE_STATUS_LABEL[e.status]} | ${DATA_MODE_LABEL[e.dataMode]} |`));
  L.push("", "### B. 입지 사건 일정", "");
  r.events.forEach((e) => {
    L.push(`**${esc(e.name)}** (${e.categoryLabel}, ${DATA_MODE_LABEL[e.dataMode]}) — ${e.stageAsOf}`, "", "| 구분 | 예정/실제 | 적용일 | 발표일 | 수집일 | 기준일 반영 |", "|---|---|---|---|---|---|");
    e.timeline.forEach((t) => L.push(`| ${t.type} | ${t.status} | ${t.date} | ${t.announcedOn} | ${t.collectedOn} | ${t.knownAsOf ? "반영" : "제외(기준일 이후 정보)"} |`));
    L.push("");
  });
  const m = r.market;
  L.push("### C. 비교거래 범위·출처", "",
    `- 최근 ${m.recentWindow.months}개월(${m.recentWindow.start}~${m.recentWindow.end}), 유사면적 ${m.areaFilter ? `${fmtNum(m.areaFilter.minM2, 1)}~${fmtNum(m.areaFilter.maxM2, 1)}㎡` : "필터 없음(전용면적 미입력)"}, 반경 ${w.options.radiusM.toLocaleString("ko-KR")}m, 준공연도 차이 ${w.options.buildYearBand}년 이내`,
    `- 거래 ${w.transactions.length}건 중 유효 ${m.validTrades}건, 대표 비교단지 포함 ${m.pooled.count}건 · 제외 사유: ${Object.entries(m.excludedTrades).map(([k, v]) => `${k} ${v}`).join(", ") || "없음"}`,
    `- 출처: ${m.sources.join(", ") || "없음"}`,
    "- 동일 단지·면적·유사층 거래를 같은 호실의 반복거래로 보지 않음. 거래 건수가 많아도 통계적 타당성을 보장하지 않음.", "",
    "| 제외·순위 밖 단지 | 사유 |", "|---|---|",
    ...m.complexes.filter((c) => c.status !== "selected").map((c) => `| ${esc(c.name)} | ${esc(c.reasons.join(", "))} |`));
  if (w.dataLog.length) L.push("", "### D. 자료 조회 기록", "", ...w.dataLog.map((d) => `- ${d.at} · ${esc(d.source)} · ${esc(d.detail)}`));
  return L.join("\n");
}

export function reportQuestions(rec: AnalysisRecord, r: AnalysisResult): string {
  const L = header(rec, r, "영업부서·시행사 확인 질문 초안");
  const q: string[] = [];
  r.missing.forEach((m) => q.push(`${m.label} 자료 제공 가능 여부 (${m.affects}에 필요)`));
  r.events.forEach((e) => {
    if (!e.evidence.confirmedOfficial) q.push(`「${e.name}」의 공식 고시·승인 문서(문서번호·페이지 포함)`);
    if (e.delayCount) q.push(`「${e.name}」의 지연 사유와 최신 공식 일정의 근거`);
    if (e.category !== "supply" && e.access.walkMinutes === null) q.push(`본건에서 「${e.name}」까지 실제 보행 경로·소요시간 자료`);
    if (e.prepricing?.assessment === "possible") q.push(`검토가격에 「${e.name}」 기대를 반영했는지, 반영했다면 방법과 근거`);
  });
  if (r.price.position === "above") q.push(`검토가격이 대표 비교단지 단가 범위를 넘는 근거(상품·브랜드·층·향·신축 여부 등)`);
  r.market.comparables.filter((c) => c.distanceM === null).forEach((c) => q.push(`비교단지 「${c.name}」의 위치(본건과의 거리) 확인`));
  r.supply.rows.filter((s) => s.timing === "yes").forEach((s) => q.push(`경쟁 공급 「${s.name}」(${s.stage})과의 가격대·상품 차별화 근거`));
  L.push(...(q.length ? q.map((x, i) => `${i + 1}. ${x}`) : ["- 추가 확인 질문 없음"]));
  return L.join("\n");
}

export function reportDraft(rec: AnalysisRecord, r: AnalysisResult): string {
  const L = header(rec, r, "아파트 입지·가격 검토 보고서 초안");
  const w = rec.working;
  L.push("## 1. 검토 대상");
  L.push(`- 본건 소재지는 ${w.property.address}임.`);
  L.push(`- 비교 타입 전용면적은 ${r.property.exclusiveAreaM2 ? `${fmtNum(r.property.exclusiveAreaM2)}㎡(${fmtNum(r.property.exclusivePyeong)}전용평)` : "미입력"}이며, 준공(예정)연도는 ${r.property.buildYear ?? "미입력"}임.`);
  L.push(`- 검토가격은 ${r.price.reviewText}(기준일 ${r.price.basisDate})임.${r.price.reviewPerM2 !== null ? ` 전용㎡당 ${fmtMan(r.price.reviewPerM2)}, 전용평당 ${fmtMan(r.price.reviewPerPyeong)}에 해당함.` : ""}`);
  L.push("", "## 2. 입지 변화");
  if (!r.events.length) L.push("- 검토 대상 입지 사건이 입력되지 않았음.");
  r.events.forEach((e) => {
    L.push(`- 「${e.name}」(${e.categoryLabel})은 기준일 현재 ${e.stageAsOf} 상태임.${e.expectedTarget ? ` ${e.expectedTargetStatus === "actual" ? "완료" : "예정"} 시점은 ${e.expectedTarget.raw}임.` : ""}`);
    L.push(`  - 근거 ${e.evidence.total}건 중 확인된 사실은 ${e.evidence.byStatus.confirmed}건임.${e.evidence.confirmedOfficial ? "" : " 공식 자료로 확인되지 않았음."}`);
    e.scheduleGaps.forEach((g) => L.push(`  - 일정은 ${g.text}임.`));
    if (e.category !== "supply") L.push(`  - 접근성: ${e.access.text}임.`);
  });
  L.push("", "## 3. 실거래 비교");
  L.push(`- ${r.summary.price.comparables}임.`);
  r.market.comparables.forEach((c) => L.push(`  - ${c.name}: ${c.selectionReason}, 중위 ${fmtMan(c.stats.medianPerM2)}/전용㎡임.`));
  L.push(`- ${r.price.text.replace(/\.$/, "")}임.`);
  L.push(`- ${r.observed.text.replace(/\.$/, "")}임.`);
  r.events.filter((e) => e.prepricing).forEach((e) => L.push(`- 「${e.name}」 선반영: ${e.prepricing!.text.replace(/\.$/, "")}임.`));
  L.push(`- ${r.causalEffect.text}임.`);
  L.push("", "## 4. 주변 입주 물량");
  L.push(`- ${r.supply.text}임.`);
  L.push("", "## 5. 주요 불확실성");
  r.flags.filter((f) => f.level !== "low").forEach((f) => L.push(`- ${f.text.replace(/\.$/, "")}임.`));
  L.push("", `> 출처·기준: ${r.summary.price.basis}`);
  return L.join("\n");
}

export interface DiffRow { path: string; before: string; after: string }

function flatten(v: unknown, prefix: string, out: Map<string, string>) {
  if (v === null || v === undefined) return;
  if (Array.isArray(v)) {
    v.forEach((item, i) => flatten(item, `${prefix}[${item && typeof item === "object" && "key" in item ? String((item as any).key) : item && typeof item === "object" && "complexKey" in item ? String((item as any).complexKey) : i}]`, out));
    if (!v.length) out.set(prefix, "(없음)");
    return;
  }
  if (typeof v === "object") { for (const [k, c] of Object.entries(v as object)) if (k !== "text") flatten(c, prefix ? `${prefix}.${k}` : k, out); return; }
  out.set(prefix, String(v));
}

export function diffWorking(a: WorkingInputs, b: WorkingInputs): DiffRow[] {
  const ma = new Map<string, string>(), mb = new Map<string, string>();
  flatten(a, "", ma);
  flatten(b, "", mb);
  return [...new Set([...ma.keys(), ...mb.keys()])].sort().filter((k) => ma.get(k) !== mb.get(k)).map((k) => ({ path: k, before: ma.get(k) ?? "(없음)", after: mb.get(k) ?? "(없음)" }));
}

export function reportChanges(rec: AnalysisRecord, r: AnalysisResult, compare?: { leftLabel: string; left: WorkingInputs; rightLabel: string; right: WorkingInputs }): string {
  const L = header(rec, r, "분석 버전 간 변경표");
  const c = compare ?? { leftLabel: "최초 입력", left: rec.original.working, rightLabel: "현재 작업본", right: rec.working };
  const rows = diffWorking(c.left, c.right);
  L.push(`비교: **${c.leftLabel}** → **${c.rightLabel}** (${rows.length}개 항목 변경)`, "", "| 항목 | 이전 | 이후 |", "|---|---|---|");
  if (!rows.length) L.push("| (변경 없음) | | |");
  rows.slice(0, 500).forEach((d) => L.push(`| ${esc(d.path)} | ${esc(d.before)} | ${esc(d.after)} |`));
  if (rows.length > 500) L.push(`| … 외 ${rows.length - 500}개 | | |`);
  L.push("", "## 분석 실행 이력", "", "| 실행 | 시각 | 계기 | 입력 해시 |", "|---|---|---|---|");
  rec.runs.forEach((run) => L.push(`| #${run.runNo} | ${run.at} | ${run.trigger === "manual" ? "수동" : "생성 시 자동"} | ${run.inputHash.slice(0, 12)} |`));
  L.push("", "## 저장 버전", "", ...(rec.versions.length ? rec.versions.map((v) => `- v${v.versionNo} ${v.at} — ${esc(v.note || "메모 없음")}`) : ["- 저장된 버전 없음"]));
  return L.join("\n");
}

export function toPlainText(md: string): string {
  return md.replace(/^#+\s*/gm, "").replace(/\*\*/g, "").replace(/^> /gm, "").replace(/ {2}\n/g, "\n");
}

export function sameContent(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}
