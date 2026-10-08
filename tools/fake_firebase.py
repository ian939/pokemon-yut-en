"""화면 검사용 가짜 Firebase 실시간 데이터베이스 (REST 일부).

    GET / PUT / PATCH / DELETE  /<경로>.json   — 자료 읽기·쓰기 (PATCH 는 한 단계 합치기)
    GET + Accept: text/event-stream            — 실시간 구독 (event: put, data: {"path":"/","data":...})
    CORS 허용 (다른 포트의 게임 화면에서 부르므로)

    from fake_firebase import FakeFirebase
    db = FakeFirebase(); url = db.start()      # http://127.0.0.1:포트
"""
import http.server
import json
import threading
import time


class FakeFirebase:
    def __init__(self):
        self.data = {}
        self.ver = 0
        self.cond = threading.Condition()
        self.writes = 0

    def _get(self, parts):
        cur = self.data
        for p in parts:
            if not isinstance(cur, dict) or p not in cur:
                return None
            cur = cur[p]
        return cur

    def _set(self, parts, value):
        if not parts:
            self.data = value if isinstance(value, dict) else {}
            return
        cur = self.data
        for p in parts[:-1]:
            if not isinstance(cur.get(p), dict):
                cur[p] = {}
            cur = cur[p]
        if value is None:
            cur.pop(parts[-1], None)
        else:
            cur[parts[-1]] = value

    def start(self):
        db = self

        class H(http.server.BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *a):
                pass

            def cors(self):
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Access-Control-Allow-Methods", "GET,PUT,PATCH,DELETE,OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "content-type,x-firebase-etag,if-match")

            def parts(self):
                path = self.path.split("?")[0]
                if path.endswith(".json"):
                    path = path[:-5]
                return [p for p in path.split("/") if p]

            def reply(self, obj, code=200):
                body = json.dumps(obj).encode("utf-8")
                self.send_response(code)
                self.cors()
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def body(self):
                n = int(self.headers.get("Content-Length") or 0)
                return json.loads(self.rfile.read(n) or b"null")

            def do_OPTIONS(self):
                self.send_response(200)
                self.cors()
                self.send_header("Content-Length", "0")
                self.end_headers()

            def do_GET(self):
                parts = self.parts()
                if "text/event-stream" in (self.headers.get("Accept") or ""):
                    self.send_response(200)
                    self.cors()
                    self.send_header("Content-Type", "text/event-stream")
                    self.send_header("Cache-Control", "no-cache")
                    self.end_headers()
                    seen = -1
                    try:
                        while True:
                            with db.cond:
                                if db.ver == seen:
                                    db.cond.wait(timeout=10)
                                cur, ver = db._get(parts), db.ver
                            if ver != seen:
                                seen = ver
                                msg = "event: put\ndata: " + json.dumps({"path": "/", "data": cur}) + "\n\n"
                            else:
                                msg = "event: keep-alive\ndata: null\n\n"
                            self.wfile.write(msg.encode("utf-8"))
                            self.wfile.flush()
                    except Exception:
                        return
                with db.cond:
                    cur = db._get(parts)
                self.reply(cur)

            def write(self, fn):
                parts = self.parts()
                val = self.body()
                with db.cond:
                    fn(parts, val)
                    db.ver += 1
                    db.writes += 1
                    db.cond.notify_all()
                    cur = db._get(parts)
                self.reply(cur)

            def do_PUT(self):
                self.write(lambda parts, val: db._set(parts, val))

            def do_PATCH(self):
                def merge(parts, val):
                    for k, v in (val or {}).items():
                        db._set(parts + [k], v)
                self.write(merge)

            def do_DELETE(self):
                self.write(lambda parts, val: db._set(parts, None))

        self.httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.httpd.daemon_threads = True
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        return "http://127.0.0.1:%d" % self.httpd.server_port

    def stop(self):
        self.httpd.shutdown()
