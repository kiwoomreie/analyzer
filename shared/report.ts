// 출력물 4종(Markdown). 숫자는 모두 runAnalysis 결과에서 가져오며 여기서 새로 추정하지 않는다.
import { LABELS } from "./contract.ts";
import type { AnalysisResult } from "./analysis.ts";
import { DATA_MODE_LABEL, EVIDENCE_STATUS_LABEL, ORIGIN_LABEL, type AnalysisRecord, type WorkingInputs } from "./model.ts";
import { stableStringify } from "./hash.ts";
import { fmtEok, fmtMan, fmtNum, fmtPct } from "./units.ts";

const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

function header(rec: AnalysisRecord, r: AnalysisResult, title: string): string[] {
  return [
    `# ${title}`,
    "",
    `- 사업장: ${esc(rec.title)}`,
    `- 분석 기준일: ${r.asOf} · 출처: ${ORIGIN_LABEL[rec.origin.kind]}${rec.origin.sourceLabel ? `(${esc(rec.origin.sourceLabel)})` : ""}`,
    rec.origin.senderCreatedAt ? `- 사본 생성: ${rec.origin.senderCreatedAt} · 수신: ${rec.origin.receivedAt ?? "-"} · 원본 최신 버전 확인: 미확인(자동 동기화 없음)` : `- 생성: ${rec.createdAt}`,
    `- 분석 엔진 ${r.engineVersion} · 입력 해시 ${r.inputHash.slice(0, 12)}`,
    "",
  ];
}

export function reportSummary(rec: AnalysisRecord, r: AnalysisResult): string {
  const L = header(rec, r, "입지 변화·가격영향 검토 요약 (1페이지)");
  if (!r.assetSupported) return [...L, `> ${r.unsupportedMessage}`, ""].join("\n");
  L.push("## 1. 입지 변화");
  if (!r.summary.location.length) L.push("- 입지 사건 미입력");
  r.summary.location.forEach((l) => L.push(`- ${esc(l.text)}${l.detail ? ` — ${esc(l.detail)}` : ""}`));
  L.push("", "## 2. 가격 영향과 근거");
  L.push(`- ${r.summary.price.observed}`, `- ${r.summary.price.comparison}`, `- ${r.summary.price.causal}`, `- ${r.summary.price.stress}`, `- 근거: ${r.summary.price.evidence}`);
  L.push("", "## 3. 주요 불확실성");
  if (!r.summary.uncertainties.length) L.push("- 주요 불확실성 항목 없음(자료 범위 내)");
  r.summary.uncertainties.forEach((f) => L.push(`- [${f.level === "high" ? "높음" : "중간"}] ${esc(f.text)}`));
  if (r.missing.length) L.push("", "## 보완 필요 입력", ...r.missing.map((m) => `- ${m.label}: ${m.affects}`));
  L.push("", "> 관찰된 변화·비교 차이는 인과효과가 아님. 인과 추정 효과는 미추정. 사용자 가정은 전망이 아님.", "", "---", "", appendix(rec, r));
  return L.join("\n");
}

