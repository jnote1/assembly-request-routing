(function initializeRequestSplitter(root) {
  "use strict";
  const headingPattern = /^(.+위원회)\s+(.+?)\s+의원실\s+자료요구서$/;
  const deadlinePattern = /제출기한:\s*(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\./;
  const questionPattern = /^(\d+)\.\s*(.*)$/;
  const detailPattern = /^([가나])\.\s*(.*)$/;
  const expectedPattern = /_(\d+)문항\.pdf$/i;
  const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

  function append(previous, next) { const value = clean(next); return value ? `${previous} ${value}`.trim() : previous; }

  function splitText(text, filename) {
    const lines = text.split(/\r?\n/);
    const firstLine = lines.map(clean).find(Boolean) || "";
    const heading = firstLine.match(headingPattern);
    if (!heading) throw new Error(`${filename}: 첫 줄에서 위원회·의원을 찾지 못했습니다.`);
    const deadlineMatch = lines.map((line) => line.match(deadlinePattern)).find(Boolean);
    if (!deadlineMatch) throw new Error(`${filename}: 제출기한을 찾지 못했습니다.`);
    const [, year, month, day] = deadlineMatch;
    const deadline = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
    const items = [];
    let current = null, lastField = "요구내용";

    for (const rawLine of lines) {
      const line = clean(rawLine);
      if (!line || line === firstLine || line.startsWith("수신:") || line.startsWith("담당 보좌관:") || line === "끝.") continue;
      const question = line.match(questionPattern);
      if (question) {
        current = { 파일명: filename, 위원회: heading[1], 의원: heading[2], 제출기한: deadline,
          문항번호: question[1], 요구내용: clean(question[2]), 세부항목: "", 비고: "" };
        items.push(current); lastField = "요구내용"; continue;
      }
      if (!current) continue;
      const detail = line.match(detailPattern);
      if (detail) { current.세부항목 = `${current.세부항목}\n${detail[1]}. ${clean(detail[2])}`.trim(); lastField = "세부항목"; continue; }
      if (line.startsWith("※")) { current.비고 = `${current.비고}\n${line}`.trim(); lastField = "비고"; continue; }
      current[lastField] = append(current[lastField], line);
    }
    const expected = Number(filename.match(expectedPattern)?.[1] || 0);
    const numbers = items.map((item) => Number(item.문항번호));
    const continuous = numbers.every((number, index) => number === index + 1);
    return { items, validation: { filename, expected, extracted: items.length, last: numbers.at(-1) || 0,
      continuous, matched: expected > 0 && expected === items.length && numbers.at(-1) === expected && continuous } };
  }

  async function extractPageText(page) {
    const content = await page.getTextContent();
    let text = "", lastY = null;
    for (const item of content.items) {
      if (!("str" in item)) continue;
      const y = item.transform?.[5];
      if (lastY !== null && y !== undefined && Math.abs(y - lastY) > 2 && !text.endsWith("\n")) text += "\n";
      else if (text && !/[\s\n]$/.test(text) && item.str && !/^\s/.test(item.str)) text += " ";
      text += item.str;
      if (item.hasEOL) text += "\n";
      if (y !== undefined) lastY = y;
    }
    return text;
  }

  async function readPdf(file, pdfjsLib) {
    const document = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      pages.push(await extractPageText(await document.getPage(pageNumber)));
    }
    return splitText(pages.join("\n"), file.name);
  }

  function fromCsvRows(rows) {
    const required = ["파일명", "위원회", "의원", "제출기한", "문항번호", "요구내용", "세부항목", "비고"];
    if (!rows.length || required.some((key) => !(key in rows[0]))) throw new Error("문항목록.csv의 열 구성을 확인해 주세요.");
    return rows.map((row) => Object.fromEntries(required.map((key) => [key, row[key] ?? ""])));
  }

  root.RequestSplitter = { splitText, readPdf, fromCsvRows };
})(globalThis);
