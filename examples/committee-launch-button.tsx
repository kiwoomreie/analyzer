// 인계물 ④ — 협의체 → 분석기 단방향 ‘분석기 시동’ 버튼 최소 예제(+ ‘채권정보 포함’ 옵션).
//
// 동작: 버튼(type="button") 클릭 → 허용 필드만 고른 사본(JSON) → 기존 form 밖에 만든 별도 form으로
//       HTTPS POST(application/x-www-form-urlencoded, hidden 필드 payload) → target=_blank, rel=noopener noreferrer.
// 하지 않는 것: iframe·postMessage·window 참조·콜백·상태조회·결과 반환, 기존 form 제출, 원본 저장, 기존 서버 호출,
//               URL query·fragment에 가정값 넣기, 매번 확인창 띄우기.
//
// ⚠ 예시 필드(CommitteeAssumptionsExample)는 실제 Archive 필드와 다를 수 있음. 실제 연결은 후속 작업에서 매핑한다.
import { useEffect, useState } from "react";
import { selectImportAssumptions, selectLaunchAssumptions, type CommitteeAssumptionsExample } from "./select-launch-assumptions.ts";

export const LAUNCH_MAX_BYTES = 64 * 1024;

export type LaunchUrlCheck = { ok: true; url: string } | { ok: false; reason: string };

/**
 * 설정된 목적지(ANALYZER_LAUNCH_URL)만 허용. 사용자 입력·파일 속 주소로 목적지를 바꾸지 않는다.
 * 운영은 https 만. localhost/127.0.0.1 은 allowLocalhost=true(로컬 시험)일 때만.
 */
export function checkLaunchUrl(configured: string | undefined | null, allowLocalhost = false): LaunchUrlCheck {
  if (!configured) return { ok: false, reason: "운영 주소 미설정" };
  let u: URL;
  try { u = new URL(configured); } catch { return { ok: false, reason: "운영 주소 형식 오류" }; }
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (u.username || u.password || u.search || u.hash) return { ok: false, reason: "주소에 계정정보·query·fragment를 넣을 수 없음" };
  if (!u.pathname.endsWith("/launch")) return { ok: false, reason: "수신 경로는 /launch 이어야 함" };
  if (u.protocol === "https:" && !local) return { ok: true, url: u.toString() };
  if (allowLocalhost && local && (u.protocol === "http:" || u.protocol === "https:")) return { ok: true, url: u.toString() };
  return { ok: false, reason: "https 운영 주소만 허용(로컬 시험 모드 아님)" };
}

export type SubmitOutcome = { status: "attempted" } | { status: "blocked"; reason: string };

/**
 * 반드시 사용자 클릭 처리 안에서 호출(팝업 차단 방지). 새 탭의 결과를 기다리지 않는다.
 * form은 document.body 에 따로 붙였다가 제출 후 제거 — 기존 협의체 form 안에 중첩하지 않는다.
 */
export function submitLaunch(launchUrl: string, payloadJson: string, doc: Document = document): SubmitOutcome {
  const bytes = new TextEncoder().encode(payloadJson).length;
  if (bytes > LAUNCH_MAX_BYTES) return { status: "blocked", reason: `사본 크기(${bytes}B)가 64KiB 상한 초과 — 파일 내보내기 사용` };
  const form = doc.createElement("form");
  form.method = "POST";
  form.action = launchUrl;
  form.target = "_blank";
  form.rel = "noopener noreferrer";
  form.enctype = "application/x-www-form-urlencoded";
  form.style.display = "none";
  const input = doc.createElement("input");
  input.type = "hidden";
  input.name = "payload";
  input.value = payloadJson;
  form.appendChild(input);
  doc.body.appendChild(form);
  try { form.submit(); } finally { form.remove(); }
  return { status: "attempted" };
}

function newId(): string {
  const c = globalThis.crypto;
  return c?.randomUUID ? c.randomUUID() : `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function nowIsoSeoul(): string {
  return new Date(Date.now() + 9 * 3600000).toISOString().replace("Z", "+09:00");
}

function downloadJson(filename: string, obj: unknown) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" }));
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export interface AnalyzerLaunchButtonProps {
  /** 현재 화면의 협의체 가정(허용 필드는 선택 함수가 고름) */
  currentAssumptions: CommitteeAssumptionsExample;
  /** 현재 사업장을 구분하는 화면 내부 값. 바뀌면 ‘채권정보 포함’ 선택을 초기화. 전송하지 않음. */
  siteKey: string;
  /** 설정된 ANALYZER_LAUNCH_URL. 없으면 버튼 비활성 + ‘운영 주소 미설정’ */
  launchUrl: string | null | undefined;
  allowLocalhost?: boolean;
  sourceLabel?: string;
}

export function AnalyzerLaunchButton(p: AnalyzerLaunchButtonProps) {
  const [includeDebt, setIncludeDebt] = useState(false);
  const [notice, setNotice] = useState<string>("");
  useEffect(() => { setIncludeDebt(false); setNotice(""); }, [p.siteKey]); // 사업장 변경 시 선택을 이어받지 않음
  const target = checkLaunchUrl(p.launchUrl, p.allowLocalhost);
  const hasDebt = !!p.currentAssumptions.debt;

  const onLaunch = () => {
    if (!target.ok) return setNotice(target.reason);
    const { document: doc, skipped } = selectLaunchAssumptions(p.currentAssumptions, { launchId: newId(), createdAt: nowIsoSeoul(), sourceLabel: p.sourceLabel, includeDebt });
    const r = submitLaunch(target.url, JSON.stringify(doc));
    setNotice(r.status === "attempted"
      ? `분석기로 전송을 시도했습니다. 결과는 새 탭의 분석기에서 확인하십시오(이 화면은 수신 여부를 확인하지 않음).${skipped.length ? ` 보내지 않은 항목 ${skipped.length}개는 분석기에서 보완하십시오.` : ""}`
      : r.reason);
  };

  const onExport = () => {
    const { document: doc } = selectImportAssumptions(p.currentAssumptions, { exportId: newId(), exportedAt: nowIsoSeoul(), sourceLabel: p.sourceLabel, includeDebt });
    downloadJson(`location-analysis-import-${doc.asOf}.json`, doc);
    setNotice("파일로 내보냈습니다. 분석기 첫 화면의 ‘파일 가져오기’로 여십시오.");
  };

  return (
    <div className="analyzer-launch" data-testid="analyzer-launch">
      <label>
        <input type="checkbox" checked={includeDebt} disabled={!hasDebt} onChange={(e: any) => setIncludeDebt(e.target.checked)} data-testid="include-debt" /> 채권정보 포함
        {!hasDebt && <small> (채권정보 없음)</small>}
      </label>
      <button type="button" onClick={onLaunch} disabled={!target.ok} data-testid="launch-button">분석기 시동</button>
      <button type="button" onClick={onExport} data-testid="export-button">파일로 내보내기</button>
      {!target.ok && <small data-testid="launch-url-status">{target.reason}</small>}
      {notice && <p role="status" data-testid="launch-notice">{notice}</p>}
    </div>
  );
}
