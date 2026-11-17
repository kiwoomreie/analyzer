// 가상 데모 자료(아파트 1건). 모든 이름에 [가상]을 붙이고 dataMode="demo"로 표시한다.
// 사용 흐름 시험용이며 실제 시장·통계적 타당성과 무관하다.
import { complexKeyOf, emptyWorking, newKey, type ComplexInfo, type Evidence, type LocationEvent, type Transaction, type WorkingInputs } from "./model.ts";

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const C = "2026-10-31";
const SRC = "[가상] 데모 거래 생성기";

const EVIDENCE: Evidence[] = [
  { key: "evd_d1", publisher: "[가상] 국토교통부", title: "[가상] 가람선 광역철도 기본계획 고시", sourceRef: "[가상] 고시 제2024-000호", publishedOn: "2024-02-20", effectiveOn: "2024-02-20", checkedOn: C, pageOrSection: "[가상] 3쪽 2절", fact: "[가상] 누리역(가칭) 신설 포함", status: "confirmed", linked: ["ev_rail"], dataMode: "demo" },
  { key: "evd_d2", publisher: "[가상] 국가철도공단", title: "[가상] 가람선 추진현황 보도자료", publishedOn: "2026-05-20", checkedOn: C, pageOrSection: "[가상] 본문 2문단", fact: "[가상] 개통 목표 2029년 12월 → 2031년 6월 조정", status: "confirmed", linked: ["ev_rail"], dataMode: "demo" },
  { key: "evd_d3", publisher: "[가상] 누리시", title: "[가상] 첨단업무지구 개발계획 승인 공고", publishedOn: "2024-04-10", checkedOn: C, fact: "[가상] 개발계획 승인. 입주 기업은 미확정", status: "needsApplicability", linked: ["ev_biz"], dataMode: "demo" },
  { key: "evd_d4", publisher: "[가상] 분양 광고", title: "[가상] 하늘마을 3블록 분양 안내", publishedOn: "2026-08-01", checkedOn: C, fact: "[가상] 세대수 표기가 인허가 자료와 다름", status: "inconsistent", linked: ["ev_sup1"], dataMode: "demo" },
];

const EVENTS: LocationEvent[] = [
  {
    key: "ev_rail", category: "transport", name: "[가상] 가람선 누리역 신설", direction: "favorable", location: { lat: 37.4105, lng: 127.129 },
    milestones: [
      { key: "m1", type: "announcement", status: "actual", date: "2023-03-15", announcedOn: "2023-03-15", collectedOn: C, evidenceKeys: [] },
      { key: "m2", type: "notice", status: "actual", date: "2024-02-20", announcedOn: "2024-02-20", collectedOn: C, evidenceKeys: ["evd_d1"] },
      { key: "m3", type: "opening", status: "planned", date: "2029-12", announcedOn: "2024-02-20", collectedOn: C, note: "[가상] 최초 개통 목표", evidenceKeys: ["evd_d1"] },
      { key: "m4", type: "constructionStart", status: "actual", date: "2025-06", announcedOn: "2025-06-30", collectedOn: C, evidenceKeys: [] },
      { key: "m5", type: "delay", status: "planned", date: "2031-06", announcedOn: "2026-05-20", collectedOn: C, note: "[가상] 개통 목표 조정", evidenceKeys: ["evd_d2"] },
    ],
    evidenceKeys: ["evd_d1", "evd_d2"], dataMode: "demo",
  },
  {
    key: "ev_mall", category: "amenity", name: "[가상] 누리 복합쇼핑몰", direction: "favorable", location: { lat: 37.4142, lng: 127.1235 },
    milestones: [
      { key: "a1", type: "permit", status: "actual", date: "2025-09", announcedOn: "2025-09-12", collectedOn: C, evidenceKeys: [] },
      { key: "a2", type: "opening", status: "planned", date: "2028-03", announcedOn: "2025-09-12", collectedOn: C, evidenceKeys: [] },
    ],
    evidenceKeys: [], dataMode: "demo",
  },
  {
    key: "ev_biz", category: "development", name: "[가상] 누리 첨단업무지구", direction: "favorable", location: { lat: 37.4182, lng: 127.1405 },
    milestones: [
      { key: "b1", type: "announcement", status: "actual", date: "2022-09-01", announcedOn: "2022-09-01", collectedOn: C, evidenceKeys: [] },
      { key: "b2", type: "approval", status: "actual", date: "2024-04-10", announcedOn: "2024-04-10", collectedOn: C, evidenceKeys: ["evd_d3"] },
      { key: "b3", type: "opening", status: "planned", date: "2030-06", announcedOn: "2024-04-10", collectedOn: C, note: "[가상] 1단계 준공 목표", evidenceKeys: [] },
    ],
    evidenceKeys: ["evd_d3"], dataMode: "demo",
  },
  {
    key: "ev_sup1", category: "supply", name: "[가상] 하늘마을 3블록", direction: "adverse", location: { lat: 37.405, lng: 127.12 },
    milestones: [{ key: "s1", type: "sale", status: "actual", date: "2026-09", announcedOn: "2026-08-01", collectedOn: C, evidenceKeys: ["evd_d4"] }],
    supply: { stage: "sale", households: 1200, areaMinM2: 59, areaMaxM2: 99, saleDate: "2026-09", occupancyDate: "2029-03" },
    evidenceKeys: ["evd_d4"], dataMode: "demo",
  },
  {
    key: "ev_sup2", category: "supply", name: "[가상] 강변 공공택지 B2", direction: "adverse", location: { lat: 37.399, lng: 127.135 },
    milestones: [{ key: "s2", type: "permit", status: "planned", date: "2027-06", announcedOn: "2026-03-01", collectedOn: C, evidenceKeys: [] }],
    supply: { stage: "permit", households: 800, areaMinM2: 74, areaMaxM2: 114, saleDate: "2028-03" },
    evidenceKeys: [], dataMode: "demo",
  },
];

