import { useState } from "react";
import { CopyButton, download, Section, Select, Text } from "../components.tsx";
import type { SectionProps } from "../AnalysisView.tsx";
import { FRAMED } from "../nav.ts";
import { diffWorking, reportChanges, reportDraft, reportQuestions, reportSummary, toPlainText } from "../../shared/report.ts";
import { seoulNowIso, seoulToday } from "../../shared/dates.ts";
import type { WorkingInputs } from "../../shared/model.ts";

type Kind = "summary" | "questions" | "draft" | "changes";
const KINDS: [Kind, string][] = [["summary", "1페이지 검토 요약 + 근거 부록"], ["questions", "영업부서·시행사 확인 질문 초안"], ["draft", "보고서 초안(~임. 문체)"], ["changes", "분석 버전 간 변경표"]];

export function ReportSection({ rec, setRec, defaultOpen }: SectionProps) {
  const latest = rec.runs[rec.runs.length - 1];
  // 실행 번호 선택: 기본은 최신. 과거 실행은 그 실행의 결과와 당시 기록(제목·주소·근거)만으로 다시 만든다.
  const [runSel, setRunSel] = useState<string>("latest");
  const sel = runSel === "latest" ? latest : rec.runs.find((x) => String(x.runNo) === runSel) ?? latest;
  const r = sel.result;
  const isLatest = sel === latest;
  const runChoices: [string, string][] = [["latest", `최신 실행 #${latest.runNo}`], ...[...rec.runs].reverse().filter((x) => x !== latest).map((x) => [String(x.runNo), `실행 #${x.runNo} · ${x.at.slice(0, 16).replace("T", " ")}${x.result.reportContext || x.input ? "" : " (당시 맥락 미보존)"}`] as [string, string])];
  const [kind, setKind] = useState<Kind>("summary");
  const [note, setNote] = useState<string | undefined>();
  const choices: [string, string][] = [["original", "최초 입력"], ["current", "현재 작업본"], ...rec.versions.map((v) => [`v${v.versionNo}`, `v${v.versionNo} ${v.note || ""}`] as [string, string])];
  const [left, setLeft] = useState("original");
  const [right, setRight] = useState("current");
  const pick = (id: string): WorkingInputs => (id === "original" ? rec.original.working : id === "current" ? rec.working : rec.versions.find((v) => `v${v.versionNo}` === id)!.working);
  const label = (id: string) => choices.find((c) => c[0] === id)?.[1] ?? id;

  const md = kind === "summary" ? reportSummary(rec, r) : kind === "questions" ? reportQuestions(rec, r) : kind === "draft" ? reportDraft(rec, r) : reportChanges(rec, r, { leftLabel: label(left), left: pick(left), rightLabel: label(right), right: pick(right) });
  const titleOf = kind === "changes" ? rec.title : (r.reportContext?.title ?? (sel.input ? rec.title : "실행"));
  const base = `${titleOf.replace(/[^\p{L}\p{N}_-]+/gu, "_").slice(0, 40)}_${kind}_run${sel.runNo}_${seoulToday()}`;
  const diffs = diffWorking(pick(left), pick(right));

  return (
    <Section id="sec-report" defaultOpen={defaultOpen} title="보고서·변경 이력" summary={`분석 실행 ${rec.runs.length}회 · 저장 버전 ${rec.versions.length}개`}>
      <div className="toolbar">
        <Select label="실행" value={runSel} options={runChoices} onChange={setRunSel} testId="report-run" />
        <Select label="출력물" value={kind} options={KINDS} onChange={setKind} testId="report-kind" />
        <button onClick={() => download(`${base}.md`, md)} data-testid="dl-md">Markdown 내려받기</button>
        <button onClick={() => download(`${base}.txt`, toPlainText(md), "text/plain;charset=utf-8")}>텍스트 내려받기</button>
        <CopyButton text={md} label="보고서 복사" testId="copy-report" />
        <button onClick={() => { try { window.print(); } catch { /* 미리보기 프레임에서 막힘 */ } }} title={FRAMED ? "다른 화면 안에 열린 미리보기에서는 인쇄가 막힐 수 있음 — 보고서 복사 또는 Markdown 저장 사용" : undefined}>인쇄 / PDF 저장{FRAMED ? "(미리보기에선 제한)" : ""}</button>
      </div>
      <p className={`small ${isLatest ? "muted" : "run-note"}`} data-testid="report-run-note">{isLatest ? `실행 #${sel.runNo}(최신) 당시 기록 기준.` : `실행 #${sel.runNo} 당시 기록 기준 — 그 뒤 바뀐 주소·근거·검토가격은 반영하지 않습니다.${r.reportContext ? "" : " 이 실행은 당시 입력 맥락이 보존되지 않아 해당 항목은 ‘당시 정보 미보존’으로 표시합니다."}`}{kind === "changes" ? " 변경표는 실행 선택과 무관하게 아래에서 고른 작업본끼리 비교합니다." : ""}</p>
      <p className="muted small">보고서는 저장된 실행 결과로만 만듭니다(다시 계산하지 않음). 누구에게도 자동 발송하지 않으며 협의체로 결과를 보내지 않습니다. 외부 AI 호출 없음.</p>
      {kind === "changes" && (
        <div className="toolbar small">
          <Select label="이전" value={left} options={choices} onChange={setLeft} />
          <Select label="이후" value={right} options={choices} onChange={setRight} />
          <span>{diffs.length}개 항목 다름</span>
        </div>
      )}
      <div className="print-area"><pre className="report" data-testid="report-preview">{md}</pre></div>
      <h4>작업본 버전 저장</h4>
      <div className="toolbar">
        <Text label="버전 메모" value={note} onChange={setNote} />
        <button data-testid="save-version" onClick={() => { setRec({ ...rec, versions: [...rec.versions, { versionNo: rec.versions.length + 1, at: seoulNowIso(), note: note ?? "", working: structuredClone(rec.working) }] }); setNote(undefined); }}>현재 작업본을 버전으로 저장</button>
      </div>
    </Section>
  );
}
