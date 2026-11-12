#!/usr/bin/env python3
"""Replay the digest-bound approved CDP capture, without candidate dependencies."""
import hashlib
import importlib.util
import json
import platform
import signal
import struct
import sys
import time
import zlib
from pathlib import Path
from html.parser import HTMLParser
import re

sys.dont_write_bytecode = True
ROUTES = {
    "home": "/", "notes": "/blog/",
    "article": "/blog/generate-clarity-by-establishing-a-writing-practice/",
    "not-found": "/production-baseline-missing-page/",
}
DEVICES = ("desktop", "mobile")
MODES = ("viewport", "full")
SCREENSHOTS = {f"{device}-{route}-{mode}.png"
               for device in DEVICES for route in ROUTES for mode in MODES}


class ScriptInventory(HTMLParser):
    def __init__(self, body):
        super().__init__()
        self.scripts = []
        self.active = False
        self.feed(body)

    def handle_starttag(self, tag, attrs):
        if tag == "script":
            self.scripts.append([sorted(attrs), ""])
            self.active = True

    def handle_data(self, data):
        if self.active:
            self.scripts[-1][1] += data

    def handle_endtag(self, tag):
        if tag == "script":
            self.active = False


def require(condition, message):
    if not condition:
        raise RuntimeError(message)

def safe_name(path):
    require(isinstance(path, str) and path.startswith("/"), "Invalid screenshot path")
    parts = path.split("/")[1:]
    require(all(re.fullmatch(r"[A-Za-z0-9._-]+", part) and part not in (".", "..")
                for part in parts), "Unsafe screenshot path")
    return parts[-1]


def validate_baseline_contract(summary, observations):
    entries = summary.get("screenshot_manifest")
    require(isinstance(entries, list) and len(entries) == 16, "Baseline must declare exactly 16 screenshots")
    names = [safe_name(entry["path"]) for entry in entries]
    require(len(set(names)) == 16 and set(names) == SCREENSHOTS, "Unexpected or duplicate baseline screenshots")
    require(all(re.fullmatch(r"[a-f0-9]{64}", entry.get("sha256", "")) for entry in entries),
            "Invalid screenshot hash")
    pages = observations.get("pages")
    require(isinstance(pages, list) and len(pages) == 8, "Baseline must declare eight page captures")
    seen = set()
    for page in pages:
        device, route = page.get("device"), page.get("route_name")
        require(device in DEVICES and route in ROUTES, "Unexpected baseline route/device")
        key = f"{device}-{route}"
        require(key not in seen, "Duplicate baseline route/device")
        seen.add(key)
        require(page.get("url") == f"https://benarculus.com{ROUTES[route]}", "Wrong baseline route URL")
        captures = page.get("screenshots")
        require(isinstance(captures, list) and len(captures) == 2, "Missing baseline captures")
        require({safe_name(path) for path in captures} == {f"{key}-{mode}.png" for mode in MODES},
                "Wrong baseline page screenshots")

def validate_output_screenshots(output):
    require({path.name for path in output.glob("*.png")} == SCREENSHOTS,
            "Capture output has missing or unexpected screenshots")


def png_pixels(path):
    """Decode the noninterlaced 8-bit RGB/RGBA PNGs emitted by Chromium."""
    data = path.read_bytes()
    require(data[:8] == b"\x89PNG\r\n\x1a\n", "Not a PNG")
    offset, compressed = 8, b""
    while offset < len(data):
        length = struct.unpack(">I", data[offset:offset + 4])[0]
        kind = data[offset + 4:offset + 8]
        payload = data[offset + 8:offset + 8 + length]
        require(zlib.crc32(kind + payload) & 0xffffffff ==
                struct.unpack(">I", data[offset + 8 + length:offset + 12 + length])[0],
                "Corrupt PNG")
        if kind == b"IHDR":
            width, height, depth, color, compression, filtering, interlace = struct.unpack(">IIBBBBB", payload)
            require(depth == 8 and color in (2, 6) and
                    compression == filtering == interlace == 0, "Unsupported PNG format")
        elif kind == b"IDAT":
            compressed += payload
        offset += length + 12
    channels = 3 if color == 2 else 4
    stride = width * channels
    raw = zlib.decompress(compressed)
    require(len(raw) == height * (stride + 1), "Invalid PNG dimensions")
    previous, pixels = bytearray(stride), bytearray()
    for row in range(height):
        start = row * (stride + 1)
        mode = raw[start]
        require(mode in range(5), "Invalid PNG filter")
        current = bytearray(raw[start + 1:start + 1 + stride])
        for i in range(stride):
            left = current[i - channels] if i >= channels else 0
            above = previous[i]
            upper_left = previous[i - channels] if i >= channels else 0
            if mode == 1:
                prediction = left
            elif mode == 2:
                prediction = above
            elif mode == 3:
                prediction = (left + above) // 2
            elif mode == 4:
                p = left + above - upper_left
                distances = (abs(p - left), abs(p - above), abs(p - upper_left))
                prediction = (left, above, upper_left)[distances.index(min(distances))]
            else:
                prediction = 0
            current[i] = (current[i] + prediction) & 255
        if channels == 4:
            pixels.extend(current)
        else:
            for i in range(0, stride, 3):
                pixels.extend(current[i:i + 3] + b"\xff")
        previous = current
    return width, height, pixels


