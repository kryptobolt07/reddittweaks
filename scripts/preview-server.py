"""Local preview server that exposes only demo/ and extension/ (never .git, artifacts/ or research captures)."""
import functools
import http.server
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ALLOWED = ('/demo/', '/extension/')
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8765


class Handler(http.server.SimpleHTTPRequestHandler):
    def _allowed(self):
        # Reject DNS-rebinding hosts as well as paths outside the two public folders.
        if self.headers.get('Host', '') not in (f'127.0.0.1:{PORT}', f'localhost:{PORT}'):
            return False
        path = self.path.split('?', 1)[0].split('#', 1)[0]
        return path.startswith(ALLOWED) and '..' not in path

    def do_GET(self):
        if self.path in ('/', ''):
            self.send_response(302)
            self.send_header('Location', '/demo/')
            self.end_headers()
        elif self._allowed():
            super().do_GET()
        else:
            self.send_error(404)

    do_HEAD = do_GET


if __name__ == '__main__':
    handler = functools.partial(Handler, directory=str(ROOT))
    with http.server.ThreadingHTTPServer(('127.0.0.1', PORT), handler) as server:
        print(f'Preview: http://127.0.0.1:{PORT}/demo/ and /demo/tweaks/index.html')
        server.serve_forever()
