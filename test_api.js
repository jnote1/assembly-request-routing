import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createApp } from "./api/app.js";

const org = JSON.parse(readFileSync(new URL("./api/org.json", import.meta.url), "utf8"));

class FakeRepository {
  constructor() { this.db = []; this.version = 0; }
  async read() { return { db: structuredClone(this.db), etag: String(this.version) }; }
  async write(db) { this.db = structuredClone(db); this.version += 1; }
}

function mockResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name] = value; return this; },
    json(body) { this.body = body; return this; },
  };
}

async function invoke(handler, method, body) {
  const response = mockResponse();
  await handler({ method, body }, response);
  return response;
}

const repository = new FakeRepository();
const handler = createApp({ repository, org });
const results = [];
async function test(name, run) {
  try { await run(); results.push({ 시험: name, 결과: "통과" }); }
  catch (error) { results.push({ 시험: name, 결과: `실패: ${error.message}` }); }
}

await test("GET 빈 cases.json", async () => {
  const response = await invoke(handler, "GET");
  assert.equal(response.statusCode, 200); assert.deepEqual(response.body, []);
});

await test("접수와 개인정보 필드 제거", async () => {
  const response = await invoke(handler, "POST", { 작업: "접수", 문항: {
    id: "의원C-01", 파일명: "가상.pdf", 위원회: "행정안전위원회", 의원: "의원C", 문항번호: "1",
    요구내용: "디지털전환 사업 추진 실적", 이름: "버려야 함", 연락처: "010-0000-0000",
  } });
  assert.equal(response.statusCode, 200); assert.equal(repository.db[0].상태, "접수");
  assert.equal("이름" in repository.db[0], false); assert.equal("연락처" in repository.db[0], false);
});

await test("중복 접수는 409", async () => {
  const response = await invoke(handler, "POST", { 작업: "접수", 문항: { id: "의원C-01", 의원: "의원C", 문항번호: "1", 요구내용: "중복" } });
  assert.equal(response.statusCode, 409);
});

await test("순서 위반 회신은 409", async () => {
  const response = await invoke(handler, "POST", { 작업: "회신", id: "의원C-01", 과: "디지털정책과" });
  assert.equal(response.statusCode, 409);
});

await test("조직도 밖 과는 400", async () => {
  const response = await invoke(handler, "POST", { 작업: "배분", id: "의원C-01", 주관과: "없는과", 협조과: [], 확정방법: "규칙" });
  assert.equal(response.statusCode, 400);
});

await test("잘못된 확정방법은 400", async () => {
  const response = await invoke(handler, "POST", { 작업: "배분", id: "의원C-01", 주관과: "디지털정책과", 협조과: [], 확정방법: "자동" });
  assert.equal(response.statusCode, 400);
});

await test("정상 배분", async () => {
  const response = await invoke(handler, "POST", { 작업: "배분", id: "의원C-01", 주관과: "디지털정책과", 협조과: ["운영지원과"], 확정방법: "규칙" });
  assert.equal(response.statusCode, 200); assert.equal(repository.db[0].상태, "배분확정");
});

await test("담당 아닌 과 회신은 403", async () => {
  const response = await invoke(handler, "POST", { 작업: "회신", id: "의원C-01", 과: "안전정책과", 행: [] });
  assert.equal(response.statusCode, 403);
});

await test("주관 과만 회신하면 회신중", async () => {
  const response = await invoke(handler, "POST", { 작업: "회신", id: "의원C-01", 과: "디지털정책과", 파일명: "회신.xlsx", 행: [{ 연도: 2026, 성명: "버려야 함" }] });
  assert.equal(response.statusCode, 200); assert.equal(repository.db[0].상태, "회신중");
  assert.equal("성명" in repository.db[0].과별회신[0].행[0], false);
});

await test("모든 담당 과 회신이면 회신완료", async () => {
  const response = await invoke(handler, "POST", { 작업: "회신", id: "의원C-01", 과: "운영지원과", 파일명: "협조회신.xlsx", 행: [] });
  assert.equal(response.statusCode, 200); assert.equal(repository.db[0].상태, "회신완료");
});

await test("재배정요청 사유 필수", async () => {
  await invoke(handler, "POST", { 작업: "접수", 문항: { id: "의원R-02", 의원: "의원R", 문항번호: "2", 요구내용: "재난 대응 현황" } });
  await invoke(handler, "POST", { 작업: "배분", id: "의원R-02", 주관과: "재난대응과", 협조과: [], 확정방법: "수정" });
  const response = await invoke(handler, "POST", { 작업: "재배정요청", id: "의원R-02", 과: "재난대응과", 사유: "" });
  assert.equal(response.statusCode, 400);
});

await test("정상 재배정요청", async () => {
  const response = await invoke(handler, "POST", { 작업: "재배정요청", id: "의원R-02", 과: "재난대응과", 사유: "소관 재검토 필요", 희망과: "안전정책과" });
  assert.equal(response.statusCode, 200); assert.equal(repository.db[1].상태, "재배정요청");
});

await test("AI 확정방법 허용", async () => {
  await invoke(handler, "POST", { 작업: "접수", 문항: { id: "의원K-03", 의원: "의원K", 문항번호: "3", 요구내용: "공공데이터 개방 현황" } });
  const response = await invoke(handler, "POST", { 작업: "배분", id: "의원K-03", 주관과: "데이터정책과", 협조과: [], 확정방법: "AI" });
  assert.equal(response.statusCode, 200); assert.equal(repository.db[2].확정방법, "AI");
});

await test("GET cases.json 전체", async () => {
  const response = await invoke(handler, "GET");
  assert.equal(response.statusCode, 200); assert.equal(response.body.length, 3);
});

console.table(results);
const failures = results.filter((item) => item.결과 !== "통과");
console.log(`결과: ${results.length - failures.length}/${results.length} 통과`);
if (failures.length) process.exitCode = 1;

