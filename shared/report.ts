// 보고서 출력(Markdown). 숫자는 runAnalysis 결과에서만 가져오며 새로 추정하지 않는다.
import type { AnalysisResult, ComplexResult } from "./analysis.ts";
import { APP_NAME, complexKeyOf, DATA_MODE_LABEL, EVIDENCE_LEVEL_LABEL, EVIDENCE_SOURCE_LABEL, EVIDENCE_STATUS_LABEL, ORIGIN_LABEL, type AnalysisRecord, type WorkingInputs } from "./model.ts";
import { evidenceLevel } from "./analysis.ts";
import { hashOf, stableStringify } from "./hash.ts";
import { fmtMan, fmtNum, fmtPct, fmtPp } from "./units.ts";
import { reportLabelOf, type ObservationResult } from "./observation.ts";
import { currentPriceView, observationView } from "./priceView.ts";

const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
const dist = (m: number | null) => (m === null ? "미확인" : `${Math.round(m).toLocaleString("ko-KR")}m`);
const yd = (d: number | null) => (d === null ? "-" : `${d > 0 ? "+" : ""}${d}년`);

/** 결과를 만든 실행 당시 입력(없으면 현재 작업본) */
export function inputOf(rec: AnalysisRecord, r: AnalysisResult): WorkingInputs {
  return runOf(rec, r)?.input ?? rec.working;
}

/** 같은 해시의 재실행은 객체 일치를 우선하고 복구 후에는 최신 일치를 찾는다. */
function runOf(rec: AnalysisRecord, r: AnalysisResult) {
  return rec.runs.find(x => x.result === r) ?? [...rec.runs].reverse().find(x => x.inputHash === r.inputHash);
}

