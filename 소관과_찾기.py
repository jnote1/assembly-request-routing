"""국회 요구 문항의 소관 과를 배분기준표로 판정한다.

배분 규칙은 코드에 직접 넣지 않고 data/배분기준표_소관키워드_304건.csv를
읽는다. 최고 우선순위가 동률이거나 맞는 규칙이 없으면 임의로 확정하지
않고 "확인필요"를 반환한다.
"""

from __future__ import annotations

import csv
from pathlib import Path


기본_폴더 = Path(__file__).resolve().parent
기본_기준표 = 기본_폴더 / "data" / "배분기준표_소관키워드_304건.csv"
기본_조직도 = 기본_폴더 / "data" / "A부_조직도_26개과.csv"


def _csv_읽기(경로: str | Path) -> list[dict[str, str]]:
    with Path(경로).open(encoding="utf-8-sig", newline="") as 파일:
        return list(csv.DictReader(파일))


def 소관과_판정(
    요구문항: str,
    기준표_경로: str | Path = 기본_기준표,
    조직도_경로: str | Path = 기본_조직도,
) -> dict[str, object]:
    """소관 과 판정과 근거를 반환한다.

    반환값의 ``결과``는 유일한 소관 과 또는 ``확인필요``이다.
    """
    문항 = 요구문항.strip().casefold()
    조직도 = _csv_읽기(조직도_경로)
    허용과 = {행["과"].strip() for 행 in 조직도 if 행.get("과", "").strip()}

    일치규칙: list[dict[str, object]] = []
    for 규칙 in _csv_읽기(기준표_경로):
        부서 = 규칙.get("과", "").strip()
        키워드 = 규칙.get("키워드", "").strip()
        제외어들 = [
            값.strip().casefold()
            for 값 in 규칙.get("제외어", "").split("|")
            if 값.strip()
        ]
        if 부서 not in 허용과 or not 키워드:
            continue
        if 키워드.casefold() not in 문항:
            continue
        if any(제외어 in 문항 for 제외어 in 제외어들):
            continue
        일치규칙.append(
            {
                "rule_id": 규칙.get("rule_id", ""),
                "과": 부서,
                "키워드": 키워드,
                "우선순위": int(규칙["우선순위"]),
            }
        )

    if not 일치규칙:
        return {"결과": "확인필요", "사유": "일치하는 기준표 키워드 없음", "후보과": [], "근거": []}

    과별_최고순위: dict[str, int] = {}
    for 규칙 in 일치규칙:
        부서 = str(규칙["과"])
        과별_최고순위[부서] = max(과별_최고순위.get(부서, 0), int(규칙["우선순위"]))

    최고순위 = max(과별_최고순위.values())
    후보과 = sorted(과 for 과, 순위 in 과별_최고순위.items() if 순위 == 최고순위)
    근거 = [규칙 for 규칙 in 일치규칙 if 규칙["과"] in 후보과 and 규칙["우선순위"] == 최고순위]

    if len(후보과) > 1:
        return {"결과": "확인필요", "사유": "최고 우선순위 동순위", "후보과": 후보과, "근거": 근거}
    return {"결과": 후보과[0], "사유": "기준표 최고 우선순위", "후보과": 후보과, "근거": 근거}


def 소관과_찾기(요구문항: str) -> str:
    """요구 문항 하나를 받아 소관 과 또는 '확인필요'를 반환한다."""
    return str(소관과_판정(요구문항)["결과"])


def _시험() -> tuple[int, int]:
    시험경로 = 기본_폴더 / "data" / "시험_요구문항_40건.csv"
    시험자료 = _csv_읽기(시험경로)
    정답수 = sum(
        소관과_찾기(행["요구내용"]) == 행["정답_배분과"]
        for 행 in 시험자료
    )
    return 정답수, len(시험자료)


if __name__ == "__main__":
    정답수, 전체 = _시험()
    print(f"1순위 정답: {정답수}/{전체}")