def write_diff(path, width, height, pixels):
    def chunk(kind, payload):
        return (struct.pack(">I", len(payload)) + kind + payload +
                struct.pack(">I", zlib.crc32(kind + payload) & 0xffffffff))
    stride = width * 4
    raw = b"".join(b"\0" + pixels[i:i + stride] for i in range(0, len(pixels), stride))
    path.write_bytes(b"\x89PNG\r\n\x1a\n" +
                     chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)) +
                     chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def compare_images(before, after, diff):
    bw, bh, bp = png_pixels(before)
    aw, ah, ap = png_pixels(after)
    width, height = max(bw, aw), max(bh, ah)
    pixels, changed = bytearray(), 0
    for y in range(height):
        for x in range(width):
            old = bp[(y * bw + x) * 4:(y * bw + x + 1) * 4] if x < bw and y < bh else None
            new = ap[(y * aw + x) * 4:(y * aw + x + 1) * 4] if x < aw and y < ah else None
            different = old != new
            changed += different
            pixels.extend(b"\xff\0\xff\xff" if different else b"\xff\xff\xff\xff")
    write_diff(diff, width, height, pixels)
    return changed


def validate_observations(before, after):
    require("fatal_error" not in after, "Capture failed")
    require(before["browser"] == after["browser"], "Browser version/UA changed")
    require(before["settings"] == after["settings"], "Rendering settings changed")
    require(len(before["pages"]) == len(after["pages"]), "Missing captured route")
    for old, new in zip(before["pages"], after["pages"]):
        for key in ["device", "route_name", "url", "title", "headings", "text",
                    "fontFaces", "computedFonts", "platform_fonts", "images", "links", "viewport"]:
            require(old[key] == new[key], f"{new['device']} {new['route_name']}: changed {key}")
        responses = lambda page: sorted((r["url"], r["status"], r.get("type"))
                                        for r in page["network_responses"])
        require(responses(old) == responses(new), "Unexpected browser resource or response")
        require(not new["network_failures"], "Browser network failure")
        require(not any(error.get("method") == "Runtime.exceptionThrown" for error in new["errors"]),
                "Unexpected JavaScript error")
        require(new["viewport"]["scrollWidth"] <= new["viewport"]["width"], "Horizontal overflow")
        require(all(image["complete"] and image["naturalWidth"] > 0 for image in new["images"]),
                "Image failed to decode")
        expected_404 = new["route_name"] == "not-found"
        for error in new["errors"]:
            if error.get("method") == "Log.entryAdded":
                entry = error["params"]["entry"]
                require(expected_404 and entry.get("source") == "network" and
                        "404" in entry.get("text", "") and
                        "/production-baseline-missing-page/" in entry.get("url", ""),
                        "Unexpected browser log entry")
    require(before["navigation"] == after["navigation"] and
            all(item["passed"] for item in after["navigation"]), "Navigation regression")
    for path, old in before["http"].items():
        require(path in after["http"], f"Missing HTTP check: {path}")
        new = after["http"][path]
        require(old["status"] == new["status"], f"HTTP status changed: {path}")
        # Discovery documents and public media are contract checks, not just 200s.
        if not path.endswith((".html", "/")):
            require(old["sha256"] == new["sha256"], f"Feed/asset content changed: {path}")
        if path.endswith((".html", "/")):
            # Metadata must remain stable even when generated CSS filenames change.
            import re
            pattern = r"<(?:meta|link)\b[^>]*(?:canonical|description|og:|twitter:)[^>]*>"
            require(re.findall(pattern, old["body"]) == re.findall(pattern, new["body"]),
                    f"Metadata changed: {path}")
            require(ScriptInventory(old["body"]).scripts ==
                    ScriptInventory(new["body"]).scripts, f"Unexpected JavaScript: {path}")
    require(before["sitemap_urls"] == after["sitemap_urls"], "Published routes changed")
    require(before["rss_validation"] == after["rss_validation"], "RSS changed")
    captured = {page["url"] for page in after["pages"]}
    require(set(after["sitemap_urls"]).issubset(captured), "Baseline does not cover every published route")