function header(rec: AnalysisRecord, r: AnalysisResult, title: string): string[] {
  const w = inputOf(rec, r);
  return [
    `# ${title}`, "",
    `- 대상: ${esc(w.property.displayName ? `${w.property.displayName} (${w.property.address})` : w.property.address)}`,
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
  const pv = currentPriceView(inputOf(rec, r), r);
  L.push("### 2-1. 현재 검토가격 비교",
    inputOf(rec, r).reviewPrice ? `- 검토가격: 세대당 총액 ${pv.review.household} · ${pv.review.perPyeong} · ${pv.review.perM2} — ${esc(pv.review.label)}, 기준일 ${pv.review.basisDate}${pv.review.note ? ` (${pv.review.note})` : ""}` : "- 검토가격: 미입력 — 가격 비교만 보류",
    pv.market.complexes ? `- 인근 유사 거래: 대표 비교단지 ${pv.market.complexes}곳(최대 5곳, 조건에 맞는 단지가 부족해도 채우지 않음) · ${pv.market.count}건 중위 ${pv.market.perPyeong} · ${pv.market.perM2} · 세대당 환산 ${pv.market.householdEquiv} · 단지별 중위 범위 ${pv.market.range} · ${pv.market.window} · ${pv.market.area}` : `- 인근 유사 거래: 조건에 맞는 대표 비교단지 없음(채우지 않음) · ${pv.market.window} · ${pv.market.area}`,
    `- 비교: ${r.price.text}`,
    `- ${pv.disclaimer}`, "");
  L.push(...comparablesTable(r.market.comparables));
  L.push("", "### 2-2. 입지 사건 전후 관측", ...groupObservationLines(rec, r).map((x, i) => (i === 0 ? x.replace(/^### /, "#### ") : x)),
    `- 참고(대표 비교단지 발표 전후 단일값): ${r.summary.price.observed.replace(/^관찰된 변화: ?/, "")}`,
    `- ${r.summary.price.prepricing}`, `- ${r.summary.price.causal}`, `- 기준: ${r.summary.price.basis}`);
  L.push("", "## 3. 주요 불확실성");
  if (!r.summary.uncertainties.length) L.push("- 자료 범위 내 주요 항목 없음");
  r.summary.uncertainties.forEach((f) => L.push(`- [${f.level === "high" ? "높음" : "중간"}] ${esc(f.text)}`));
  if (r.missing.length) L.push("", "## 보완하면 추가로 분석되는 항목", ...r.missing.map((m) => `- ${m.label}: ${m.affects}`));
  L.push("", "> 관찰된 변화·비교 차이는 인과효과가 아님. 적정가격·예상 상승률을 산정하지 않았음.", "", "---", "", appendix(rec, r));
  return L.join("\n");
}

/** 수동 확인 그룹 관측(실행 당시 스냅샷 기준). 설정이 없으면 한 줄만. */
export function groupObservationLines(rec: AnalysisRecord, r: AnalysisResult): string[] {
  const g = r.groupObservation;
  const run = runOf(rec, r);
  const runNo = run?.runNo;
  if (!g) return ["### 수동 확인 그룹 관측", "- 이 분석 실행에는 그룹 관측 설정이 없음(또는 v0.6.1 이전 실행) — 설정 후 ‘분석 다시 실행’ 시 포함"];
  const row = (name: string, x: ObservationResult["impact"]) => `| ${name} | ${x.complexes}/${x.strata} | ${x.pre.count}건 | ${x.post.count}건 | ${fmtMan(x.pre.medianPerM2)} | ${fmtMan(x.post.medianPerM2)} | ${fmtPct(x.changePct)} |`;
  const w = run?.input ?? (hashOf(rec.working) === r.inputHash ? rec.working : undefined);
  const names = (group: 'impact' | 'control') => {
    const labels = g.selectionLabels?.[group];
    if (labels) return labels.map(esc).join(', ') || '없음';
    if (!w) return '당시 입력 스냅샷 없음 — 단지명 확인 불가';
    return (w.observation?.[group] ?? []).map(k => esc(labelFor(w, k))).join(', ') || '없음';
  };
  return [
    `### 수동 확인 그룹 관측 (실행 #${runNo ?? "?"} 입력 기준 · 인과효과 아님)`,
    `- 기준 일정: ${esc(g.anchorLabel || "미선택")} ${g.anchor || ""} · 전 [${g.start || "—"}, 기준일) / 후 [기준일, ${g.end || "—"}) · ${g.complete ? "관찰기간 완료" : "관찰기간 미완료 또는 미산출"}`,
    `- 영향권(사용자 확인): ${names("impact")} · 비교군(사용자 확인): ${names("control")}`,
    `- 분석 기준일 ${g.basis.asOf} · 단위 ${g.basis.unit} · 출처 ${esc(g.basis.sources.join(", ") || "해당 거래 없음")}${g.basis.dataModes.length ? ` · 자료 ${g.basis.dataModes.join("·")}` : ""}`,
    "",
    "| 그룹 | 단지/면적구간 | 전 표본 | 후 표본 | 전 중위(전용㎡) | 후 중위(전용㎡) | 관측 변동률 |",
    "|---|---|---|---|---|---|---|",
    row("영향권", g.impact), row("비교군", g.control),
    "",
    observationView(g).difference ? `- **${observationView(g).difference}** (인과효과 아님 · 관측된 차이)` : "- 비교군 대비 관측 차이: 표시 안 함 — 유효한 비교가 아님(아래 확인 사항 참고)",
    ...g.warnings.map((x) => `- [확인] ${esc(x)}`),
    ...g.notes.map(x => `- [계산 기준·한계] ${esc(x)}`),
    ...(g.missingSelections ?? []).map((m) => `- [선택 단지 없음] ${m.group === "impact" ? "영향권" : "비교군"} ${esc(m.label.name)}(${esc(m.label.detail)})${m.similar.length ? ` — 같은 이름 다른 식별: ${m.similar.map((s) => esc(s.label.detail)).join(", ")}` : ""}`),
  ];
}
function labelFor(w: WorkingInputs, key: string): string {
  return reportLabelOf(key, w.transactions);
}

function appendix(rec: AnalysisRecord, r: AnalysisResult): string {
  const w = inputOf(rec, r);
  const L = ["## 근거 부록", "", "> 입지 뉴스·고시 자동 수집·자동 검증 기능은 없음. 아래 근거는 모두 사용자가 기록한 것임.", "", "### A. 근거 자료", "", "| 출처 종류 | 발행기관 | 문서명 | 발행일 | 자료 기준일 | 확인일 | 페이지·절 | 확인한 사실 | 기록 수준 | 내용 판단 |", "|---|---|---|---|---|---|---|---|---|---|"];
  if (!w.evidence.length) L.push("| - | - | 등록된 근거 없음 | | | | | | | |");
  w.evidence.forEach((e) => L.push(`| ${e.sourceType ? EVIDENCE_SOURCE_LABEL[e.sourceType] : "미기재"} | ${esc(e.publisher)} | ${esc(e.title)}${e.sourceRef ? ` (${esc(e.sourceRef)})` : ""} | ${e.publishedOn ?? "-"} | ${e.effectiveOn ?? "-"} | ${e.checkedOn ?? "-"} | ${esc(e.pageOrSection ?? "-")} | ${esc(e.fact)} | ${EVIDENCE_LEVEL_LABEL[evidenceLevel(e)]} | ${EVIDENCE_STATUS_LABEL[e.status]} |`));
  if (r.excludedEvents.length) L.push("", `- 기준일 이후 처음 알려진 사건(분석 제외): ${r.excludedEvents.map((e) => `${esc(e.name)}(${e.firstKnown})`).join(", ")}`);
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
    `- 거리 미확인 확인 필요 후보(통계 제외): ${m.needsCheck.length ? m.needsCheck.map((c) => esc(c.name)).join(", ") : "없음"}`,
    `- 출처: ${m.sources.join(", ") || "없음"}${r.collection ? ` · ${r.collection.text}` : ""}`,
    "- 동일 단지·면적·유사층 거래를 같은 호실의 반복거래로 보지 않음. 거래 건수가 많아도 통계적 타당성을 보장하지 않음.", "",
    "| 제외·순위 밖 단지 | 사유 |", "|---|---|",
    ...m.complexes.filter((c) => c.status !== "selected").map((c) => `| ${esc(c.name)} | ${esc(c.reasons.join(", "))} |`));
  if (w.dataLog.length) L.push("", "### D. 자료 조회 기록", "", ...w.dataLog.map((d) => `- ${d.at} · ${esc(d.source)} · ${esc(d.detail)}`));
  const g = r.groupObservation;
  if (g?.monthly.length) {
    L.push("", "### E. 수동 확인 그룹 월별 중위 단가(전용㎡, 만원) · 동일 분석 표본", "", "| 월 | 영향권 중위 / 건수 | 비교군 중위 / 건수 |", "|---|---|---|",
      ...g.monthly.map((m) => `| ${m.month} | ${fmtMan(m.impact)} / ${m.impactN}건 | ${fmtMan(m.control)} / ${m.controlN}건 |`),
      "", "- 경계 월은 일부 날짜만 포함. 거래 없는 달은 0원이 아닌 미산출.");
  }
  if (g?.usage?.length) {
    L.push("", "### F. 수동 확인 그룹 사용·제외 단지", "", `- 가격 기준: 전용㎡당 거래가(원 단위 계산) · 면적 기준: ${g.basis.area ? `본건 전용 ${g.basis.area.m2}㎡ ±${g.basis.area.bandPct}%` : "본건 전용면적 미입력"} · 같은 단지 × 전용면적 ${g.basis.stratumM2}㎡ 구간에 전·후 양쪽 거래가 있는 표본만 사용 · 기간별 최소 ${g.basis.minSample}건`, "",
      "| 그룹 | 단지 | 사용 | 전/후 건수 | 면적구간 | 제외·미사용 이유 |", "|---|---|---|---|---|---|",
      ...g.usage.map((u) => `| ${u.group === "impact" ? "영향권" : "비교군"} | ${esc(u.label)} | ${u.used ? "사용" : "미사용"} | ${u.pre}/${u.post} | ${u.strata} | ${esc([u.reason, ...Object.entries(u.excluded).map(([k, n]) => `${k} ${n}건`)].filter(Boolean).join(" · ") || "-")} |`));
  }
  L.push("", "### G. 인용 근거(이 실행 시점 기록)", "");
  if (!r.citations) L.push("- 당시 근거 상세 미보존(v0.8 이전 실행) — 결과의 단지·사건 이름만 남아 있음");
  else for (const c of r.citations.items) {
    if (c.kind === "trade") L.push(`- [${c.id}] ${esc(c.title)} — 거리 ${dist(c.distanceM)} · 준공 ${c.buildYear ?? "미확인"} · 중위 ${fmtMan(c.medianPerM2)}/전용㎡ · 사용 거래 ${c.tradeTotal}건${c.tradeTotal > c.trades.length ? `(최근 ${c.trades.length}건 보존)` : ""}`);
    else if (c.kind === "event") L.push(`- [${c.id}] ${esc(c.title)} — ${esc(c.summary)} · 일정 ${c.timeline.map((t) => `${t.type} ${t.date}(${t.status})`).join(", ")}`);
    else L.push(`- [${c.id}] ${esc(c.title)} — ${esc(c.summary)} · 사용 단지 ${c.usage.filter((u) => u.used).length}/${c.usage.length}곳`);
  }
  return L.join("\n");
}

export function reportQuestions(rec: AnalysisRecord, r: AnalysisResult): string {
  const L = header(rec, r, "영업부서·시행사 확인 질문 초안");
  const q: string[] = [];
  r.missing.forEach((m) => q.push(`${m.label} 자료 제공 가능 여부 (${m.affects}에 필요)`));
  r.events.forEach((e) => {
    if (!e.evidence.originalChecked) q.push(`「${e.name}」의 공식 고시·승인 원문(문서번호·페이지 포함)`);
    if (e.delayCount) q.push(`「${e.name}」의 지연 사유와 최신 공식 일정의 근거`);
    if (e.category !== "supply" && e.access.walkMinutes === null) q.push(`본건에서 「${e.name}」까지 실제 보행 경로·소요시간 자료`);
    if (e.prepricing?.assessment === "possible") q.push(`검토가격에 「${e.name}」 기대를 반영했는지, 반영했다면 방법과 근거`);
  });
  if (r.price.position === "above") q.push(`검토가격이 대표 비교단지 단가 범위를 넘는 근거(상품·브랜드·층·향·신축 여부 등)`);
  r.market.needsCheck.slice(0, 10).forEach((c) => q.push(`확인 필요 후보 「${c.name}」(${c.identityBasis})의 위치(본건과의 거리)`));
  r.supply.rows.filter((s) => s.timing === "yes").forEach((s) => q.push(`경쟁 공급 「${s.name}」(${s.stage})과의 가격대·상품 차별화 근거`));
  L.push(...(q.length ? q.map((x, i) => `${i + 1}. ${x}`) : ["- 추가 확인 질문 없음"]));
  return L.join("\n");
}

export function reportDraft(rec: AnalysisRecord, r: AnalysisResult): string {
  const L = header(rec, r, "아파트 입지·가격 검토 보고서 초안");
  const w = inputOf(rec, r);
  L.push("## 1. 검토 대상");
  L.push(`- 본건 소재지는 ${w.property.address}임.`);
  L.push(`- 비교 타입 전용면적은 ${r.property.exclusiveAreaM2 ? `${fmtNum(r.property.exclusiveAreaM2)}㎡(${fmtNum(r.property.exclusivePyeong)}전용평)` : "미입력"}이며, 준공(예정)연도는 ${r.property.buildYear ?? "미입력"}임.`);
  L.push(`- 검토가격은 ${r.price.reviewText}(기준일 ${r.price.basisDate})임.${r.price.reviewPerM2 !== null ? ` 전용㎡당 ${fmtMan(r.price.reviewPerM2)}, 전용평당 ${fmtMan(r.price.reviewPerPyeong)}에 해당함.` : ""}`);
  L.push("", "## 2. 입지 변화");
  if (!r.events.length) L.push("- 검토 대상 입지 사건이 입력되지 않았음.");
  r.events.forEach((e) => {
    L.push(`- 「${e.name}」(${e.categoryLabel})은 기준일 현재 ${e.stageAsOf} 상태임.${e.expectedTarget ? ` ${e.expectedTargetStatus === "actual" ? "완료" : "예정"} 시점은 ${e.expectedTarget.raw}임.` : ""}`);
    L.push(`  - 근거 기록: ${e.evidence.text}임.${e.evidence.originalChecked ? " 원문 대조는 사용자 기록이며 앱이 자동 검증한 것은 아님." : " 공식 원문 대조 기록이 없음."}`);
    e.scheduleGaps.forEach((g) => L.push(`  - 일정은 ${g.text}임.`));
    if (e.category !== "supply") L.push(`  - 접근성: ${e.access.text}임.`);
  });
  L.push("", "## 3. 실거래 비교");
  L.push(`- ${r.summary.price.comparables}임.`);
  r.market.comparables.forEach((c) => L.push(`  - ${c.name}: ${c.selectionReason}, 중위 ${fmtMan(c.stats.medianPerM2)}/전용㎡임.`));
  L.push(`- ${r.price.text.replace(/\.$/, "")}임.`);
  L.push(`- ${r.observed.text.replace(/\.$/, "")}임.`);
  if (r.groupObservation) { const g = r.groupObservation; const d = observationView(g).difference; L.push(`- 수동 확인 그룹 관측(${g.anchor || "기준 일정 미선택"} 전후 ${g.start ? "" : "미산출 "}· 사용자 확인 그룹): 영향권 ${fmtPct(g.impact.changePct)}, 비교군 ${fmtPct(g.control.changePct)}${d ? `, ${d}로 관측됨` : " — 유효한 비교가 아니어서 비교군 대비 차이는 제시하지 않음"} — 인과효과 아님.`); L.push(...g.warnings.map(x => `  - [그룹 관측 확인] ${esc(x)}`)); }
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
