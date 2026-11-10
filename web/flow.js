export class FlowError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "FlowError";
    this.status = status;
  }
}

const CASE_FIELDS = [
  "id", "파일명", "위원회", "의원", "제출기한", "문항번호", "요구내용", "세부항목", "비고",
  "상태", "주관과", "협조과", "확정방법", "후보", "과별회신", "재배정", "보완", "확정코멘트",
  "일시", "이력",
];
const CONFIRM_METHODS = new Set(["규칙", "AI", "수정"]);
const FORBIDDEN_PERSONAL_FIELD = /(이름|성명|연락처|전화|휴대전화|이메일|주소|주민등록|계좌)/i;

function copy(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function cleanSafeValue(value) {
  if (Array.isArray(value)) return value.map(cleanSafeValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !FORBIDDEN_PERSONAL_FIELD.test(key))
      .map(([key, item]) => [key, cleanSafeValue(item)]),
  );
}

function sanitizeCandidate(candidate) {
  if (typeof candidate === "string") return cleanText(candidate);
  if (!candidate || typeof candidate !== "object") return null;
  const result = {};
  if (candidate.과 !== undefined) result.과 = cleanText(candidate.과);
  if (candidate.점수 !== undefined && Number.isFinite(Number(candidate.점수))) result.점수 = Number(candidate.점수);
  if (Array.isArray(candidate.근거키워드)) result.근거키워드 = candidate.근거키워드.map(cleanText).filter(Boolean);
  if (candidate.근거 !== undefined) result.근거 = cleanText(candidate.근거);
  return result.과 ? result : null;
}

function sanitizeExistingCase(raw) {
  const item = {};
  for (const field of CASE_FIELDS) {
    if (raw?.[field] !== undefined) item[field] = copy(raw[field]);
  }
  item.id = cleanText(item.id || raw?.sourceKey || `${cleanText(item.의원)}-${cleanText(item.문항번호)}`);
  item.상태 = cleanText(item.상태 || raw?.status || "접수");
  item.협조과 = Array.isArray(item.협조과) ? [...new Set(item.협조과.map(cleanText).filter(Boolean))] : [];
  item.후보 = Array.isArray(item.후보) ? item.후보.map(sanitizeCandidate).filter(Boolean) : [];
  item.과별회신 = Array.isArray(item.과별회신) ? cleanSafeValue(item.과별회신) : [];
  item.보완 = Array.isArray(item.보완) ? cleanSafeValue(item.보완) : [];
  item.이력 = Array.isArray(item.이력) ? cleanSafeValue(item.이력) : [];
  return item;
}

function normalizeDb(db) {
  if (!Array.isArray(db)) throw new FlowError(500, "cases.json은 배열이어야 합니다.");
  return db.map(sanitizeExistingCase);
}

function organizationSet(organization) {
  if (!Array.isArray(organization)) throw new FlowError(500, "조직도 형식이 올바르지 않습니다.");
  return new Set(
    organization
      .map((item) => cleanText(typeof item === "string" ? item : item?.과))
      .filter(Boolean),
  );
}

function candidateDepartment(candidate) {
  return cleanText(typeof candidate === "string" ? candidate : candidate?.과);
}

function validateDepartments(departments, allowed) {
  for (const department of departments.map(cleanText).filter(Boolean)) {
    if (!allowed.has(department)) throw new FlowError(400, `조직도에 없는 과입니다: ${department}`);
  }
}

function requireCase(db, id) {
  const target = db.find((item) => item.id === cleanText(id));
  if (!target) throw new FlowError(400, `문항을 찾을 수 없습니다: ${cleanText(id) || "id 없음"}`);
  return target;
}

function requireState(target, allowedStates, work) {
  if (!allowedStates.includes(target.상태)) {
    throw new FlowError(409, `${target.상태} 상태에서는 ${work} 작업을 할 수 없습니다.`);
  }
}

function appendLog(target, work, department = "") {
  const time = new Date().toISOString();
  target.일시 = time;
  target.이력.push({ 일시: time, 작업: work, 문항: target.id, 과: cleanText(department) });
}

function sanitizeNewCase(raw) {
  const item = sanitizeExistingCase(raw);
  item.id = cleanText(raw?.id || raw?.sourceKey || `${cleanText(raw?.의원)}-${cleanText(raw?.문항번호)}`);
  if (!item.id || !cleanText(item.의원) || !cleanText(item.문항번호) || !cleanText(item.요구내용)) {
    throw new FlowError(400, "접수에는 id(또는 의원·문항번호), 의원, 문항번호, 요구내용이 필요합니다.");
  }
  item.상태 = "접수";
  item.주관과 = "";
  item.협조과 = [];
  item.확정방법 = "";
  item.과별회신 = [];
  item.재배정 = null;
  item.보완 = [];
  item.확정코멘트 = "";
  item.이력 = [];
  appendLog(item, "접수");
  return item;
}

