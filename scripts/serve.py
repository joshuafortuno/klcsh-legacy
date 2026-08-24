#!/usr/bin/env python3
"""
serve.py — local dev server that understands frontend/_redirects.

Plain `python -m http.server` has no idea "/settings" should serve
account/settings.html — that mapping only exists in _redirects,
which is a Netlify-specific file the real production servers read.
This script reads that exact same file, so pretty URLs behave
identically here as they will once deployed — no Node/npm install
needed just to test that, and no separate list of routes to keep
in sync by hand (it's parsed straight from _redirects itself).

Usage:
  python scripts/serve.py [port]     (defaults to 8000)
"""

import http.server
import os
import sys

ROOT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend")
REDIRECTS_FILE = os.path.join(ROOT, "_redirects")
HEADERS_FILE = os.path.join(ROOT, "_headers")


def load_redirects():
    """Parses "/source  /target.html  200" lines into {source: target}.
    Skips blank lines and comments, same as Netlify does."""
    rules = {}
    if not os.path.exists(REDIRECTS_FILE):
        return rules
    with open(REDIRECTS_FILE, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split()
            if len(parts) >= 2:
                rules[parts[0]] = parts[1]
    return rules


def load_headers():
    """Parses Netlify's _headers block format:

        /some/path
          Header-Name: value
          Header-Name2: value2

        /other/path
          Header-Name: value

    into {path: [(name, value), ...]}. A path of "/*" matches every
    request — that's the only pattern actually used right now, but
    exact paths and trailing "/*" prefixes are also honored so this
    keeps working if more specific rules get added later.
    """
    rules = {}
    if not os.path.exists(HEADERS_FILE):
        return rules
    current_path = None
    with open(HEADERS_FILE, encoding="utf-8") as f:
        for raw_line in f:
            line = raw_line.rstrip("\n")
            stripped = line.strip()
            if not stripped or stripped.startswith("#"):
                continue
            if not line[0].isspace():
                current_path = stripped
                rules[current_path] = []
            elif current_path and ":" in stripped:
                name, _, value = stripped.partition(":")
                rules[current_path].append((name.strip(), value.strip()))
    return rules


REDIRECTS = load_redirects()
HEADERS = load_headers()


def headers_for(route):
    if route in HEADERS:
        return HEADERS[route]
    for pattern, entries in HEADERS.items():
        if pattern.endswith("/*") and route.startswith(pattern[:-1]):
            return entries
    return HEADERS.get("/*", [])


class PrettyURLHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def translate_path(self, path):
        # translate_path only needs the route (no query string) to
        # find a file on disk — the query string itself still
        # reaches the page normally via the browser's address bar.
        route = path.split("?", 1)[0].split("#", 1)[0]
        if route in REDIRECTS:
            return super().translate_path(REDIRECTS[route])
        return super().translate_path(path)

    def end_headers(self):
        route = self.path.split("?", 1)[0].split("#", 1)[0]
        for name, value in headers_for(route):
            self.send_header(name, value)
        super().end_headers()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    server = http.server.ThreadingHTTPServer(("", port), PrettyURLHandler)
    print(f"Serving {ROOT}")
    print(f"http://localhost:{port}  ({len(REDIRECTS)} pretty-URL rules from _redirects, {len(HEADERS)} header rules from _headers)")
    server.serve_forever()


if __name__ == "__main__":
    main()
