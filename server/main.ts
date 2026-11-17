import { loadConfig } from "./config.ts";
import { createApp } from "./app.ts";

const cfg = loadConfig();
const app = createApp(cfg);
app.server.listen(cfg.port, cfg.host, () => {
  console.log(`아파트 입지·가격 분석기: http://${cfg.host === "127.0.0.1" ? "localhost" : cfg.host}:${cfg.port}/app`);
  console.log(`협의체 시동 수신(/launch): ${cfg.launchReceiverEnabled ? "활성(시험용)" : "대기(비활성)"}`);
  console.log(`실거래 공공데이터 키: ${cfg.molit.serviceKey ? "설정됨(실제 호출 미검증)" : "미설정"} · 카카오 로컬 키: ${cfg.kakaoRestKey ? "설정됨(실제 호출 미검증)" : "미설정"}`);
});
const stop = () => app.close().then(() => process.exit(0));
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
