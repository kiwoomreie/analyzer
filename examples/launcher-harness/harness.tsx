// [대기·미확정 초안] 협의체 연동은 입력 규격·수신 주소 확정 전까지 대기 상태입니다. docs/committee-button-integration.md 참고.
// 인계물 ⑤ — LauncherHarness: 기존 협의체 없이 버튼 실행·새 탭·자동 입력·자동 분석을 검증하는 [가상] 송신 화면.
// 실제 Archive 화면이 아니며, 이 화면의 성공을 ‘Archive 연결 완료’로 보지 않는다.
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { AnalyzerLaunchButton } from "../committee-launch-button.tsx";
import type { CommitteeAssumptionsExample } from "../select-launch-assumptions.ts";

const meta = (n: string) => document.querySelector(`meta[name="${n}"]`)?.getAttribute("content") ?? "";
const LAUNCH_URL = meta("analyzer-launch-url").startsWith("__") ? "" : meta("analyzer-launch-url");
const ALLOW_LOCAL = meta("analyzer-allow-localhost") === "1";

const SITES: Record<string, CommitteeAssumptionsExample> = {
  s1: {
    site: { name: "[가상] 누리역 A1 공동주택", address: "[가상] 누리시 가람동 100", lat: 37.412, lng: 127.126, coordinateConfirmed: true, assetType: "아파트", unitExclusiveAreaM2: 84, typeName: "84A", households: 620 },
    pricing: { salePrice: { value: 8.4, unit: "억원", basis: "세대당", basisDate: "2026-10" }, appraisal: { value: 1000, unit: "억원", basis: "사업 전체", basisDate: "2026-09-30" } },
    debt: { amount: 600, unit: "억원", definition: "대출잔액", senior: "없음", basisDate: "2026-09-30" },
    schedule: { saleStart: "2027-03", completion: "2029-12", maturity: "2030-11", disposal: "2030-11" },
    scenario: { name: "[가상] 하락 10%·지연 24개월", priceDeclinePct: 10, eventDelayMonths: 24 },
    analysis: { asOf: "2026-10-31", purpose: "[가상] 시동 시험" },
    cashflow: { note: "[가상] 전달 금지 — 선택 함수가 읽지 않음" }, votes: ["긍정", "보류"], reviewers: 17,
  },
  s2: {
    site: { name: "[가상] 가람동 B3 공동주택", address: "[가상] 누리시 가람동 220", assetType: "아파트", unitExclusiveAreaM2: 59 },
    pricing: { salePrice: { value: 59000, unit: "만원", basis: "세대당", basisDate: "2026-10-15" } },
    schedule: { maturity: "2029.06" },
    scenario: { name: "[가상] 기본" },
    analysis: { asOf: "2026-10-31" },
  },
  s3: {
    site: { name: "[가상] 도심 오피스 C", address: "[가상] 누리시 중앙로 1", assetType: "오피스" },
    pricing: { appraisal: { value: 2500, unit: "억원", basis: "사업 전체", basisDate: "2026-09" } },
    debt: { amount: 1500, unit: "억원", definition: "채권최고액", senior: "미확인" },
    schedule: { maturity: "2031-03" },
    scenario: {},
    analysis: { asOf: "2026-10-31" },
  },
};

function Harness() {
  const [siteKey, setSiteKey] = useState("s1");
  const [state, setState] = useState<Record<string, CommitteeAssumptionsExample>>(SITES);
  const [saved, setSaved] = useState(0);
  const cur = state[siteKey];
  const setPrice = (v: string) => setState({ ...state, [siteKey]: { ...cur, pricing: { ...cur.pricing, salePrice: { ...cur.pricing.salePrice, value: v === "" ? undefined : Number(v) } } } });
  const setDecline = (v: string) => setState({ ...state, [siteKey]: { ...cur, scenario: { ...cur.scenario, priceDeclinePct: v === "" ? undefined : Number(v) } } });
  // 기존 협의체의 원본 저장을 흉내 내는 form(분석기 버튼은 이 form을 제출하지 않아야 함)
  const onSave = async (e: any) => {
    e.preventDefault();
    await fetch("/committee-api/save", { method: "POST" });
    setSaved((n) => n + 1);
  };
  return (
    <>
      <header><b>[가상] LauncherHarness</b> <small>— 실제 협의체(Archive)가 아닌 모의 송신 화면 · 모든 값은 가상</small></header>
      <main>
        {!LAUNCH_URL && <p className="warn" data-testid="harness-unset">운영 주소 미설정 — ANALYZER_LAUNCH_URL 이 없어 전송 버튼이 비활성입니다.</p>}
        <div className="card">
          <label>사업장
            <select value={siteKey} onChange={(e: any) => setSiteKey(e.target.value)} data-testid="site-select">
              {Object.entries(state).map(([k, v]) => <option key={k} value={k}>{v.site.name}</option>)}
            </select>
          </label>
          <span>목적지: <code data-testid="launch-target">{LAUNCH_URL || "미설정"}</code>{ALLOW_LOCAL ? " (로컬 시험 모드)" : ""}</span>
        </div>
        <form className="card" onSubmit={onSave} data-testid="committee-form">
          <b>[가상] 협의체 가정 입력</b>
          <div>
            <label>제시 분양가(세대당)<input data-testid="h-price" value={cur.pricing.salePrice?.value ?? ""} onChange={(e: any) => setPrice(e.target.value)} /></label>
            <label>단위<input value={cur.pricing.salePrice?.unit ?? ""} readOnly /></label>
            <label>하락률(%)<input data-testid="h-decline" value={cur.scenario.priceDeclinePct ?? ""} onChange={(e: any) => setDecline(e.target.value)} /></label>
            <button type="submit">가정 저장(원본 — 모의)</button> <small data-testid="save-count">원본 저장 {saved}회</small>
          </div>
          <AnalyzerLaunchButton currentAssumptions={cur} siteKey={siteKey} launchUrl={LAUNCH_URL} allowLocalhost={ALLOW_LOCAL} sourceLabel="[가상] LauncherHarness" />
        </form>
      </main>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);
