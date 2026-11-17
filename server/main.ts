import { loadConfig } from "./config.ts";
import { createApp } from "./app.ts";

const cfg = loadConfig();
const app = createApp(cfg);
app.server.listen(cfg.port, cfg.host, () => {
  console.log(`입지 변화·가격영향 분석기: http://${cfg.host === "127.0.0.1" ? "localhost" : cfg.host}:${cfg.port}/app`);
  console.log(`시동 수신 경로: POST /launch (본문 상한 ${cfg.launchMaxBodyBytes}B, 수령 ${cfg.launchPendingTtlSec}s, 임시 분석 ${cfg.tempAnalysisTtlHours}h)`);
  console.log(`공공데이터 키: ${cfg.molit.serviceKey ? "설정됨(실제 호출 미검증)" : "미설정"} · 카카오맵 키: ${cfg.kakaoJsKey ? "설정됨" : "미설정"}`);
});
const stop = () => app.close().then(() => process.exit(0));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