function applyReception(db, request, allowed) {
  const rawItems = Array.isArray(request.문항들) ? request.문항들 : [request.문항 ?? request];
  if (!rawItems.length) throw new FlowError(400, "접수할 문항이 없습니다.");
  for (const raw of rawItems) {
    const item = sanitizeNewCase(raw);
    if (db.some((existing) => existing.id === item.id)) throw new FlowError(409, `이미 접수된 문항입니다: ${item.id}`);
    validateDepartments(item.후보.map(candidateDepartment), allowed);
    db.push(item);
  }
}

function applyAssignment(db, request, allowed) {
  const target = requireCase(db, request.id);
  requireState(target, ["접수", "재배정요청", "배분확정"], "배분");
  const primary = cleanText(request.주관과);
  const coops = [...new Set((Array.isArray(request.협조과) ? request.협조과 : []).map(cleanText).filter(Boolean))]
    .filter((department) => department !== primary);
  const method = cleanText(request.확정방법);
  const candidates = Array.isArray(request.후보) ? request.후보.map(sanitizeCandidate).filter(Boolean) : target.후보;
  if (!primary) throw new FlowError(400, "주관과가 필요합니다.");
  if (!CONFIRM_METHODS.has(method)) throw new FlowError(400, "확정방법은 규칙, AI, 수정 중 하나여야 합니다.");
  validateDepartments([primary, ...coops, ...candidates.map(candidateDepartment)], allowed);
  target.주관과 = primary;
  target.협조과 = coops;
  target.확정방법 = method;
  target.후보 = candidates;
  target.과별회신 = [];
  target.재배정 = null;
  target.상태 = "배분확정";
  appendLog(target, "배분", primary);
}

function assignedDepartments(target) {
  return [target.주관과, ...(target.협조과 || [])].map(cleanText).filter(Boolean);
}

function applyReply(db, request, allowed) {
  const target = requireCase(db, request.id);
  requireState(target, ["배분확정", "회신중", "보완요청"], "회신");
  const department = cleanText(request.과);
  validateDepartments([department], allowed);
  const assigned = assignedDepartments(target);
  if (!assigned.includes(department)) throw new FlowError(403, `${department}는 이 문항의 담당 과가 아닙니다.`);
  const reply = {
    과: department,
    파일명: cleanText(request.파일명),
    행: Array.isArray(request.행) ? cleanSafeValue(request.행) : [],
    메모: cleanText(request.메모),
    확인필요: Array.isArray(request.확인필요) ? cleanSafeValue(request.확인필요) : [],
    일시: new Date().toISOString(),
  };
  target.과별회신 = [...target.과별회신.filter((item) => item.과 !== department), reply];
  const replied = new Set(target.과별회신.map((item) => item.과));
  target.상태 = assigned.every((item) => replied.has(item)) ? "회신완료" : "회신중";
  appendLog(target, "회신", department);
}

function applyReassignmentRequest(db, request, allowed) {
  const target = requireCase(db, request.id);
  requireState(target, ["배분확정", "회신중", "보완요청"], "재배정요청");
  const department = cleanText(request.과);
  const reason = cleanText(request.사유);
  const desired = cleanText(request.희망과);
  validateDepartments([department, desired], allowed);
  if (!assignedDepartments(target).includes(department)) {
    throw new FlowError(403, `${department}는 이 문항의 담당 과가 아닙니다.`);
  }
  if (!reason) throw new FlowError(400, "재배정요청에는 사유가 필요합니다.");
  target.재배정 = { 요청과: department, 사유: reason, 희망과: desired, 일시: new Date().toISOString() };
  target.상태 = "재배정요청";
  appendLog(target, "재배정요청", department);
}

export function apply(db, request, organization) {
  if (!request || typeof request !== "object" || Array.isArray(request)) throw new FlowError(400, "JSON 요청이 필요합니다.");
  const next = normalizeDb(copy(db));
  const allowed = organizationSet(organization);
  const work = cleanText(request.작업);
  if (work === "접수") applyReception(next, request, allowed);
  else if (work === "배분") applyAssignment(next, request, allowed);
  else if (work === "회신") applyReply(next, request, allowed);
  else if (work === "재배정요청") applyReassignmentRequest(next, request, allowed);
  else if (["AI추천", "보완요청", "확정"].includes(work)) throw new FlowError(501, `${work} 작업은 후속 단계에서 추가합니다.`);
  else throw new FlowError(400, `지원하지 않는 작업입니다: ${work || "작업 없음"}`);
  return next;
}