function appendix(rec: AnalysisRecord, r: AnalysisResult): string {
  const w = rec.working;
  const L = ["## 근거 부록", "", "### A. 근거 자료", "", "| 발행기관 | 문서명 | 발표일 | 적용일 | 확인일 | 페이지·절 | 확인한 사실 | 상태 | 자료구분 |", "|---|---|---|---|---|---|---|---|---|"];
  if (!w.evidence.length) L.push("| - | 등록된 근거 없음 | | | | | | | |");
  w.evidence.forEach((e) => L.push(`| ${esc(e.publisher)} | ${esc(e.title)}${e.sourceRef ? ` (${esc(e.sourceRef)})` : ""} | ${e.publishedOn ?? "-"} | ${e.effectiveOn ?? "-"} | ${e.checkedOn ?? "-"} | ${esc(e.pageOrSection ?? "-")} | ${esc(e.fact)} | ${EVIDENCE_STATUS_LABEL[e.status]} | ${DATA_MODE_LABEL[e.dataMode]} |`));
  L.push("", "### B. 사건 일정", "");
  r.events.forEach((e) => {
    L.push(`**${esc(e.name)}** (${e.categoryLabel}, ${DATA_MODE_LABEL[e.dataMode]}) — ${e.stageAsOf}`, "", "| 구분 | 예정/실제 | 적용일 | 발표일 | 수집일 | 기준일 시점 반영 |", "|---|---|---|---|---|---|");
    e.timeline.forEach((t) => L.push(`| ${t.type} | ${t.status} | ${t.date} | ${t.announcedOn} | ${t.collectedOn} | ${t.knownAsOf ? "반영" : "제외(기준일 이후 정보)"} |`));
    L.push("");
  });
  if (r.comps) {
    const c = r.comps;
    L.push("### C. 비교거래", "", `- 기준: ${c.anchor.label}, 기간 ${c.window.start.raw}~${c.window.end.raw}${c.areaBand ? `, 전용 ${fmtNum(c.areaBand.minM2, 1)}~${fmtNum(c.areaBand.maxM2, 1)}㎡` : ", 면적 필터 없음"}`);
    L.push(`- 포함: 본건 권역 ${c.target.all.count}건(${c.target.all.complexes}개 단지), 비교 권역 ${c.comparator.all.count}건 · 제외 사유: ${Object.entries(c.exclusionCounts).map(([k, v]) => `${k} ${v}`).join(", ") || "없음"}`);
    L.push(`- 본건 권역 중위 ㎡당 ${fmtMan(c.target.all.medianPerM2)} (사분위 ${fmtMan(c.target.all.p25PerM2)}~${fmtMan(c.target.all.p75PerM2)})`);
    L.push(`- 자료 범위 ${c.dataCoverage.firstMonth ?? "없음"}~${c.dataCoverage.lastMonth ?? "없음"}, 거래 없는 달 ${c.emptyMonths}개`, "- 동일 단지·면적·유사층 거래를 같은 호실의 반복거래로 보지 않음. 건수 기준 충족이 통계적 타당성을 보장하지 않음.", "");
  }
  return L.join("\n");
}

export function reportQuestions(rec: AnalysisRecord, r: AnalysisResult): string {
  const L = header(rec, r, "영업부서·시행사 확인 질문 초안");
  if (!r.assetSupported) return [...L, "- 현재 아파트만 지원하므로 질문 초안을 만들지 않았음."].join("\n");
  const q: string[] = [];
  r.missing.filter((m) => m.field !== "property.displayName").forEach((m) => q.push(`${m.label} 자료를 제공해 주실 수 있는지 (${m.affects}에 필요)`));
  r.events.forEach((e) => {
    if (!e.evidence.confirmedOfficial) q.push(`「${e.name}」의 공식 고시·승인 문서(문서번호·페이지 포함)를 제공해 주실 수 있는지`);
    if (e.delayCount) q.push(`「${e.name}」의 최초 일정 대비 지연 사유와 최신 공식 일정의 근거`);
    if (e.maturityNote) q.push(`「${e.name}」 개통이 만기 이후로 예정된 상황에서 제시 가격에 해당 기대를 어느 정도 반영했는지와 그 근거`);
    if (e.access.walkMinutes === null && e.category !== "supply") q.push(`본건에서 「${e.name}」까지 실제 보행 경로·소요시간 자료`);
    if (e.prepricing?.assessment === "possible") q.push(`평가서가 「${e.name}」 기대를 평가액에 반영했는지, 반영했다면 방법과 비율`);
  });
  if (r.comps?.proposedComparison.diffPct != null && Math.abs(r.comps.proposedComparison.diffPct) >= 5) q.push(`제시 분양가가 인근 비교거래 중위 ㎡당 단가와 ${r.comps.proposedComparison.diffPct.toFixed(1)}% 차이 나는 근거(비교 단지·조건)`);
  r.supply.rows.filter((s) => s.timing === "yes").forEach((s) => q.push(`경쟁 공급 「${s.name}」(${s.stage})과의 수요층·가격대 차별화 근거`));
  if (rec.working.debt && rec.working.debt.seniorStatus === "unknown") q.push("선순위 채권의 존재 여부와 금액(채권최고액/대출잔액 구분)");
  if (!rec.working.debt) q.push("필요 시: 채권액 정의(대출잔액/채권최고액)·선순위 여부·기준일");
  L.push(...(q.length ? q.map((x, i) => `${i + 1}. ${x}`) : ["- 추가 확인 질문 없음"]));
  return L.join("\n");
}

