#!/usr/bin/env python3
"""vplan save helper — dialog-free Save for vplan pages.

The vplan page (file://) POSTs its serialized self to /save?name=vplan_<IP>.html and this
server writes it onto the real ~/vplans/vplan_<IP>.html. It exists because a browser page
cannot write a file without a user-picked dialog, and corporate AV / macOS TCC can block
writes into folders like ~/Documents anyway — a localhost write into ~/vplans avoids both.

Guardrails:
  - binds 127.0.0.1 only
  - rejects any request whose Origin is a real web origin (file:// pages send "null" or nothing),
    so a hostile web page cannot reach it even via DNS rebinding
  - only accepts a bare vplan_*.html filename that ALREADY exists in ~/vplans — create_vplan
    creates the file first, so this server can never mint or touch anything else
  - body must look like a vplan document (has the vplan-data block) and fit in 20 MB
  - writes are atomic: temp file in the same directory, then os.replace

Optional: pass --mirror <dir> to also copy each saved file into a backup directory.

Run by launchd (com.vplan.save, KeepAlive). Log: ~/Library/Logs/vplan-save.log
"""
import http.server
import os
import re
import sys
import tempfile
import shutil
import time
import urllib.parse

HOME = os.path.expanduser('~/vplans')
MIRROR = sys.argv[sys.argv.index('--mirror') + 1] if '--mirror' in sys.argv else ''
PORT = 8790
NAME_RE = re.compile(r'^vplan_[A-Za-z0-9._-]+\.html$')
MAX_BODY = 20 * 1024 * 1024
MARKER = b'<script id="vplan-data"'


def log(msg):
    print(time.strftime('%Y-%m-%d %H:%M:%S'), msg, flush=True)


class Handler(http.server.BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def _reply(self, code, text):
        body = text.encode('utf-8')
        self.send_response(code)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Type', 'text/plain; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _origin_ok(self):
        return self.headers.get('Origin', 'null') in ('', 'null')

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Content-Length', '0')
        self.end_headers()

    def do_GET(self):
        if urllib.parse.urlparse(self.path).path == '/ping':
            self._reply(200, 'vplan-save alive')
        else:
            self._reply(404, 'not found')

    def do_POST(self):
        try:
            url = urllib.parse.urlparse(self.path)
            if url.path != '/save':
                return self._reply(404, 'not found')
            if not self._origin_ok():
                log(f'REJECT origin={self.headers.get("Origin")}')
                return self._reply(403, 'forbidden origin')
            name = urllib.parse.parse_qs(url.query).get('name', [''])[0]
            if not NAME_RE.match(name) or name == 'vplan_template.html':
                return self._reply(400, 'bad name')
            target = os.path.join(HOME, name)
            if not os.path.isfile(target):
                log(f'REJECT unknown plan {name}')
                return self._reply(404, f'{name} is not an existing plan — create_vplan first')
            length = int(self.headers.get('Content-Length', 0))
            if not 0 < length <= MAX_BODY:
                return self._reply(413, 'bad size')
            body = self.rfile.read(length)
            if MARKER not in body:
                return self._reply(400, 'not a vplan document')
            fd, tmp = tempfile.mkstemp(dir=HOME, prefix='.' + name + '.', suffix='.tmp')
            try:
                with os.fdopen(fd, 'wb') as f:
                    f.write(body)
                os.replace(tmp, target)
            finally:
                if os.path.exists(tmp):
                    os.unlink(tmp)
            mirrored = ''
            try:
                if MIRROR and os.path.isdir(MIRROR):
                    shutil.copy2(target, os.path.join(MIRROR, name))
                    mirrored = ' +mirror'
            except OSError as e:
                mirrored = f' (mirror failed: {e})'
            log(f'saved {name} {length}B{mirrored}')
            self._reply(200, 'saved')
        except Exception as e:  # keep the server alive no matter what one request does
            log(f'ERROR {e!r}')
            try:
                self._reply(500, 'internal error')
            except Exception:
                pass

    def log_message(self, *a):  # default per-request stderr noise off; we log what matters
        pass


if __name__ == '__main__':
    os.makedirs(HOME, exist_ok=True)
    addr = ('127.0.0.1', PORT)
    httpd = http.server.ThreadingHTTPServer(addr, Handler)
    log(f'listening on {addr[0]}:{addr[1]} for {HOME}' + (f' (mirror: {MIRROR})' if MIRROR else ''))
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        sys.exit(0)