def main(baseline, output):
    baseline, output = Path(baseline).resolve(), Path(output).resolve()
    require(baseline != output, "Never write into approved baseline")
    summary = json.loads((baseline / "summary.json").read_text())
    require(platform.platform() == summary["os"], "Exact approved OS/fonts host required")
    before = json.loads((baseline / "observations.json").read_text())
    validate_baseline_contract(summary, before)
    for image in summary["screenshot_manifest"]:
        require(hashlib.sha256((baseline / safe_name(image["path"])).read_bytes()).hexdigest() == image["sha256"],
                "Altered baseline image")
    spec = importlib.util.spec_from_file_location("approved_capture", baseline / "capture.py")
    capture = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(capture)
    require(capture.BASE == "https://benarculus.com", "Unexpected capture origin")
    require(capture.ROUTES == ROUTES, "Unexpected capture routes")
    capture.ROOT = output
    original_call = capture.CDP.call
    trace = (output / "cdp-trace.jsonl").open("w")

    def traced_call(self, method, params=None):
        result = original_call(self, method, params)
        require(not any(event.get("method") == "Runtime.exceptionThrown"
                        for event in self.events), "Unexpected JavaScript exception")
        if method == "Runtime.evaluate" and "await document.fonts.ready" in params.get("expression", ""):
            decoded = original_call(self, "Runtime.evaluate", {
                "expression": "(async()=>{await Promise.all([...document.images].map(i=>i.decode())); return document.fonts.status})()",
                "awaitPromise": True, "returnByValue": True,
            })
            require("exceptionDetails" not in decoded and decoded["result"].get("value") == "loaded",
                    "Image decode or font loading failed")
        # PNG bytes already live in the screenshot files.
        trace.write(json.dumps({
            "time": time.time(), "method": method, "params": params,
            "result": {"savedAsPNG": True} if method == "Page.captureScreenshot" else result,
        }) + "\n")
        trace.flush()
        return result
    capture.CDP.call = traced_call
    # SIGALRM raises inside capture.main; its finally stops the owned browser.
    def timeout(_signum, _frame):
        raise TimeoutError("Live capture exceeded 240 seconds")
    signal.signal(signal.SIGALRM, timeout)
    signal.alarm(240)
    try:
        capture.main()
    finally:
        signal.alarm(0)
        trace.close()
    after = json.loads((output / "observations.json").read_text())
    validate_baseline_contract(summary, after)
    validate_output_screenshots(output)
    differences = {}
    for image in summary["screenshot_manifest"]:
        name = Path(image["path"]).name
        old, new = baseline / name, output / name
        require(hashlib.sha256(old.read_bytes()).hexdigest() == image["sha256"], "Altered baseline image")
        (output / f"before-{name}").write_bytes(old.read_bytes())
        differences[name] = compare_images(old, new, output / f"diff-{name}")
    (output / "pixel-differences.json").write_text(json.dumps(differences, indent=2))
    require(not any(differences.values()), "Unexpected pixels; inspect before/after/diff evidence")
    validate_observations(before, after)
    (output / "live-result.json").write_text(json.dumps({"passed": True, "pixelsChanged": 0}))


if __name__ == "__main__":
    require(len(sys.argv) == 3, "Usage: verify-live.py BASELINE NEW_EVIDENCE_DIRECTORY")
    main(*sys.argv[1:])