export function reportDraft(rec: AnalysisRecord, r: AnalysisResult): string {
  const L = header(rec, r, "입지 변화·가격영향 검토 보고서 초안");
  if (!r.assetSupported) return [...L, `- ${r.unsupportedMessage?.replace(/습니다\./g, "음.")}`].join("\n");
  const w = rec.working;
  L.push("## 1. 검토 대상");
  L.push(`- 본건은 ${LABELS.assetType[w.property.assetType]}으로, 소재지는 ${w.property.address ?? "미입력"}임.`);
  L.push(`- 비교 타입 전용면적은 ${r.property.exclusiveAreaM2 ? `${fmtNum(r.property.exclusiveAreaM2)}㎡(${fmtNum(r.property.exclusivePyeong)}전용평)` : "미입력"}임.`);
  r.prices.forEach((p) => L.push(`- ${p.label}는 ${p.input}이며, 기준일은 ${p.basisDate}임.${p.unit?.perM2Krw != null ? ` 전용㎡당 ${fmtMan(p.unit.perM2Krw)}, 전용평당 ${fmtMan(p.unit.perPyeongKrw)}에 해당함.` : ` ${p.unit?.conversionNote ?? ""}`}`));
  L.push("", "## 2. 입지 변화 확인");
  if (!r.events.length) L.push("- 검토 대상 입지 사건이 입력되지 않았음.");
  r.events.forEach((e) => {
    L.push(`- 「${e.name}」(${e.categoryLabel})은 기준일 현재 ${e.stageAsOf} 상태임.${e.expectedOpening ? ` 개통·개장 ${e.expectedOpeningStatus === "actual" ? "실적" : "예정"}은 ${e.expectedOpening.raw}임.` : ""}`);
    L.push(`  - 근거는 ${e.evidence.total}건이며, 이 중 확인된 사실은 ${e.evidence.byStatus.confirmed}건임.${e.evidence.confirmedOfficial ? "" : " 공식 자료로 확인되지 않았음."}`);
    e.scheduleGaps.forEach((g) => L.push(`  - 일정은 ${g.text}임.`));
    if (e.delayedScenario) L.push(`  - ${e.delayedScenario.delayMonths}개월 지연을 가정하면 ${e.delayedScenario.opening.raw}이 되며${e.delayedScenario.gapToMaturity !== null ? `, 만기보다 ${e.delayedScenario.gapToMaturity}개월 ${e.delayedScenario.gapToMaturity >= 0 ? "뒤" : "앞"}임` : "임"}.`);
    if (e.maturityNote) L.push(`  - ${e.maturityNote}`);
    if (e.category !== "supply") L.push(`  - 접근성: ${e.access.text}임.`);
  });
  L.push("", "## 3. 가격 비교와 선반영");
  L.push(`- ${r.summary.price.observed}임.`, `- ${r.summary.price.comparison}임.`);
  r.indexComparisons.forEach((i) => L.push(`- ${i.label}: ${i.text.replace(/임\.$/, "")}`));
  r.events.filter((e) => e.prepricing).forEach((e) => L.push(`- 「${e.name}」 선반영: ${e.prepricing!.text.replace(/\.$/, "")}임.`));
  L.push(`- ${r.causalEffect.text}임.`);
  L.push("", "## 4. 경쟁 공급");
  L.push(`- ${r.supply.text.replace(/\.$/, "")}임.`);
  L.push("", "## 5. 가격 변화에 따른 참고계산");
  L.push(`- ${r.summary.price.stress}임.`);
  if (r.stress.disposal) L.push(`- 처분 일정: ${r.stress.disposal.text}임.`);
  if (r.ltv.status === "computed") {
    L.push(`- 채권 정의는 ${r.ltv.definition}, ${r.ltv.seniorText}이며 분모는 ${r.ltv.valueLabel}임.`);
    r.ltv.rows.forEach((row) => L.push(`  - ${row.label} ${fmtEok(row.valueKrw)}: 본건 채권 기준 ${fmtPct(row.ownLtvPct)}${row.combinedLtvPct !== null ? `, 통합 담보부담 ${fmtPct(row.combinedLtvPct)}` : ", 통합 담보부담 미산출"}임.`));
    L.push(`- ${r.ltv.note.replace(/\.$/, "")}임.`);
  } else L.push(`- LTV 참고계산은 미산출임(${r.ltv.reasons.join(", ")}).`);
  L.push("", "## 6. 주요 불확실성");
  r.flags.filter((f) => f.level !== "low").forEach((f) => L.push(`- ${f.text.replace(/\.$/, "")}임.`));
  return L.join("\n");
}

