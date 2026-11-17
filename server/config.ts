// 새 앱 전용 설정. 기존 협의체·Render의 환경변수·비밀값을 읽거나 공유하지 않는다.
export interface AppConfig {
  host: string;
  port: number;
  dbPath: string;
  webRoot: string;
  /** 세션 쿠키 Secure 속성. 운영(HTTPS)에서는 반드시 true. localhost 개발 시 Chromium은 Secure 쿠키를 허용함. */
  cookieSecure: boolean;
  launchMaxBodyBytes: number;
  apiMaxBodyBytes: number;
  launchPendingTtlSec: number;
  tempAnalysisTtlHours: number;
  workspaceTtlDays: number;
  rateLimitLaunchPerMin: number;
  rateLimitApiPerMin: number;
  cleanupIntervalSec: number;
  kakaoJsKey: string | null;
  molit: { serviceKey: string | null; endpoint: string; autoFetch: boolean; maxMonths: number };
  trustProxy: boolean;
}

const int = (v: string | undefined, d: number) => (v && /^\d+$/.test(v) ? Number(v) : d);

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const prod = env.NODE_ENV === "production";
  return {
    host: env.HOST ?? "127.0.0.1",
    port: int(env.PORT, 5174),
    dbPath: env.DB_PATH ?? "./data/location-analyzer.db",
    webRoot: env.WEB_ROOT ?? "./dist/web",
    cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE !== "false" : true,
    launchMaxBodyBytes: int(env.LAUNCH_MAX_BODY_BYTES, 64 * 1024),
    apiMaxBodyBytes: int(env.API_MAX_BODY_BYTES, 4 * 1024 * 1024),
    launchPendingTtlSec: int(env.LAUNCH_PENDING_TTL_SEC, 600),
    tempAnalysisTtlHours: int(env.TEMP_ANALYSIS_TTL_HOURS, 24),
    workspaceTtlDays: int(env.WORKSPACE_TTL_DAYS, 30),
    rateLimitLaunchPerMin: int(env.RATE_LIMIT_LAUNCH_PER_MIN, 30),
    rateLimitApiPerMin: int(env.RATE_LIMIT_API_PER_MIN, 600),
    cleanupIntervalSec: int(env.CLEANUP_INTERVAL_SEC, 60),
    kakaoJsKey: env.KAKAO_JS_KEY || null,
    molit: {
      serviceKey: env.MOLIT_SERVICE_KEY || null,
      // 공식 문서(data.go.kr 15126469)로 최종 확인 필요. 호스트는 publicData.ts 허용목록으로 고정.
      endpoint: env.MOLIT_APT_TRADE_ENDPOINT ?? "https://apis.data.go.kr/1613000/RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade",
      autoFetch: env.PUBLIC_DATA_AUTO_FETCH === "true",
      maxMonths: int(env.PUBLIC_DATA_MAX_MONTHS, 6),
    },
    trustProxy: env.TRUST_PROXY === "true" || prod,
  };
}
