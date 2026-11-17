// 가상 데모 자료. 모든 이름에 [가상]을 붙이고 dataMode="demo"로 표시한다.
// 개수(사업장 5·사건 4)는 사용 흐름 시험용이며 통계적 타당성을 보장하는 표본이 아니다.
import { emptyWorking, newKey, type Evidence, type LocationEvent, type Transaction, type WorkingInputs } from "./model.ts";

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COLLECTED = "2026-10-31";

function demoEvidence(): Evidence[] {
  return [
    { key: "evd_demo_1", publisher: "[가상] 국토교통부", title: "[가상] 가람선 광역철도 기본계획 고시", sourceRef: "[가상] 고시 제2024-000호", publishedOn: "2024-02-20", effectiveOn: "2024-02-20", checkedOn: COLLECTED, pageOrSection: "[가상] 3쪽 2절", fact: "[가상] 가람선 신설역(가칭 누리역) 설치를 포함한 기본계획 고시", status: "confirmed", linked: ["ev_demo_rail"], dataMode: "demo" },
    { key: "evd_demo_2", publisher: "[가상] 국가철도공단", title: "[가상] 가람선 사업 추진현황 보도자료", publishedOn: "2026-05-20", checkedOn: COLLECTED, pageOrSection: "[가상] 본문 2문단", fact: "[가상] 개통 목표를 2029년 12월에서 2031년 6월로 조정", status: "confirmed", linked: ["ev_demo_rail"], dataMode: "demo" },
    { key: "evd_demo_3", publisher: "[가상] 누리시", title: "[가상] 첨단업무지구 개발계획 승인 공고", publishedOn: "2024-04-10", checkedOn: COLLECTED, fact: "[가상] 업무지구 개발계획 승인. 고용 규모는 계획 수치이며 입주 확정 아님", status: "needsApplicability", linked: ["ev_demo_biz"], dataMode: "demo" },
    { key: "evd_demo_4", publisher: "[가상] 분양 광고", title: "[가상] 하늘마을 3블록 분양 안내", publishedOn: "2026-08-01", checkedOn: COLLECTED, fact: "[가상] 공급 세대수 표기가 인허가 자료와 다름", status: "inconsistent", linked: ["ev_demo_supply1"], dataMode: "demo" },
  ];
}