// ── 변경표
export interface DiffRow { path: string; before: string; after: string }

function flatten(v: unknown, prefix: string, out: Map<string, string>) {
  if (v === null || v === undefined) return;
  if (Array.isArray(v)) {
    v.forEach((item, i) => {
      const id = item && typeof item === "object" && "key" in item ? String((item as any).key) : String(i);
      flatten(item, `${prefix}[${id}]`, out);
    });
    if (!v.length) out.set(prefix, "(없음)");
    return;
  }
  if (typeof v === "object") {
    for (const [k, c] of Object.entries(v as object)) if (k !== "text") flatten(c, prefix ? `${prefix}.${k}` : k, out);
    return;
  }
  out.set(prefix, String(v));
}

export function diffWorking(a: WorkingInputs, b: WorkingInputs): DiffRow[] {
  const ma = new Map<string, string>();
  const mb = new Map<string, string>();
  flatten(a, "", ma);
  flatten(b, "", mb);
  const keys = [...new Set([...ma.keys(), ...mb.keys()])].sort();
  return keys.filter((k) => ma.get(k) !== mb.get(k)).map((k) => ({ path: k, before: ma.get(k) ?? "(없음)", after: mb.get(k) ?? "(없음)" }));
}

export function reportChanges(rec: AnalysisRecord, r: AnalysisResult, compare?: { leftLabel: string; left: WorkingInputs; rightLabel: string; right: WorkingInputs }): string {
  const L = header(rec, r, "분석 버전·사본 간 변경표");
  const c = compare ?? { leftLabel: "최초 수신·생성 사본", left: rec.original.working, rightLabel: "현재 작업본", right: rec.working };
  const rows = diffWorking(c.left, c.right);
  L.push(`비교: **${c.leftLabel}** → **${c.rightLabel}** (${rows.length}개 항목 변경)`, "", "| 항목 | 이전 | 이후 |", "|---|---|---|");
  if (!rows.length) L.push("| (변경 없음) | | |");
  rows.slice(0, 500).forEach((d) => L.push(`| ${esc(d.path)} | ${esc(d.before)} | ${esc(d.after)} |`));
  L.push("", "## 분석 실행 이력", "", "| 실행 | 시각 | 계기 | 입력 해시 |", "|---|---|---|---|");
  rec.runs.forEach((run) => L.push(`| #${run.runNo} | ${run.at} | ${run.trigger === "auto-launch" ? "시동 수신 자동" : run.trigger === "auto-create" ? "생성 시 자동" : "수동"} | ${run.inputHash.slice(0, 12)} |`));
  L.push("", "## 저장 버전", "");
  rec.versions.forEach((v) => L.push(`- v${v.versionNo} ${v.at} — ${esc(v.note || "메모 없음")}`));
  if (!rec.versions.length) L.push("- 저장된 버전 없음");
  return L.join("\n");
}

export function toPlainText(md: string): string {
  return md.replace(/^#+\s*/gm, "").replace(/\*\*/g, "").replace(/^> /gm, "");
}

export function sameContent(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}
