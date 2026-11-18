// 모의 공공 API 응답(국토부 실거래·카카오 로컬 형식을 흉내). 실제 API 검증을 대신하지 않는다.
/** 모의 공공 API. 실제 국토부·카카오 응답 형식을 흉내 낸 것으로, 실제 API 검증을 대신하지 않는다. */
export const mockState = { failYm: "" as string, failPoints: 0, failGeocode: false, manyRegions: false, delayMs: 0 };
export const item = (name: string, umd: string, jibun: string, day: number, sgg: string) => `<item><aptNm>${name}</aptNm><aptSeq>${sgg}-${jibun}</aptSeq><sggCd>${sgg}</sggCd><umdNm>${umd}</umdNm><jibun>${jibun}</jibun><excluUseAr>84.97</excluUseAr><dealAmount> 95,000</dealAmount><dealYear>2026</dealYear><dealMonth>9</dealMonth><dealDay>${day}</dealDay><floor>7</floor><buildYear>2019</buildYear><cdealType></cdealType></item>`;
export async function mockTransport(u: URL) {
  if (mockState.delayMs) await new Promise((r) => setTimeout(r, mockState.delayMs));
  const json = (o: unknown) => ({ status: 200, headers: {}, body: Buffer.from(JSON.stringify(o)) });
  if (u.pathname.includes("coord2regioncode")) {
    if (mockState.failPoints > 0) { mockState.failPoints--; return { status: 500, headers: {}, body: Buffer.alloc(0) }; }
    if (mockState.manyRegions) {
      const code = String(41100 + Math.round((Number(u.searchParams.get("x")) - 127) * 10000) % 9 * 10 + Math.round((Number(u.searchParams.get("y")) - 37) * 1000) % 3);
      return json({ documents: [{ region_type: "B", code: `${code}00000`, region_1depth_name: "가상도", region_2depth_name: `구${code}` }] });
    }
    const east = Number(u.searchParams.get("x")) > 127.126;
    return json({ documents: [{ region_type: "B", code: east ? "4113510900" : "4113310100", region_1depth_name: "경기도", region_2depth_name: east ? "성남시 분당구" : "성남시 수정구" }] });
  }
  if (u.hostname === "dapi.kakao.com") {
    const q = u.searchParams.get("query") ?? "";
    if (q.includes("없는지번") || (mockState.failGeocode && q.includes("번지"))) return json({ documents: [] });
    return json({ documents: [{ x: "127.126", y: q.includes("2번지") ? "37.4125" : "37.412", address: { b_code: "4113510900" } }] });
  }
  const ym = u.searchParams.get("DEAL_YMD")!, lawd = u.searchParams.get("LAWD_CD")!;
  if (ym === mockState.failYm) return { status: 500, headers: {}, body: Buffer.alloc(0) };
  const items = lawd === "41135" ? [item("시험단지", "정자동", "1번지", 3, lawd), item("시험단지", "정자동", "1번지", 3, lawd)] : [item("경계밖단지", "신흥동", "2번지", 5, lawd)];
  return { status: 200, headers: {}, body: Buffer.from(`<response><header><resultCode>000</resultCode></header><body><items>${items.join("")}</items><numOfRows>1000</numOfRows><pageNo>1</pageNo><totalCount>${items.length}</totalCount></body></response>`) };
}

