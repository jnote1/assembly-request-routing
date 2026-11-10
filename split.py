"""원문 자료요구서 PDF를 문항 단위 CSV로 분리한다."""

from __future__ import annotations

import csv
import re
from datetime import datetime
from pathlib import Path

from pypdf import PdfReader


기준_폴더 = Path(__file__).resolve().parent
원문_폴더 = 기준_폴더 / "원문"
출력_경로 = 기준_폴더 / "data" / "문항목록.csv"
출력_열 = ["파일명", "위원회", "의원", "제출기한", "문항번호", "요구내용", "세부항목", "비고"]

머리글_형식 = re.compile(r"^(.+위원회)\s+(.+?)\s+의원실\s+자료요구서$")
기한_형식 = re.compile(r"제출기한:\s*(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.")
문항_형식 = re.compile(r"^(\d+)\.\s*(.*)$")
세부_형식 = re.compile(r"^([가나])\.\s*(.*)$")
파일_문항수_형식 = re.compile(r"_(\d+)문항\.pdf$", re.IGNORECASE)


def 정리(문자열: str) -> str:
    """앞뒤 공백을 없애고 줄 내부의 연속 공백을 하나로 만든다."""
    return re.sub(r"\s+", " ", 문자열).strip()


def 이어붙이기(기존: str, 추가: str) -> str:
    추가 = 정리(추가)
    if not 추가:
        return 기존
    return f"{기존} {추가}".strip()


def PDF_분리(PDF_경로: Path) -> tuple[list[dict[str, str]], list[str]]:
    읽기 = PdfReader(PDF_경로)
    페이지_텍스트 = [페이지.extract_text() or "" for 페이지 in 읽기.pages]
    줄들 = [줄 for 페이지 in 페이지_텍스트 for 줄 in 페이지.splitlines()]

    첫줄 = next((정리(줄) for 줄 in 줄들 if 정리(줄)), "")
    머리글 = 머리글_형식.fullmatch(첫줄)
    if not 머리글:
        raise ValueError(f"머리글 형식을 확인할 수 없습니다: {PDF_경로.name}")
    위원회, 의원 = 머리글.groups()

    기한_일치 = next((기한_형식.search(줄) for 줄 in 줄들 if 기한_형식.search(줄)), None)
    if not 기한_일치:
        raise ValueError(f"제출기한을 확인할 수 없습니다: {PDF_경로.name}")
    연도, 월, 일 = map(int, 기한_일치.groups())
    제출기한 = datetime(연도, 월, 일).date().isoformat()

    결과: list[dict[str, str]] = []
    현재: dict[str, str] | None = None
    직전_항목 = "요구내용"

    for 원래_줄 in 줄들:
        줄 = 정리(원래_줄)
        if not 줄 or 줄 == 첫줄:
            continue
        if 줄.startswith("수신:") or 줄.startswith("담당 보좌관:") or 줄 == "끝.":
            continue

        문항 = 문항_형식.fullmatch(줄)
        if 문항:
            현재 = {
                "파일명": PDF_경로.name,
                "위원회": 위원회,
                "의원": 의원,
                "제출기한": 제출기한,
                "문항번호": 문항.group(1),
                "요구내용": 정리(문항.group(2)),
                "세부항목": "",
                "비고": "",
            }
            결과.append(현재)
            직전_항목 = "요구내용"
            continue

        if 현재 is None:
            continue

        세부 = 세부_형식.fullmatch(줄)
        if 세부:
            항목 = f"{세부.group(1)}. {정리(세부.group(2))}"
            현재["세부항목"] = f'{현재["세부항목"]}\n{항목}'.strip()
            직전_항목 = "세부항목"
            continue

        if 줄.startswith("※"):
            현재["비고"] = f'{현재["비고"]}\n{줄}'.strip()
            직전_항목 = "비고"
            continue

        현재[직전_항목] = 이어붙이기(현재[직전_항목], 줄)

    return 결과, 페이지_텍스트


def 번호_연속(행들: list[dict[str, str]]) -> bool:
    번호들 = [int(행["문항번호"]) for 행 in 행들]
    return 번호들 == list(range(1, len(번호들) + 1))


def main() -> None:
    PDF들 = sorted(원문_폴더.glob("*.pdf"))
    if len(PDF들) != 3:
        raise ValueError(f"원문 PDF는 3건이어야 합니다. 현재 {len(PDF들)}건입니다.")

    전체_행: list[dict[str, str]] = []
    검증: list[tuple[str, int, int, str, str, str]] = []
    원문_페이지: dict[str, list[str]] = {}

    for PDF in PDF들:
        행들, 페이지들 = PDF_분리(PDF)
        전체_행.extend(행들)
        원문_페이지[PDF.name] = 페이지들
        파일수_일치 = 파일_문항수_형식.search(PDF.name)
        if not 파일수_일치:
            raise ValueError(f"파일명에서 문항 수를 확인할 수 없습니다: {PDF.name}")
        파일수 = int(파일수_일치.group(1))
        추출수 = len(행들)
        마지막 = 행들[-1]["문항번호"] if 행들 else ""
        연속 = 번호_연속(행들)
        일치 = 파일수 == 추출수 and 마지막 == str(파일수) and 연속
        검증.append((PDF.name, 파일수, 추출수, 마지막, "O" if 연속 else "X", "O" if 일치 else "X"))

    if any(행[-1] == "X" for 행 in 검증):
        raise ValueError(f"문항 수 검증 실패: {검증}")

    with 출력_경로.open("w", encoding="utf-8-sig", newline="") as 파일:
        쓰기 = csv.DictWriter(파일, fieldnames=출력_열)
        쓰기.writeheader()
        쓰기.writerows(전체_행)

    print("파일명 | 파일명의 문항 수 | 뽑은 문항 수 | 마지막 번호 | 번호 연속 | 일치(O/X)")
    for 행 in 검증:
        print(" | ".join(map(str, 행)))

    예시 = [행 for 행 in 전체_행 if 행["세부항목"] and 행["비고"]][:3]
    print("\n세부항목·비고 원문 대조 예시")
    for 행 in 예시:
        번호 = 행["문항번호"]
        원문줄 = []
        찾음 = False
        for 페이지 in 원문_페이지[행["파일명"]]:
            for 줄 in 페이지.splitlines():
                정리줄 = 정리(줄)
                if 문항_형식.fullmatch(정리줄):
                    if 찾음:
                        break
                    찾음 = 문항_형식.fullmatch(정리줄).group(1) == 번호
                if 찾음:
                    원문줄.append(정리줄)
            if 찾음 and 원문줄:
                다음문항 = int(번호) + 1
                if any(re.match(rf"^{다음문항}\.\s", 정리(줄)) for 줄 in 페이지.splitlines()):
                    break
        print(f'[{행["파일명"]} / {번호}번]')
        print("원문:", " / ".join(원문줄))
        print("CSV :", f'요구내용={행["요구내용"]} / 세부항목={행["세부항목"]} / 비고={행["비고"]}')


if __name__ == "__main__":
    main()