function demoEvents(): LocationEvent[] {
  return [
    {
      key: "ev_demo_rail", category: "transport", name: "[가상] 가람선 누리역 신설", direction: "favorable",
      location: { lat: 37.4105, lng: 127.1290, label: "[가상] 누리역 예정지" },
      milestones: [
        { key: "ms_r1", type: "announcement", status: "actual", date: "2023-03-15", announcedOn: "2023-03-15", collectedOn: COLLECTED, evidenceKeys: [] },
        { key: "ms_r2", type: "notice", status: "actual", date: "2024-02-20", announcedOn: "2024-02-20", collectedOn: COLLECTED, evidenceKeys: ["evd_demo_1"] },
        { key: "ms_r3", type: "opening", status: "planned", date: "2029-12", announcedOn: "2024-02-20", collectedOn: COLLECTED, note: "[가상] 최초 개통 목표", evidenceKeys: ["evd_demo_1"] },
        { key: "ms_r4", type: "constructionStart", status: "actual", date: "2025-06", announcedOn: "2025-06-30", collectedOn: COLLECTED, evidenceKeys: [] },
        { key: "ms_r5", type: "delay", status: "planned", date: "2031-06", announcedOn: "2026-05-20", collectedOn: COLLECTED, note: "[가상] 개통 목표 조정", evidenceKeys: ["evd_demo_2"] },
      ],
      evidenceKeys: ["evd_demo_1", "evd_demo_2"], dataMode: "demo",
    },
    {
      key: "ev_demo_biz", category: "employment", name: "[가상] 누리 첨단업무지구", direction: "favorable",
      location: { lat: 37.4182, lng: 127.1405, label: "[가상] 업무지구 부지" },
      milestones: [
        { key: "ms_b1", type: "announcement", status: "actual", date: "2022-09-01", announcedOn: "2022-09-01", collectedOn: COLLECTED, evidenceKeys: [] },
        { key: "ms_b2", type: "approval", status: "actual", date: "2024-04-10", announcedOn: "2024-04-10", collectedOn: COLLECTED, evidenceKeys: ["evd_demo_3"] },
        { key: "ms_b3", type: "constructionStart", status: "planned", date: "2027-03", announcedOn: "2024-04-10", collectedOn: COLLECTED, evidenceKeys: [] },
        { key: "ms_b4", type: "opening", status: "planned", date: "2030-06", announcedOn: "2024-04-10", collectedOn: COLLECTED, note: "[가상] 1단계 입주 목표", evidenceKeys: [] },
      ],
      evidenceKeys: ["evd_demo_3"], dataMode: "demo",
    },
    {
      key: "ev_demo_supply1", category: "supply", name: "[가상] 하늘마을 3블록", direction: "adverse",
      location: { lat: 37.4050, lng: 127.1200 },
      milestones: [{ key: "ms_s1", type: "sale", status: "actual", date: "2026-09", announcedOn: "2026-08-01", collectedOn: COLLECTED, evidenceKeys: ["evd_demo_4"] }],
      supply: { stage: "sale", households: 1200, areaMinM2: 59, areaMaxM2: 99, priceMinPerM2Krw: 9_000_000, priceMaxPerM2Krw: 10_500_000, saleDate: "2026-09", occupancyDate: "2029-03", demandGroups: ["신혼·자녀양육", "실수요 갈아타기"] },
      evidenceKeys: ["evd_demo_4"], dataMode: "demo",
    },
    {
      key: "ev_demo_supply2", category: "supply", name: "[가상] 강변 공공택지 B2", direction: "adverse",
      location: { lat: 37.3990, lng: 127.1350 },
      milestones: [{ key: "ms_s2", type: "permit", status: "planned", date: "2027-06", announcedOn: "2026-03-01", collectedOn: COLLECTED, evidenceKeys: [] }],
      supply: { stage: "permit", households: 800, areaMinM2: 74, areaMaxM2: 114, saleDate: "2028-03", demandGroups: ["실수요 갈아타기"] },
      evidenceKeys: [], dataMode: "demo",
    },
  ];
}

