// 모든 입력 경로(시동 POST, 협의체 반출 파일, 일반 JSON·CSV, 백업 복구, 앱 내 편집)에 공통 적용하는 안전 검사.
// 결과에는 위치(path)와 사유 코드만 담고, 원문 값은 절대 담지 않는다.
// 한계: 자유 텍스트·첨부문서 속에 변형된 형태로 숨긴 비밀값까지 모두 찾지는 못한다(docs 참고).

export interface SafetyIssue {
  path: string;
  code: "FORBIDDEN_FIELD" | "SECRET_LIKE_VALUE" | "URL_NOT_ALLOWED" | "TOO_DEEP" | "TOO_MANY_NODES" | "MARKUP_NOT_ALLOWED";
  message: string;
}

const norm = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, "");

/** 정확히 일치하면 금지하는 필드명(정규화 후). */
const FORBIDDEN_EXACT = new Set([
  "callback", "callbackurl", "returnurl", "redirecturl", "redirecturi", "resulturl", "webhook", "webhookurl", "notifyurl",
  "token", "accesstoken", "refreshtoken", "idtoken", "csrftoken", "apikey", "apisecret", "secret", "clientsecret",
  "password", "passwd", "pwd", "credential", "credentials", "cookie", "cookies", "session", "sessionid", "sessiontoken",
  "authorization", "auth", "bearer", "dburl", "databaseurl", "connectionstring", "connstring", "dsn", "jdbcurl",
  "userid", "accountid", "analysisid", "ownerid", "workspaceid", "tenantid", "storagepath", "filepath", "s3key", "bucket",
  "renderkey", "renderapikey", "deploykey", "deployhook", "serviceaccount", "privatekey", "signedurl", "presignedurl",
  "downloadurl", "adminurl", "admintoken", "internalurl", "baseurl", "url", "uri", "href", "endpoint", "host",
  "env", "environment", "dotenv", "cfmodel", "cashflow", "waterfall", "formula", "formulas", "script", "html",
]);

/** 포함되면 금지하는 필드명 조각(정규화 후). */
const FORBIDDEN_CONTAINS = [
  "password", "secret", "token", "apikey", "cookie", "credential", "callback", "webhook", "connectionstring", "privatekey", "sessionid",
];

const SECRET_VALUE_PATTERNS: RegExp[] = [
  /\b(postgres(ql)?|mysql|mariadb|mongodb(\+srv)?|redis|rediss|amqp|mssql|sqlserver):\/\//i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\brnd_[A-Za-z0-9]{16,}/, // Render API key 형태
  /\bBearer\s+[A-Za-z0-9._~+\/-]{10,}/i,
  /\b(ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/, // JWT
  /(X-Amz-Signature|X-Goog-Signature|[?&](sig|signature|token|access_token)=)/i,
];

const URL_PATTERN = /\b(https?|ftp|file|javascript|data):/i;
const MARKUP_PATTERN = /<\s*(script|iframe|object|embed|img|svg|link|meta|style|form)\b|on[a-z]+\s*=/i;

export interface SafetyOptions {
  /** 값에 URL이 들어가도 되는 필드 경로 끝 이름(예: 근거의 sourceUrl). 시동 자료에는 없음. */
  urlAllowedKeys?: string[];
  maxDepth?: number;
  maxNodes?: number;
}

export function isForbiddenKey(key: string): boolean {
  const n = norm(key);
  if (FORBIDDEN_EXACT.has(n)) return true;
  return FORBIDDEN_CONTAINS.some((frag) => n.includes(frag));
}

export function isSecretLike(value: string): boolean {
  return SECRET_VALUE_PATTERNS.some((re) => re.test(value));
}

export function scanSafety(value: unknown, opts: SafetyOptions = {}): SafetyIssue[] {
  const issues: SafetyIssue[] = [];
  const maxDepth = opts.maxDepth ?? 12;
  const maxNodes = opts.maxNodes ?? 50000;
  const urlKeys = new Set((opts.urlAllowedKeys ?? []).map(norm));
  let nodes = 0;
  const walk = (v: unknown, path: string, depth: number, key: string | null) => {
    if (issues.length > 50) return;
    if (++nodes > maxNodes) {
      if (!issues.some((i) => i.code === "TOO_MANY_NODES")) issues.push({ path, code: "TOO_MANY_NODES", message: "자료 항목이 너무 많음" });
      return;
    }
    if (depth > maxDepth) {
      issues.push({ path, code: "TOO_DEEP", message: "중첩 깊이 초과" });
      return;
    }
    if (typeof v === "string") {
      if (isSecretLike(v)) issues.push({ path, code: "SECRET_LIKE_VALUE", message: "비밀값·접속정보 형태의 값" });
      else if (URL_PATTERN.test(v) && !(key && urlKeys.has(norm(key)))) issues.push({ path, code: "URL_NOT_ALLOWED", message: "이 항목에는 주소(URL)를 넣을 수 없음" });
      else if (MARKUP_PATTERN.test(v)) issues.push({ path, code: "MARKUP_NOT_ALLOWED", message: "HTML·스크립트 형태의 값" });
      return;
    }
    if (Array.isArray(v)) {
      v.forEach((item, i) => walk(item, `${path}[${i}]`, depth + 1, key));
      return;
    }
    if (v && typeof v === "object") {
      for (const [k, child] of Object.entries(v as Record<string, unknown>)) {
        if (k === "__proto__" || k === "constructor" || k === "prototype") {
          issues.push({ path: `${path}.${k}`, code: "FORBIDDEN_FIELD", message: "허용되지 않는 필드명" });
          continue;
        }
        if (isForbiddenKey(k)) {
          issues.push({ path: `${path}.${k}`, code: "FORBIDDEN_FIELD", message: "금지 필드(인증·콜백·주소·저장위치·원본모델 등)" });
          continue;
        }
        walk(child, `${path}.${k}`, depth + 1, k);
      }
    }
  };
  walk(value, "$", 0, null);
  return issues;
}

/** 텍스트 원문(CSV 셀, 첨부 텍스트 등)에 대한 간이 검사. */
export function scanText(text: string): SafetyIssue[] {
  return isSecretLike(text) ? [{ path: "$text", code: "SECRET_LIKE_VALUE", message: "비밀값·접속정보 형태의 값이 포함됨" }] : [];
}
