"""국회 요구자료 내부 게시판. Python 표준 라이브러리만 사용."""
import csv
import io
import json
import os
import re
import sqlite3
import uuid
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
STORE = ROOT / "board_data"
UPLOADS = STORE / "uploads"
DB = STORE / "board.sqlite3"
MAX_BODY = 25 * 1024 * 1024


def connect():
    STORE.mkdir(exist_ok=True)
    UPLOADS.mkdir(exist_ok=True)
    db = sqlite3.connect(DB)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys=ON")
    db.executescript("""
    CREATE TABLE IF NOT EXISTS requests(id INTEGER PRIMARY KEY, title TEXT NOT NULL,
      committee TEXT, member TEXT, due_date TEXT, notes TEXT, original_name TEXT,
      stored_name TEXT, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS questions(id INTEGER PRIMARY KEY, request_id INTEGER NOT NULL
      REFERENCES requests(id), number TEXT NOT NULL, body TEXT NOT NULL, department TEXT,
      created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS replies(id INTEGER PRIMARY KEY, question_id INTEGER NOT NULL
      REFERENCES questions(id), department TEXT NOT NULL, comment TEXT, original_name TEXT,
      stored_name TEXT, created_at TEXT NOT NULL);
    """)
    return db


def clean_name(name):
    name = Path(str(name).replace("\\", "/")).name
    return re.sub(r"[\x00-\x1f]", "", name)[:180]


def reply_rows(path):
    """회신 양식의 2행 머리글 아래 데이터를 읽는다."""
    if path.suffix == ".csv":
        with path.open(encoding="utf-8-sig", newline="") as f:
            rows = list(csv.reader(f))
        head = next((i for i, row in enumerate(rows) if row and row[0].strip() == "연도"), 0)
        return rows[head + 1:]
    if path.suffix == ".xls":
        raise ValueError("기존 XLS 형식은 CSV 또는 XLSX로 저장 후 업로드하세요.")
    ns = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    with zipfile.ZipFile(path) as z:
        strings = []
        if "xl/sharedStrings.xml" in z.namelist():
            root = ET.fromstring(z.read("xl/sharedStrings.xml"))
            strings = ["".join(t.text or "" for t in si.findall(".//m:t", ns)) for si in root.findall("m:si", ns)]
        root = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
        rows = []
        for row in root.findall(".//m:sheetData/m:row", ns):
            cells = [""] * 8
            for cell in row.findall("m:c", ns):
                ref = cell.get("r", "")
                col = re.match(r"[A-Z]+", ref)
                if not col: continue
                index = 0
                for ch in col[0]: index = index * 26 + ord(ch) - 64
                if index > 8: continue
                value = cell.find("m:v", ns)
                inline = cell.find("m:is", ns)
                text = value.text if value is not None else "".join(x.text or "" for x in inline.findall(".//m:t", ns)) if inline is not None else ""
                cells[index - 1] = strings[int(text)] if cell.get("t") == "s" and text else text
            rows.append(cells)
        head = next((i for i, row in enumerate(rows) if row[0].strip() == "연도"), 1)
        return rows[head + 1:]


