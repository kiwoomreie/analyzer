// 계약 검증에 필요한 JSON Schema(2020-12) 부분집합 검증기.
// 지원: $ref(#/$defs/..), type, const, enum, pattern, minLength, maxLength, minimum, maximum,
// exclusiveMinimum, properties, required, additionalProperties:false, items, minItems, maxItems.
// oneOf 는 documentType 판별로 상위에서 분기한다(validateContractDocument 참고).

export interface SchemaIssue {
  path: string;
  code: string;
  message: string;
}

type Schema = Record<string, any>;

function typeOf(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  if (typeof v === "number") return Number.isInteger(v) ? "integer" : "number";
  return typeof v;
}

function matchesType(v: unknown, t: string): boolean {
  const actual = typeOf(v);
  if (t === "number") return actual === "number" || actual === "integer";
  return actual === t;
}

export function validateAgainst(root: Schema, schema: Schema, value: unknown, path = "$", issues: SchemaIssue[] = []): SchemaIssue[] {
  if (issues.length > 50) return issues;
  if (schema.$ref) {
    const ref: string = schema.$ref;
    if (!ref.startsWith("#/$defs/")) throw new Error("unsupported $ref " + ref);
    const target = root.$defs?.[ref.slice(8)];
    if (!target) throw new Error("missing $def " + ref);
    validateAgainst(root, target, value, path, issues);
    // $ref 옆의 description 등은 무시
    return issues;
  }
  if ("const" in schema && value !== schema.const) {
    issues.push({ path, code: "CONST", message: `허용값 ${JSON.stringify(schema.const)} 이어야 함` });
    return issues;
  }
  if (schema.enum && !schema.enum.includes(value as any)) {
    issues.push({ path, code: "ENUM", message: `허용값(${schema.enum.join(", ")}) 중 하나여야 함` });
    return issues;
  }
  if (schema.type) {
    const types: string[] = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => matchesType(value, t))) {
      issues.push({ path, code: "TYPE", message: `${types.join("|")} 형식이어야 함` });
      return issues;
    }
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) issues.push({ path, code: "NUMBER", message: "유한한 숫자여야 함" });
    if (schema.minimum !== undefined && value < schema.minimum) issues.push({ path, code: "MINIMUM", message: `${schema.minimum} 이상이어야 함` });
    if (schema.maximum !== undefined && value > schema.maximum) issues.push({ path, code: "MAXIMUM", message: `${schema.maximum} 이하여야 함` });
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) issues.push({ path, code: "EXCLUSIVE_MINIMUM", message: `${schema.exclusiveMinimum} 초과여야 함` });
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) issues.push({ path, code: "MIN_LENGTH", message: `${schema.minLength}자 이상이어야 함` });
    if (schema.maxLength !== undefined && value.length > schema.maxLength) issues.push({ path, code: "MAX_LENGTH", message: `${schema.maxLength}자 이하여야 함` });
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) issues.push({ path, code: "PATTERN", message: "형식이 맞지 않음" });
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) issues.push({ path, code: "MIN_ITEMS", message: `${schema.minItems}개 이상` });
    if (schema.maxItems !== undefined && value.length > schema.maxItems) issues.push({ path, code: "MAX_ITEMS", message: `${schema.maxItems}개 이하` });
    if (schema.items) value.forEach((item, i) => validateAgainst(root, schema.items, item, `${path}[${i}]`, issues));
  }
  if (typeOf(value) === "object") {
    const obj = value as Record<string, unknown>;
    const props: Record<string, Schema> = schema.properties ?? {};
    for (const req of schema.required ?? []) {
      if (!(req in obj) || obj[req] === undefined) issues.push({ path: `${path}.${req}`, code: "REQUIRED", message: "필수 항목 누락" });
    }
    for (const [k, v] of Object.entries(obj)) {
      if (props[k]) validateAgainst(root, props[k], v, `${path}.${k}`, issues);
      else if (schema.additionalProperties === false) issues.push({ path: `${path}.${k}`, code: "ADDITIONAL_PROPERTY", message: "계약에 없는 필드" });
    }
  }
  return issues;
}
