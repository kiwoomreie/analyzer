import { useState } from "react";
import { Badge, DateText, MapPanel, ModeBadge, Num, Section, Select, Text } from "../components.tsx";
import type { SectionProps } from "../AnalysisView.tsx";
import { CoordField } from "./InputSection.tsx";
import {
  EVENT_CATEGORY_LABEL, EVIDENCE_LEVEL_LABEL, EVIDENCE_SOURCE_LABEL, EVIDENCE_STATUS_LABEL, MILESTONE_LABEL, SUPPLY_STAGE_LABEL, newKey, type EvidenceSourceType,
  type EventCategory, type EvidenceStatus, type LocationEvent, type MilestoneType, type SupplyStage,
} from "../../shared/model.ts";
import { generalJsonImport } from "../../shared/importers.ts";
import { isSecretLike } from "../../shared/safety.ts";
import { sha256Hex } from "../../shared/hash.ts";
import { formatDateValue, seoulNowIso, seoulToday } from "../../shared/dates.ts";
import { evidenceLevel } from "../../shared/analysis.ts";
import { Check } from "../components.tsx";

const DIR: [LocationEvent["direction"], string][] = [["favorable", "유리"], ["adverse", "불리"], ["mixed", "혼재"], ["unknown", "미확인"]];
const TEXT_TYPES = [".txt", ".md", ".csv", ".json"];