class Handler(BaseHTTPRequestHandler):
    def send(self, status, data, content_type="application/json; charset=utf-8", extra=None):
        body = data if isinstance(data, bytes) else json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items(): self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def payload(self):
        length = int(self.headers.get("Content-Length", "0"))
        if length <= 0 or length > MAX_BODY: raise ValueError("본문 크기는 25MB 이하여야 합니다.")
        return json.loads(self.rfile.read(length))

    def upload(self, obj, allowed):
        file = obj.get("file") or {}
        name = clean_name(file.get("name", ""))
        if not name: return "", ""
        if Path(name).suffix.lower() not in allowed: raise ValueError("지원하지 않는 파일 형식입니다.")
        import base64
        raw = base64.b64decode(file.get("data", ""), validate=True)
        if len(raw) > 18 * 1024 * 1024: raise ValueError("파일은 18MB 이하여야 합니다.")
        stored = uuid.uuid4().hex + Path(name).suffix.lower()
        (UPLOADS / stored).write_bytes(raw)
        return name, stored

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/":
            return self.send(200, (ROOT / "board.html").read_bytes(), "text/html; charset=utf-8")
        with connect() as db:
            if path == "/api/requests":
                rows = db.execute("""SELECT r.*, COUNT(DISTINCT q.id) question_count,
                  COUNT(DISTINCT CASE WHEN p.id IS NOT NULL THEN q.id END) answered_count
                  FROM requests r LEFT JOIN questions q ON q.request_id=r.id
                  LEFT JOIN replies p ON p.question_id=q.id GROUP BY r.id ORDER BY r.id DESC""").fetchall()
                return self.send(200, [dict(x) for x in rows])
            match = re.fullmatch(r"/api/requests/(\d+)", path)
            if match:
                request = db.execute("SELECT * FROM requests WHERE id=?", (match[1],)).fetchone()
                if not request: return self.send(404, {"error": "자료를 찾을 수 없습니다."})
                questions = [dict(x) for x in db.execute("SELECT * FROM questions WHERE request_id=? ORDER BY id", (match[1],))]
                for q in questions:
                    q["replies"] = [dict(x) for x in db.execute("SELECT * FROM replies WHERE question_id=? ORDER BY id", (q["id"],))]
                return self.send(200, {"request": dict(request), "questions": questions})
            match = re.fullmatch(r"/api/files/([a-f0-9]{32}\.(?:pdf|xlsx|xls|csv))", path)
            if match:
                name = match[1]
                row = db.execute("SELECT original_name FROM requests WHERE stored_name=? UNION SELECT original_name FROM replies WHERE stored_name=?", (name, name)).fetchone()
                if not row: return self.send(404, {"error": "파일을 찾을 수 없습니다."})
                from urllib.parse import quote
                return self.send(200, (UPLOADS / name).read_bytes(), "application/octet-stream",
                                 {"Content-Disposition": "attachment; filename*=UTF-8''" + quote(row[0])})
            match = re.fullmatch(r"/api/requests/(\d+)/summary.csv", path)
            if match:
                out = io.StringIO()
                writer = csv.writer(out)
                writer.writerow(["요구서ID", "문항번호", "요구내용", "배분과", "회신상태", "회신부서", "회신메모", "회신파일"])
                for q in db.execute("SELECT * FROM questions WHERE request_id=? ORDER BY id", (match[1],)):
                    replies = db.execute("SELECT * FROM replies WHERE question_id=? ORDER BY id", (q["id"],)).fetchall()
                    for p in replies or [None]:
                        writer.writerow([match[1], q["number"], q["body"], q["department"], "회신" if p else "미회신",
                                         p["department"] if p else "", p["comment"] if p else "", p["original_name"] if p else ""])
                return self.send(200, b"\xef\xbb\xbf" + out.getvalue().encode("utf-8"), "text/csv; charset=utf-8",
                                 {"Content-Disposition": f'attachment; filename="request-{match[1]}-summary.csv"'})
            match = re.fullmatch(r"/api/requests/(\d+)/combined.csv", path)
            if match:
                out = io.StringIO()
                writer = csv.writer(out)
                writer.writerow(["문항번호", "요구내용", "배분과", "회신부서", "연도", "항목명", "근거", "건수", "인원", "예산(천원)", "집행액(천원)", "비고", "원본파일"])
                for q in db.execute("SELECT * FROM questions WHERE request_id=? ORDER BY id", (match[1],)):
                    for p in db.execute("SELECT * FROM replies WHERE question_id=? ORDER BY id", (q["id"],)):
                        try: rows = reply_rows(UPLOADS / p["stored_name"])
                        except (ValueError, zipfile.BadZipFile, ET.ParseError): continue
                        for row in rows:
                            if not any(str(v).strip() for v in row): continue
                            writer.writerow([q["number"], q["body"], q["department"], p["department"], *(list(row[:8]) + [""] * 8)[:8], p["original_name"]])
                return self.send(200, b"\xef\xbb\xbf" + out.getvalue().encode("utf-8"), "text/csv; charset=utf-8",
                                 {"Content-Disposition": f'attachment; filename="request-{match[1]}-combined.csv"'})
        self.send(404, {"error": "경로를 찾을 수 없습니다."})

    def do_POST(self):
        try:
            obj = self.payload()
            path = urlparse(self.path).path
            now = datetime.now().isoformat(timespec="seconds")
            with connect() as db:
                if path == "/api/requests":
                    title = str(obj.get("title", "")).strip()
                    if not title: raise ValueError("제목을 입력하세요.")
                    original, stored = self.upload(obj, {".pdf"})
                    cur = db.execute("INSERT INTO requests(title,committee,member,due_date,notes,original_name,stored_name,created_at) VALUES(?,?,?,?,?,?,?,?)",
                                     (title, obj.get("committee", ""), obj.get("member", ""), obj.get("due_date", ""), obj.get("notes", ""), original, stored, now))
                    return self.send(201, {"id": cur.lastrowid})
                match = re.fullmatch(r"/api/requests/(\d+)/questions", path)
                if match:
                    if not db.execute("SELECT 1 FROM requests WHERE id=?", (match[1],)).fetchone(): return self.send(404, {"error": "요구서가 없습니다."})
                    number, body = str(obj.get("number", "")).strip(), str(obj.get("body", "")).strip()
                    if not number or not body: raise ValueError("문항번호와 요구내용을 입력하세요.")
                    cur = db.execute("INSERT INTO questions(request_id,number,body,department,created_at) VALUES(?,?,?,?,?)",
                                     (match[1], number, body, str(obj.get("department", "")).strip(), now))
                    return self.send(201, {"id": cur.lastrowid})
                match = re.fullmatch(r"/api/questions/(\d+)/replies", path)
                if match:
                    if not db.execute("SELECT 1 FROM questions WHERE id=?", (match[1],)).fetchone(): return self.send(404, {"error": "문항이 없습니다."})
                    department = str(obj.get("department", "")).strip()
                    if not department: raise ValueError("회신 부서를 입력하세요.")
                    original, stored = self.upload(obj, {".xlsx", ".csv"})
                    if not original: raise ValueError("회신 엑셀 또는 CSV를 첨부하세요.")
                    cur = db.execute("INSERT INTO replies(question_id,department,comment,original_name,stored_name,created_at) VALUES(?,?,?,?,?,?)",
                                     (match[1], department, str(obj.get("comment", "")), original, stored, now))
                    return self.send(201, {"id": cur.lastrowid})
            return self.send(404, {"error": "경로를 찾을 수 없습니다."})
        except (ValueError, json.JSONDecodeError) as e:
            self.send(400, {"error": str(e)})
        except Exception as e:
            self.send(500, {"error": "처리 중 오류가 발생했습니다.", "detail": str(e)})


if __name__ == "__main__":
    connect().close()
    port = int(os.environ.get("BOARD_PORT", "8765"))
    print(f"게시판: http://127.0.0.1:{port}")
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