function demoTransactions(seed: number): Transaction[] {
  const rnd = mulberry32(seed);
  const out: Transaction[] = [];
  const complexes = { target: ["[가상] 가람마을 1단지", "[가상] 가람마을 2단지", "[가상] 누리숲 아파트", "[가상] 은빛마을"], comparator: ["[가상] 동편마을 A", "[가상] 동편마을 B", "[가상] 서촌 아파트"] };
  for (let y = 2021; y <= 2026; y++) {
    for (let m = 1; m <= 12; m++) {
      if (y === 2026 && m > 10) break;
      const t = (y - 2021) * 12 + m - 1;
      const post = t >= 26; // 2023-03 이후
      for (const group of ["target", "comparator"] as const) {
        const n = 2 + Math.floor(rnd() * 4);
        for (let i = 0; i < n; i++) {
          const area = [59.9, 84.9, 84.97, 101.9][Math.floor(rnd() * 4)];
          const base = group === "target" ? 8_600_000 : 8_300_000;
          const trend = group === "target" ? (post ? 0.0042 : 0.0015) : (post ? 0.003 : 0.0015);
          const perM2 = base * (1 + trend * t) * (0.93 + rnd() * 0.14);
          const day = 1 + Math.floor(rnd() * 27);
          out.push({
            key: newKey("tx"), complexName: complexes[group][Math.floor(rnd() * complexes[group].length)], exclusiveAreaM2: area, floor: 1 + Math.floor(rnd() * 25),
            priceKrw: Math.round((perM2 * area) / 1e5) * 1e5, contractDate: `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
            cancelled: rnd() < 0.04, group, dataMode: "demo",
          });
        }
      }
    }
  }
  return out;
}

interface DemoSite { name: string; address: string; lat: number; lng: number; area: number; type: string; proposedEok: number; maturity: string; saleStart: string; completion: string; appraisalEok?: number; debtEok?: number; decline?: number; delay?: number }

const SITES: DemoSite[] = [
  { name: "[가상] 누리역 A1 공동주택", address: "[가상] 누리시 가람동 100", lat: 37.4120, lng: 127.1260, area: 84, type: "84A", proposedEok: 8.4, maturity: "2030-11", saleStart: "2027-03", completion: "2029-12", appraisalEok: 1000, debtEok: 600, decline: 10, delay: 24 },
  { name: "[가상] 가람동 B3 공동주택", address: "[가상] 누리시 가람동 220", lat: 37.4075, lng: 127.1330, area: 59, type: "59B", proposedEok: 5.9, maturity: "2029-06", saleStart: "2026-12", completion: "2029-03", decline: 15 },
  { name: "[가상] 업무지구 인근 C2", address: "[가상] 누리시 새솔동 15", lat: 37.4200, lng: 127.1440, area: 101, type: "101A", proposedEok: 10.8, maturity: "2031-09", saleStart: "2027-09", completion: "2030-09", appraisalEok: 1450 },
  { name: "[가상] 동편 D1 공동주택", address: "[가상] 누리시 동편동 7", lat: 37.4010, lng: 127.1500, area: 84, type: "84B", proposedEok: 7.6, maturity: "2030-03", saleStart: "2027-01", completion: "2029-09", delay: 12 },
  { name: "[가상] 강변 E5 공동주택", address: "[가상] 누리시 강변동 31", lat: 37.3970, lng: 127.1210, area: 74, type: "74A", proposedEok: 6.9, maturity: "2030-12", saleStart: "2027-06", completion: "2030-06" },
];

export function demoWorkings(): { title: string; working: WorkingInputs }[] {
  return SITES.map((s, i) => {
    const w = emptyWorking("2026-10-31", "apartment");
    w.property = { displayName: s.name, address: s.address, coordinates: { lat: s.lat, lng: s.lng, senderVerified: false }, assetType: "apartment", exclusiveAreaM2: s.area, comparisonType: s.type, targetDemand: ["신혼·자녀양육", "실수요 갈아타기"] };
    w.prices = [{ key: "price_1", kind: "proposedSalePrice", amount: s.proposedEok, unit: "KRW_100M", basis: "household", basisDate: "2026-10", dataMode: "demo" }];
    if (s.appraisalEok) w.prices.push({ key: "price_2", kind: "appraisalValue", amount: s.appraisalEok, unit: "KRW_100M", basis: "project", basisDate: "2026-09-30", dataMode: "demo" });
    if (s.debtEok) {
      w.debt = { amount: s.debtEok, unit: "KRW_100M", definition: "loanBalance", seniorStatus: "confirmedNone", basisDate: "2026-09-30", dataMode: "demo" };
      w.ltvChecks.collateralScopeConfirmed = true;
    }
    w.schedule = { saleStart: s.saleStart, completion: s.completion, maturity: s.maturity, expectedDisposal: s.maturity };
    w.scenario = { name: "[가상] 기본 점검", ...(s.decline ? { priceDeclinePct: s.decline } : {}), ...(s.delay ? { eventDelayMonths: s.delay } : {}) };
    w.options.purpose = "[가상] 사용 흐름 시험";
    w.appraisalNote = i === 0 ? "[가상] 평가서에 광역철도 계획을 입지 장점으로 서술(반영 비율 미기재)" : undefined;
    w.events = demoEvents();
    w.evidence = demoEvidence();
    w.transactions = demoTransactions(1000 + i);
    w.indexComparisons = i === 0 ? [{ key: "idx_demo", label: "[가상] 권역 지수 비교 예시", periodStart: "2023-03", periodEnd: "2026-09", targetStart: 100, targetEnd: 112, comparatorStart: 100, comparatorEnd: 108, source: "[가상] 검증용 산술 예시", dataMode: "demo" }] : [];
    return { title: s.name, working: w };
  });
}
