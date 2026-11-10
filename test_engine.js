const fs = require("node:fs");
const path = require("node:path");
const { classify, parseCsv } = require("./web/engine.js");

const testPath = path.join(__dirname, "data", "시험_요구문항_40건.csv");
const tests = parseCsv(fs.readFileSync(testPath, "utf8"));

let topOneCorrect = 0;
let topThreeCorrect = 0;
const wrongAnswers = [];

for (const test of tests) {
  const candidates = classify(test["요구내용"]);
  const departments = candidates.map((candidate) => candidate.과);
  const answer = test["정답_배분과"];
  const topOneMatch = departments[0] === answer;
  const topThreeMatch = departments.includes(answer);

  if (topOneMatch) topOneCorrect += 1;
  if (topThreeMatch) topThreeCorrect += 1;
  if (!topOneMatch) {
    wrongAnswers.push({
      시험번호: test["시험번호"],
      요구내용: test["요구내용"],
      정답: answer,
      "엔진 결과": candidates.length
        ? candidates
            .map(
              (candidate) =>
                `${candidate.과}(${candidate.점수}; ${candidate.근거키워드.join("|")})`,
            )
            .join(" > ")
        : "후보 없음",
    });
  }
}

console.log(`1순위 정답 ${topOneCorrect}/${tests.length} · 3순위 안 ${topThreeCorrect}/${tests.length}`);
console.table(wrongAnswers);