/** [가상] 단지: 이름, 법정동, 준공연도, 좌표, 기준 ㎡당 단가, 월 평균 거래 */
const COMPLEXES: [string, string, number, number, number, number, number][] = [
  ["[가상] 가람마을 1단지", "[가상] 가람동", 2019, 37.4131, 127.1272, 9_400_000, 1.4],
  ["[가상] 가람마을 2단지", "[가상] 가람동", 2020, 37.4098, 127.1301, 9_600_000, 1.2],
  ["[가상] 누리숲 아파트", "[가상] 새솔동", 2016, 37.4165, 127.1312, 8_900_000, 1.0],
  ["[가상] 은빛마을", "[가상] 가람동", 2012, 37.4081, 127.1215, 8_100_000, 0.9],
  ["[가상] 새솔 센트럴", "[가상] 새솔동", 2022, 37.4190, 127.1260, 10_200_000, 0.7],
  ["[가상] 동편마을 A", "[가상] 동편동", 2018, 37.4010, 127.1500, 8_500_000, 1.3],
  ["[가상] 옛터 주공", "[가상] 가람동", 1994, 37.4115, 127.1240, 6_900_000, 1.0],
  ["[가상] 작은숲 빌", "[가상] 새솔동", 2021, 37.4150, 127.1285, 9_800_000, 0.08],
];

function demoTransactions(): { tx: Transaction[]; info: ComplexInfo[] } {
  const rnd = mulberry32(42);
  const tx: Transaction[] = [];
  const info: ComplexInfo[] = [];
  for (const [name, dong, by, lat, lng, base, rate] of COMPLEXES) {
    info.push({ complexKey: complexKeyOf({ complexName: name, dong }), location: { lat, lng } });
    for (let y = 2021; y <= 2026; y++) for (let m = 1; m <= 12; m++) {
      if (y === 2026 && m > 10) break;
      const t = (y - 2021) * 12 + m - 1;
      const trend = 1 + (t >= 26 ? 0.0035 : 0.0012) * t;
      const n = Math.floor(rate + rnd());
      for (let i = 0; i < n; i++) {
        const area = [59.98, 84.95, 84.99, 101.9][Math.floor(rnd() * 4)];
        const perM2 = base * trend * (0.94 + rnd() * 0.12);
        tx.push({
          key: newKey("tx"), complexName: name, dong, exclusiveAreaM2: area, floor: 1 + Math.floor(rnd() * 25), priceKrw: Math.round((perM2 * area) / 1e5) * 1e5,
          contractDate: `${y}-${String(m).padStart(2, "0")}-${String(1 + Math.floor(rnd() * 27)).padStart(2, "0")}`, cancelled: rnd() < 0.04, buildYear: by, dataMode: "demo", source: SRC,
        });
      }
    }
  }
  return { tx, info };
}

export function demoWorking(): WorkingInputs {
  const w = emptyWorking("[가상] 누리시 가람동 100", C);
  w.property = { address: "[가상] 누리시 가람동 100", displayName: "[가상] 누리역 A1 공동주택", coordinates: { lat: 37.412, lng: 127.126, source: "[가상] 데모 좌표" }, exclusiveAreaM2: 84, buildYear: 2029, comparisonType: "84A" };
  w.reviewPrice = { amount: 9.6, unit: "KRW_100M", basis: "household", basisDate: "2026-10", label: "[가상] 제시 분양가", dataMode: "demo" };
  w.schedule = { saleStart: "2027-03", completion: "2029-12" };
  w.appraisalNote = "[가상] 분양가 산정 자료에 광역철도 계획을 입지 장점으로 서술(반영 비율 미기재)";
  w.events = structuredClone(EVENTS);
  w.evidence = structuredClone(EVIDENCE);
  const { tx, info } = demoTransactions();
  w.transactions = tx;
  w.complexInfo = info;
  w.dataLog = [{ at: C, source: "[가상] 데모", detail: "가상 단지 8곳 거래·입지 사건 5건 생성" }];
  return w;
}
