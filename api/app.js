import { readFileSync } from "node:fs";
import { get, put, BlobPreconditionFailedError } from "@vercel/blob";
import { apply, FlowError } from "../web/flow.js";

const BLOB_PATH = "cases.json";
const BLOB_ACCESS = process.env.BLOB_ACCESS === "public" ? "public" : "private";
const organization = JSON.parse(readFileSync(new URL("./org.json", import.meta.url), "utf8"));

export const blobRepository = {
  async read() {
    const result = await get(BLOB_PATH, { access: BLOB_ACCESS });
    if (!result) return { db: [], etag: null };
    const text = await new Response(result.stream).text();
    const db = text.trim() ? JSON.parse(text) : [];
    return { db, etag: result.blob.etag };
  },

  async write(db, { etag } = {}) {
    const options = {
      access: BLOB_ACCESS,
      allowOverwrite: true,
      contentType: "application/json; charset=utf-8",
      cacheControlMaxAge: 60,
    };
    if (etag) options.ifMatch = etag;
    return put(BLOB_PATH, JSON.stringify(db, null, 2), options);
  },
};

function sendJson(response, status, body) {
  response.status(status).setHeader("Cache-Control", "no-store").json(body);
}

function parseBody(body) {
  if (typeof body === "string") return JSON.parse(body);
  return body;
}

function changedCases(before, after, request) {
  if (request.작업 === "접수") {
    const oldIds = new Set(before.map((item) => item.id));
    return after.filter((item) => !oldIds.has(item.id));
  }
  return after.filter((item) => item.id === String(request.id ?? "").trim());
}

export function createApp({ repository = blobRepository, org = organization } = {}) {
  return async function handler(request, response) {
    try {
      if (request.method === "GET") {
        const { db } = await repository.read();
        return sendJson(response, 200, db);
      }
      if (request.method !== "POST") {
        response.setHeader("Allow", "GET, POST");
        return sendJson(response, 405, { error: "GET과 POST만 지원합니다." });
      }
      const body = parseBody(request.body);
      const { db, etag } = await repository.read();
      const next = apply(db, body, org);
      await repository.write(next, { etag });
      const changed = changedCases(db, next, body);
      return sendJson(response, 200, {
        ok: true,
        상태: changed.length === 1 ? changed[0].상태 : "접수",
        건수: changed.length,
        id: changed.length === 1 ? changed[0].id : undefined,
      });
    } catch (error) {
      if (error instanceof FlowError) return sendJson(response, error.status, { error: error.message });
      if (error instanceof BlobPreconditionFailedError) {
        return sendJson(response, 409, { error: "다른 사용자가 먼저 저장했습니다. 다시 조회한 뒤 시도해 주세요." });
      }
      if (error instanceof SyntaxError) return sendJson(response, 400, { error: "JSON 형식을 확인해 주세요." });
      console.error(error);
      return sendJson(response, 500, { error: "서버 저장 중 오류가 발생했습니다." });
    }
  };
}

export default createApp();

