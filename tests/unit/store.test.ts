// [5] 브라우저 저장 실패 처리(저장소 모의)
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { newManualRecord, emptyWorking } from "../../shared/model.ts";

class FakeStorage {
  m = new Map<string, string>();
  mode: "ok" | "quota" | "corrupt" = "ok";
  getItem(k: string) { return this.m.has(k) ? (this.mode === "corrupt" && !k.startsWith("__") ? "{}" : this.m.get(k)!) : null; }
  setItem(k: string, v: string) {
    if (this.mode === "quota" && !k.startsWith("__")) { const e = new Error("quota"); (e as any).name = "QuotaExceededError"; throw e; }
    this.m.set(k, v);
  }
  removeItem(k: string) { this.m.delete(k); }
}

const rec = (k: string) => newManualRecord(k, emptyWorking("주소", "2026-10-31"));
let ls: FakeStorage;
beforeEach(() => { ls = new FakeStorage(); (globalThis as any).window = { localStorage: ls, sessionStorage: new FakeStorage() }; });
const load = async () => (await import("../../web/store.ts")).localStore;

test("[5] 저장소가 차단되면 저장 실패를 반환(성공 처리 금지)", async () => {
  (globalThis as any).window = {};
  const s = await load();
  assert.equal(s.available(), false);
  assert.match(s.put(rec("lc_a"))!, /사용할 수 없음/);
});

test("[5] 저장 공간 부족이면 실패와 대안(JSON 내보내기)을 반환", async () => {
  const s = await load();
  ls.mode = "quota";
  assert.match(s.put(rec("lc_b"))!, /저장 공간 부족.*JSON/);
});

test("[5] 쓴 내용이 다시 읽히지 않으면 실패로 처리", async () => {
  const s = await load();
  ls.mode = "corrupt";
  assert.match(s.put(rec("lc_c"))!, /확인 실패/);
});

test("[5] 정상 저장·불러오기, 같은 식별자의 다른 내용은 덮어쓰지 않음", async () => {
  const s = await load();
  const r = rec("lc_d");
  assert.equal(s.put(r), null);
  assert.equal(s.get("lc_d")!.working.property.address, "주소");
  assert.equal(s.putIfAbsent(r).result, "same");
  const changed = { ...r, working: { ...r.working, property: { ...r.working.property, address: "다른 주소" } } };
  assert.equal(s.putIfAbsent(changed).result, "conflict");
  assert.equal(s.get("lc_d")!.working.property.address, "주소");
});
