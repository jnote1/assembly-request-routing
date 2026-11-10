(function initializeEngine(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(true);
  } else {
    root.DepartmentEngine = factory(false);
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function createEngine(isNode) {
  "use strict";

  let rules = [];
  let allowedDepartments = new Set();

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;
    const source = text.replace(/^\uFEFF/, "");

    for (let index = 0; index < source.length; index += 1) {
      const character = source[index];
      if (inQuotes) {
        if (character === '"' && source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else if (character === '"') {
          inQuotes = false;
        } else {
          field += character;
        }
      } else if (character === '"') {
        inQuotes = true;
      } else if (character === ",") {
        row.push(field);
        field = "";
      } else if (character === "\n") {
        row.push(field.replace(/\r$/, ""));
        rows.push(row);
        row = [];
        field = "";
      } else {
        field += character;
      }
    }

    if (field || row.length) {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
    }
    if (inQuotes) throw new Error("닫히지 않은 CSV 따옴표가 있습니다.");

    const nonEmptyRows = rows.filter((current) => current.some((value) => value.trim()));
    if (!nonEmptyRows.length) return [];
    const headers = nonEmptyRows.shift().map((header) => header.trim());
    return nonEmptyRows.map((values) =>
      Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])),
    );
  }

  function normalize(value) {
    return String(value ?? "").toLocaleLowerCase("ko-KR").replace(/[\s·ㆍ]+/g, "");
  }

  function configure(ruleRows, organizationRows) {
    allowedDepartments = new Set(
      organizationRows.map((row) => row["과"].trim()).filter(Boolean),
    );
    rules = ruleRows
      .map((row) => ({
        과: row["과"].trim(),
        키워드: row["키워드"].trim(),
        정규화키워드: normalize(row["키워드"]),
        제외어: row["제외어"]
          .split("|")
          .map((word) => normalize(word))
          .filter(Boolean),
        우선순위: Number(row["우선순위"]),
      }))
      .filter(
        (rule) =>
          allowedDepartments.has(rule.과) &&
          rule.정규화키워드 &&
          Number.isFinite(rule.우선순위),
      );
    return api;
  }

  function loadFromText(rulesCsv, organizationsCsv) {
    return configure(parseCsv(rulesCsv), parseCsv(organizationsCsv));
  }

  async function load(options = {}) {
    const rulesUrl = options.rulesUrl ?? "../data/배분기준표_소관키워드_304건.csv";
    const organizationsUrl = options.organizationsUrl ?? "../data/A부_조직도_26개과.csv";
    const [rulesResponse, organizationsResponse] = await Promise.all([
      fetch(rulesUrl),
      fetch(organizationsUrl),
    ]);
    if (!rulesResponse.ok) throw new Error(`배분기준표를 읽지 못했습니다: ${rulesResponse.status}`);
    if (!organizationsResponse.ok) {
      throw new Error(`조직도를 읽지 못했습니다: ${organizationsResponse.status}`);
    }
    return loadFromText(await rulesResponse.text(), await organizationsResponse.text());
  }

  function classify(requestText) {
    if (!rules.length || !allowedDepartments.size) {
      throw new Error("CSV를 먼저 불러와야 합니다. 브라우저에서는 await DepartmentEngine.load()를 호출하세요.");
    }

    const text = normalize(requestText);
    const byDepartment = new Map();

    for (const rule of rules) {
      if (!text.includes(rule.정규화키워드)) continue;
      if (rule.제외어.some((word) => text.includes(word))) continue;

      const score = rule.우선순위 + Array.from(rule.키워드).length / 10;
      const current = byDepartment.get(rule.과) ?? {
        과: rule.과,
        점수: Number.NEGATIVE_INFINITY,
        근거키워드: [],
      };
      current.점수 = Math.max(current.점수, score);
      if (!current.근거키워드.includes(rule.키워드)) current.근거키워드.push(rule.키워드);
      byDepartment.set(rule.과, current);
    }

    return [...byDepartment.values()]
      .map((candidate) => ({ ...candidate, 점수: Number(candidate.점수.toFixed(1)) }))
      .sort((left, right) => right.점수 - left.점수 || left.과.localeCompare(right.과, "ko"))
      .slice(0, 3);
  }

  const api = { classify, load, loadFromText, parseCsv };

  if (isNode) {
    const fs = require("node:fs");
    const path = require("node:path");
    const dataDirectory = path.resolve(__dirname, "..", "data");
    loadFromText(
      fs.readFileSync(path.join(dataDirectory, "배분기준표_소관키워드_304건.csv"), "utf8"),
      fs.readFileSync(path.join(dataDirectory, "A부_조직도_26개과.csv"), "utf8"),
    );
  }

  return api;
});
