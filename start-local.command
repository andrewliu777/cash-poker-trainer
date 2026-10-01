#!/bin/zsh
set -e
cd -- "$(dirname -- "$0")"

if ! command -v python3 >/dev/null 2>&1; then
    echo "Python 3 is required to start the local poker table."
    read -r "?Press Enter to close this window."
    exit 1
fi

python3 - <<'PY'
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Timer
import sys
import webbrowser

address = ("127.0.0.1", 8877)
try:
    server = ThreadingHTTPServer(address, SimpleHTTPRequestHandler)
except OSError as error:
    print(f"Could not start the poker table on port 8877: {error}")
    print("If it is already running, open http://127.0.0.1:8877/ in your browser.")
    sys.exit(1)

url = "http://127.0.0.1:8877/"
print(f"Poker table: {url}")
print("Keep this window open while playing. Press Control-C to stop.")
Timer(0.2, lambda: webbrowser.open(url)).start()
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    server.server_close()
PY
