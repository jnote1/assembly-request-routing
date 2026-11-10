const fs = require("node:fs");
const path = require("node:path");

const inputPath = path.join(__dirname, "data", "A부_조직도_26개과.csv");
const outputPath = path.join(__dirname, "org.json");

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }

  if (inQuotes) {
    throw new Error("닫히지 않은 CSV 따옴표가 있습니다.");
  }
  return rows.filter((currentRow) => currentRow.some((value) => value.trim()));
}

const csvText = fs.readFileSync(inputPath, "utf8").replace(/^\uFEFF/, "");
const rows = parseCsv(csvText);
const headers = rows.shift();
const indexes = Object.fromEntries(headers.map((header, index) => [header.trim(), index]));

for (const required of ["실국", "과", "대표키워드"]) {
  if (!(required in indexes)) {
    throw new Error(`필수 열이 없습니다: ${required}`);
  }
}

const organizations = rows.map((row) => ({
  실국: row[indexes["실국"]].trim(),
  과: row[indexes["과"]].trim(),
  대표키워드: row[indexes["대표키워드"]]
    .split("|")
    .map((keyword) => keyword.trim())
    .filter(Boolean),
}));

fs.writeFileSync(outputPath, `${JSON.stringify(organizations, null, 2)}\n`, "utf8");

console.log(`원소 수: ${organizations.length}`);
console.log("첫 원소:");
console.log(JSON.stringify(organizations[0], null, 2));