export function EventsSection({ rec, update, session }: SectionProps) {
  const w = rec.working;
  const r = rec.runs[rec.runs.length - 1].result;
  const nonSupply = w.events.filter((e) => e.category !== "supply");
  const [selKey, setSelKey] = useState<string | null>(nonSupply[0]?.key ?? w.events[0]?.key ?? null);
  const [msg, setMsg] = useState<string>("");
  const idx = w.events.findIndex((e) => e.key === selKey);
  const ev = idx >= 0 ? w.events[idx] : null;
  const er = r.events.find((e) => e.key === selKey);

  const addEvent = (category: EventCategory) => {
    const key = newKey("ev");
    update((x) => { x.events.push({ key, category, name: `새 ${EVENT_CATEGORY_LABEL[category]}`, direction: category === "supply" ? "adverse" : "unknown", milestones: [], evidenceKeys: [], dataMode: "user", ...(category === "supply" ? { supply: { stage: "plan" } } : {}) }); });
    setSelKey(key);
  };

  const importJson = async (f: File) => {
    let data: unknown;
    try { data = JSON.parse(await f.text()); } catch { return setMsg("JSON 형식이 아님"); }
    const res = generalJsonImport(data);
    if (!res.ok) return setMsg(`거절: ${res.errors.slice(0, 3).join(" / ")}`);
    update((x) => { x.events.push(...res.result!.events); x.evidence.push(...res.result!.evidence); x.transactions.push(...res.result!.transactions); x.dataLog.push({ at: seoulNowIso(), source: `사용자 JSON(${f.name.slice(0, 60)})`, detail: `사건 ${res.result!.events.length}·근거 ${res.result!.evidence.length}·거래 ${res.result!.transactions.length}` }); });
    setMsg(`가져옴: 사건 ${res.result!.events.length} · 근거 ${res.result!.evidence.length} · 거래 ${res.result!.transactions.length}${res.errors.length ? ` (경고 ${res.errors.length})` : ""}`);
  };

  const attach = async (f: File) => {
    if (f.size > 2 * 1024 * 1024) return setMsg("첨부는 2MB 이하만 허용");
    const lower = f.name.toLowerCase();
    const buf = new Uint8Array(await f.arrayBuffer());
    const isText = TEXT_TYPES.some((t) => lower.endsWith(t));
    const allowed = isText || lower.endsWith(".pdf");
    if (!allowed) return setMsg("지원 첨부: txt, md, csv, json(본문 보관), pdf(식별 정보만 보관)");
    let text: string | undefined;
    if (isText) {
      text = new TextDecoder().decode(buf);
      if (isSecretLike(text)) return setMsg("첨부 본문에 비밀값·접속정보 형태가 있어 거절함(원문 미보관)");
      if (text.length > 200_000) text = text.slice(0, 200_000);
    }
    const key = newKey("att");
    update((x) => { x.attachments.push({ key, filename: f.name.slice(0, 120), mime: f.type || "application/octet-stream", size: f.size, sha256: sha256Hex(buf), text, addedAt: seoulNowIso() }); });
    setMsg(`첨부 등록: ${f.name}${isText ? "" : " (PDF 본문은 보관·자동 해석하지 않음 — 확인한 사실은 근거에 직접 기록)"}`);
  };

  const mapPoints = [
    ...(w.property.coordinates ? [{ n: 1, label: `본건: ${rec.title}`, lat: w.property.coordinates.lat, lng: w.property.coordinates.lng, detail: `좌표 출처: ${w.property.coordinates.source}`, kind: "property" as const }] : []),
    ...w.events.filter((e) => e.location).map((e, i) => ({ n: (w.property.coordinates ? 2 : 1) + i, label: e.name, lat: e.location!.lat, lng: e.location!.lng, detail: `${EVENT_CATEGORY_LABEL[e.category]} · ${r.events.find((x) => x.key === e.key)?.access.text ?? ""}`, kind: "event" as const })),
  ];

  return (
    <Section id="sec-events" title="입지 사건·근거 상세" summary={`사건 ${w.events.length}건 · 근거 ${w.evidence.length}건 · 첨부 ${w.attachments.length}건`}>
      <div className="banner muted small" data-testid="no-auto-collect">입지 뉴스·고시 <b>자동 수집 기능은 없습니다.</b> 아래 사건·일정·근거는 모두 사용자가 입력한 것이며 ‘사용자 입력’으로 표시됩니다. 분석 기준일 이후 처음 알려진 사건·근거와 기준일 이전에 취소가 알려진 공급은 결과에서 제외됩니다.</div>
      {r.excludedEvents.length > 0 && <p className="small warn-text">기준일 이후 처음 알려진 사건(분석 제외): {r.excludedEvents.map((e) => `${e.name}(${e.firstKnown})`).join(", ")}</p>}
      <div className="toolbar">
        <button onClick={() => addEvent("transport")} data-testid="add-event-transport">교통</button>
        <button onClick={() => addEvent("amenity")}>생활편의</button>
        <button onClick={() => addEvent("development")}>개발사업</button>
        <button onClick={() => addEvent("supply")} data-testid="add-event-supply">주변 입주 물량</button>
        <label className="filebtn">일반 JSON 가져오기<input type="file" accept=".json" onChange={(e: any) => { const f = e.target.files?.[0]; if (f) importJson(f); e.target.value = ""; }} /></label>
        <label className="filebtn">근거 첨부<input type="file" data-testid="attach" onChange={(e: any) => { const f = e.target.files?.[0]; if (f) attach(f); e.target.value = ""; }} /></label>
        {msg && <span className="small" data-testid="events-msg">{msg}</span>}
      </div>

      <div className="split">
        <ul className="list">
          {w.events.map((e) => {
            const x = r.events.find((y) => y.key === e.key);
            return (
              <li key={e.key} className={e.key === selKey ? "sel" : ""}>
                <button className="link" onClick={() => setSelKey(e.key)}>{e.name}</button>
                <div className="small muted">{EVENT_CATEGORY_LABEL[e.category]} · {x?.stageAsOf ?? "재실행 필요"} {e.dataMode === "demo" && <Badge tone="warn">가상</Badge>}</div>
              </li>
            );
          })}
          {!w.events.length && <li className="muted">사건 없음</li>}
        </ul>

        {ev && (
          <div className="detail">
            <div className="form grid">
              <Text label="사건명" value={ev.name} onChange={(v) => update((x) => { x.events[idx].name = v ?? ""; })} wide />
              <Select label="구분" value={ev.category} options={Object.entries(EVENT_CATEGORY_LABEL) as [EventCategory, string][]} onChange={(v) => update((x) => { x.events[idx].category = v; if (v === "supply" && !x.events[idx].supply) x.events[idx].supply = { stage: "plan" }; })} />
              <Select label="본건 영향 방향(검토자 판단)" value={ev.direction} options={DIR} onChange={(v) => update((x) => { x.events[idx].direction = v; })} />
              <CoordField label="사건 위치(위도, 경도)" value={ev.location} onChange={(c) => update((x) => { x.events[idx].location = c; })} />
              {ev.category !== "supply" && <>
                <Num label="실제 보행시간(경로 자료)" suffix="분" value={ev.access?.routeWalkMinutes} onChange={(v) => update((x) => { x.events[idx].access = { ...x.events[idx].access, routeWalkMinutes: v }; })} hint="경로 자료가 있을 때만 입력 — 직선거리로 환산하지 않음" />
                <Text label="경로 자료 출처" value={ev.access?.routeSource} onChange={(v) => update((x) => { x.events[idx].access = { ...x.events[idx].access, routeSource: v }; })} />
                <DateText label="경로 확인일" value={ev.access?.routeCheckedOn} dayOnly onChange={(v) => update((x) => { x.events[idx].access = { ...x.events[idx].access, routeCheckedOn: v }; })} />
              </>}
              {ev.category === "supply" && <>
                <Select label="공급 단계" value={ev.supply?.stage ?? "plan"} options={Object.entries(SUPPLY_STAGE_LABEL) as [SupplyStage, string][]} onChange={(v) => update((x) => { x.events[idx].supply = { ...(x.events[idx].supply ?? { stage: "plan" }), stage: v }; })} />
                <Num label="세대수" integer value={ev.supply?.households} onChange={(v) => update((x) => { x.events[idx].supply = { ...(x.events[idx].supply ?? { stage: "plan" }), households: v }; })} />
                <Num label="전용면적 최소" suffix="㎡" value={ev.supply?.areaMinM2} onChange={(v) => update((x) => { x.events[idx].supply = { ...(x.events[idx].supply ?? { stage: "plan" }), areaMinM2: v }; })} />
                <Num label="전용면적 최대" suffix="㎡" value={ev.supply?.areaMaxM2} onChange={(v) => update((x) => { x.events[idx].supply = { ...(x.events[idx].supply ?? { stage: "plan" }), areaMaxM2: v }; })} />
                <DateText label="분양 시기" value={ev.supply?.saleDate} onChange={(v) => update((x) => { x.events[idx].supply = { ...(x.events[idx].supply ?? { stage: "plan" }), saleDate: v }; })} />
                <DateText label="입주 시기" value={ev.supply?.occupancyDate} onChange={(v) => update((x) => { x.events[idx].supply = { ...(x.events[idx].supply ?? { stage: "plan" }), occupancyDate: v }; })} />
              </>}
              <div><ModeBadge mode={ev.dataMode} /> <button className="link danger" onClick={() => { update((x) => { x.events.splice(idx, 1); }); setSelKey(null); }}>사건 삭제</button></div>
            </div>

            <h4>일정 이력 <span className="muted small">발표일(알려진 날)·적용일(실행·예정일)·수집일을 구분. 최초 일정은 지우지 말고 ‘지연’ 항목으로 변경 이력을 추가</span></h4>
            <table className="tbl small">
              <thead><tr><th>구분</th><th>예정/실제</th><th>적용일</th><th>발표일</th><th>수집일</th><th>메모</th><th>기준일 반영</th><th /></tr></thead>
              <tbody>
                {ev.milestones.map((m, j) => (
                  <tr key={m.key}>
                    <td><Select label="" value={m.type} options={Object.entries(MILESTONE_LABEL) as [MilestoneType, string][]} onChange={(v) => update((x) => { x.events[idx].milestones[j].type = v; })} /></td>
                    <td><Select label="" value={m.status} options={[["planned", "예정"], ["actual", "실제"]]} onChange={(v) => update((x) => { x.events[idx].milestones[j].status = v as any; })} /></td>
                    <td><DateText label="" value={m.date} onChange={(v) => update((x) => { x.events[idx].milestones[j].date = v; })} /></td>
                    <td><DateText label="" value={m.announcedOn} onChange={(v) => update((x) => { x.events[idx].milestones[j].announcedOn = v; })} /></td>
                    <td><DateText label="" value={m.collectedOn} dayOnly onChange={(v) => update((x) => { x.events[idx].milestones[j].collectedOn = v; })} /></td>
                    <td><Text label="" value={m.note} onChange={(v) => update((x) => { x.events[idx].milestones[j].note = v; })} /></td>
                    <td>{er?.timeline.find((t) => t.key === m.key)?.knownAsOf === false ? <Badge tone="warn">기준일 이후 정보 — 제외</Badge> : "반영"}</td>
                    <td><button className="link" onClick={() => update((x) => { x.events[idx].milestones.splice(j, 1); })}>삭제</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <button onClick={() => update((x) => { x.events[idx].milestones.push({ key: newKey("ms"), type: "announcement", status: "planned", collectedOn: seoulToday(), evidenceKeys: [] }); })} data-testid="add-milestone">일정 추가</button>

            {er && (
              <div className="card sub small" data-testid="event-result">
                <div>기준일 현재 단계: <b>{er.stageAsOf}</b> · 최초 예정 {formatDateValue(er.initialTarget)} → 현재 {formatDateValue(er.expectedTarget)} {er.delayCount ? `(지연 ${er.delayCount}회)` : ""}</div>
                <div>본건 일정 비교: {er.scheduleGaps.length ? er.scheduleGaps.map((g) => g.text).join(" · ") : "본건 분양·준공 예정일 미입력 — 비교 안 함"}</div>
                <div>접근성: {er.access.text}</div>
                <div>근거 기록: {er.evidence.text}{er.evidence.afterAsOf ? ` · 기준일 이후 발행 근거 ${er.evidence.afterAsOf}건 제외` : ""}</div>
              </div>
            )}

            <h4>연결된 근거</h4>
            <EvidenceList rec={rec} update={update} eventKey={ev.key} eventIdx={idx} />
          </div>
        )}
      </div>

      <h4>위치 <span className="muted small">번호 마커 · 상세는 오른쪽 목록</span></h4>
      <MapPanel points={mapPoints} kakaoKey={session?.config.kakaoJsKey ?? null} />

      <h4>첨부 <span className="muted small">텍스트는 그대로 텍스트로만 표시 · HTML·스크립트·주소를 실행·조회하지 않음</span></h4>
      {!w.attachments.length ? <p className="muted small">첨부 없음</p> : (
        <table className="tbl small"><thead><tr><th>파일</th><th>크기</th><th>SHA-256</th><th>본문</th><th /></tr></thead>
          <tbody>{w.attachments.map((a, i) => <tr key={a.key}><td>{a.filename}</td><td>{a.size.toLocaleString("ko-KR")}B</td><td><code>{a.sha256.slice(0, 16)}…</code></td><td>{a.text ? <details><summary>보기</summary><pre className="plain">{a.text.slice(0, 5000)}</pre></details> : "보관 안 함"}</td><td><button className="link" onClick={() => update((x) => { x.attachments.splice(i, 1); })}>삭제</button></td></tr>)}</tbody></table>
      )}
    </Section>
  );
}

function EvidenceList({ rec, update, eventKey, eventIdx }: { rec: SectionProps["rec"]; update: SectionProps["update"]; eventKey: string; eventIdx: number }) {
  const w = rec.working;
  const linked = w.evidence.filter((e) => w.events[eventIdx].evidenceKeys.includes(e.key));
  type Draft = { publisher?: string; title?: string; sourceType: EvidenceSourceType; originalReviewed: boolean; sourceRef?: string; sourceUrl?: string; publishedOn?: string; effectiveOn?: string; pageOrSection?: string; fact?: string; status: EvidenceStatus; attachmentKey?: string };
  const empty: Draft = { status: "needsApplicability", sourceType: "other", originalReviewed: false };
  const [draft, setDraft] = useState<Draft>(empty);
  const add = () => {
    if (!draft.publisher || !draft.title || !draft.fact) return;
    const key = newKey("evd");
    update((x) => {
      x.evidence.push({ key, publisher: draft.publisher!, title: draft.title!, sourceType: draft.sourceType, originalReviewed: draft.originalReviewed, sourceRef: draft.sourceRef, sourceUrl: draft.sourceUrl, attachmentKey: draft.attachmentKey, publishedOn: draft.publishedOn, effectiveOn: draft.effectiveOn, checkedOn: seoulToday(), pageOrSection: draft.pageOrSection, fact: draft.fact!, status: draft.status, linked: [eventKey], dataMode: "user" });
      x.events[eventIdx].evidenceKeys.push(key);
    });
    setDraft(empty);
  };
  return (
    <>
      <table className="tbl small">
        <thead><tr><th>출처</th><th>발행일/자료 기준일/확인일</th><th>페이지·절</th><th>확인한 사실</th><th>기록 수준</th><th>내용 판단</th><th /></tr></thead>
        <tbody>
          {linked.map((e) => {
            const i = w.evidence.findIndex((x) => x.key === e.key);
            return (
              <tr key={e.key}>
                <td><span className="muted">[{e.sourceType ? EVIDENCE_SOURCE_LABEL[e.sourceType] : "종류 미기재"}]</span> {e.publisher} · {e.title}{e.sourceRef ? ` (${e.sourceRef})` : ""}{e.sourceUrl && <div className="muted">참고 주소(조회하지 않음): <code>{e.sourceUrl}</code></div>}{e.attachmentKey && <div className="muted">첨부: {w.attachments.find((a) => a.key === e.attachmentKey)?.filename ?? "삭제됨"}</div>}</td>
                <td>{e.publishedOn ?? "-"} / {e.effectiveOn ?? "-"} / {e.checkedOn ?? "-"}</td>
                <td>{e.pageOrSection ?? "-"}</td>
                <td>{e.fact}</td>
                <td data-testid="evidence-level">{EVIDENCE_LEVEL_LABEL[evidenceLevel(e)]}</td>
                <td><Select label="" value={e.status} options={Object.entries(EVIDENCE_STATUS_LABEL) as [EvidenceStatus, string][]} onChange={(v) => update((x) => { x.evidence[i].status = v; })} /> <ModeBadge mode={e.dataMode} /></td>
                <td><button className="link" onClick={() => update((x) => { x.events[eventIdx].evidenceKeys = x.events[eventIdx].evidenceKeys.filter((k) => k !== e.key); })}>연결 해제</button></td>
              </tr>
            );
          })}
          {!linked.length && <tr><td colSpan={7} className="muted">연결된 근거 없음</td></tr>}
        </tbody>
      </table>
      <div className="card sub">
        <b className="small">근거 추가</b> <span className="muted small">직접 읽은 문서만 기록. ‘공식 원문 대조 기록’ 수준은 공공기관 원문 + 문서번호 또는 첨부 + 페이지·절 + 발행일 + ‘원문 직접 대조’ 표시가 모두 있어야 하며, 그래도 앱이 자동 검증한 것은 아닙니다.</span>
        <div className="form grid">
          <Text label="발행기관" value={draft.publisher} onChange={(v) => setDraft({ ...draft, publisher: v })} testId="evd-publisher" />
          <Text label="문서명" value={draft.title} onChange={(v) => setDraft({ ...draft, title: v })} testId="evd-title" />
          <Select label="출처 종류" value={draft.sourceType} options={Object.entries(EVIDENCE_SOURCE_LABEL) as [EvidenceSourceType, string][]} onChange={(v) => setDraft({ ...draft, sourceType: v })} testId="evd-source-type" />
          <Text label="원문 식별자(문서번호 등)" value={draft.sourceRef} onChange={(v) => setDraft({ ...draft, sourceRef: v })} testId="evd-ref" />
          <Text label="참고 주소(텍스트로만 보관)" value={draft.sourceUrl} onChange={(v) => setDraft({ ...draft, sourceUrl: v })} />
          <DateText label="발행일" value={draft.publishedOn} onChange={(v) => setDraft({ ...draft, publishedOn: v })} testId="evd-published" />
          <DateText label="자료 기준일·적용일" value={draft.effectiveOn} onChange={(v) => setDraft({ ...draft, effectiveOn: v })} />
          <Text label="페이지·절" value={draft.pageOrSection} onChange={(v) => setDraft({ ...draft, pageOrSection: v })} testId="evd-page" />
          <Check label="공식 원문을 직접 대조함" checked={draft.originalReviewed} onChange={(v) => setDraft({ ...draft, originalReviewed: v })} testId="evd-reviewed" />
          <Select label="내용 판단" value={draft.status} options={Object.entries(EVIDENCE_STATUS_LABEL) as [EvidenceStatus, string][]} onChange={(v) => setDraft({ ...draft, status: v })} />
          <Select label="첨부 연결" value={draft.attachmentKey} allowEmpty options={w.attachments.map((a) => [a.key, a.filename] as [string, string])} onChange={(v) => setDraft({ ...draft, attachmentKey: v || undefined })} />
          <Text label="확인한 사실" value={draft.fact} onChange={(v) => setDraft({ ...draft, fact: v })} wide testId="evd-fact" />
        </div>
        <button onClick={add} disabled={!draft.publisher || !draft.title || !draft.fact} data-testid="add-evidence">근거 추가·연결</button>
      </div>
    </>
  );
}
