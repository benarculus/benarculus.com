import importlib.util
import copy
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("live", Path(__file__).parents[2] / "scripts/verify-live.py")
live = importlib.util.module_from_spec(spec)
spec.loader.exec_module(live)


class Pixels(unittest.TestCase):
    def test_exact_zero_pixels_and_one_pixel_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            before, after, diff = [root / name for name in ["before.png", "after.png", "diff.png"]]
            live.write_diff(before, 2, 1, b"\xff\0\0\xff" * 2)
            live.write_diff(after, 2, 1, b"\xff\0\0\xff" * 2)
            self.assertEqual(live.compare_images(before, after, diff), 0)
            live.write_diff(after, 2, 1, b"\xff\0\0\xff\0\0\0\xff")
            self.assertEqual(live.compare_images(before, after, diff), 1)
            self.assertEqual(live.png_pixels(diff)[2], b"\xff\xff\xff\xff\xff\0\xff\xff")

    def test_dimensions_are_not_tolerated(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            live.write_diff(root / "before.png", 1, 1, b"\0\0\0\xff")
            live.write_diff(root / "after.png", 2, 1, b"\0\0\0\xff" * 2)
            self.assertEqual(live.compare_images(root / "before.png", root / "after.png", root / "diff.png"), 1)

    def test_corrupt_png_stops(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "corrupt.png"
            path.write_bytes(b"corrupt")
            with self.assertRaises(RuntimeError):
                live.png_pixels(path)

class BaselineContract(unittest.TestCase):
    def fixture(self):
        manifest = [{"path": f"/original/{name}", "sha256": "a" * 64}
                    for name in sorted(live.SCREENSHOTS)]
        pages = [{"device": device, "route_name": route,
                  "url": "https://benarculus.com" + path,
                  "screenshots": [f"/original/{device}-{route}-{mode}.png" for mode in live.MODES]}
                 for device in live.DEVICES for route, path in live.ROUTES.items()]
        return {"screenshot_manifest": manifest}, {"pages": pages}

    def test_exact_capture_set_required(self):
        summary, observations = self.fixture()
        live.validate_baseline_contract(summary, observations)
        for i in range(16):
            with self.subTest(omitted=i):
                mutated = copy.deepcopy(summary)
                del mutated["screenshot_manifest"][i]
                with self.assertRaises(RuntimeError):
                    live.validate_baseline_contract(mutated, observations)
        for mutation in ["empty", "duplicate", "extra", "name", "unsafe", "hash", "route", "capture", "device"]:
            with self.subTest(mutation=mutation):
                s, o = copy.deepcopy(summary), copy.deepcopy(observations)
                if mutation == "empty":
                    s["screenshot_manifest"] = []
                elif mutation == "duplicate":
                    s["screenshot_manifest"][-1] = s["screenshot_manifest"][0]
                elif mutation == "extra":
                    s["screenshot_manifest"].append(s["screenshot_manifest"][0])
                elif mutation == "name":
                    s["screenshot_manifest"][0]["path"] = "/original/desktop-unexpected-full.png"
                elif mutation == "unsafe":
                    s["screenshot_manifest"][0]["path"] = "/original/../desktop-home-full.png"
                elif mutation == "hash":
                    s["screenshot_manifest"][0]["sha256"] = "invalid"
                elif mutation == "route":
                    o["pages"][0]["url"] = "https://benarculus.com/wrong"
                elif mutation == "capture":
                    o["pages"][0]["screenshots"][0] = "/original/desktop-notes-full.png"
                elif mutation == "device":
                    o["pages"][0]["device"] = "other"
                with self.assertRaises(RuntimeError):
                    live.validate_baseline_contract(s, o)

    def test_exact_capture_output_is_required(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            for name in live.SCREENSHOTS:
                (root / name).write_bytes(b"fixture")
            live.validate_output_screenshots(root)
            missing = root / next(iter(live.SCREENSHOTS))
            missing.unlink()
            with self.assertRaises(RuntimeError):
                live.validate_output_screenshots(root)
            missing.write_bytes(b"fixture")
            (root / "unexpected.png").write_bytes(b"fixture")
            with self.assertRaises(RuntimeError):
                live.validate_output_screenshots(root)

class Observations(unittest.TestCase):
    def fixture(self):
        page = {
            "device": "desktop", "route_name": "home", "url": "https://benarculus.com/",
            "title": "Home", "headings": [], "text": "approved text",
            "fontFaces": [], "computedFonts": [], "platform_fonts": {},
            "images": [{"complete": True, "naturalWidth": 10}], "links": [],
            "viewport": {"width": 1440, "scrollWidth": 1440},
            "network_failures": [], "errors": [],
            "network_responses": [],
        }
        return {
            "browser": {"product": "fixed"}, "settings": {"locale": "en-US"},
            "pages": [page], "navigation": [{"passed": True}],
            "http": {
                "/": {"status": 200, "body": '<meta name="description" content="approved">', "sha256": "home"},
                "/rss.xml": {"status": 200, "body": "<rss/>", "sha256": "feed"},
                "/production-baseline-missing-page/": {"status": 404, "body": "missing", "sha256": "missing"},
            },
            "sitemap_urls": ["https://benarculus.com/"], "rss_validation": {"items": 1},
        }

    def test_functional_failures_are_not_success_shaped(self):
        before = self.fixture()
        live.validate_observations(before, copy.deepcopy(before))
        for failure in ["content", "metadata", "feed", "404", "navigation", "overflow",
                        "javascript", "script", "image", "network", "resource", "missing-route", "browser", "fonts"]:
            with self.subTest(failure=failure):
                after = copy.deepcopy(before)
                page = after["pages"][0]
                if failure == "content":
                    page["text"] = "changed"
                elif failure == "metadata":
                    after["http"]["/"]["body"] = '<meta name="description" content="changed">'
                elif failure == "feed":
                    after["http"]["/rss.xml"]["sha256"] = "changed"
                elif failure == "404":
                    after["http"]["/production-baseline-missing-page/"]["status"] = 200
                elif failure == "navigation":
                    after["navigation"][0]["passed"] = False
                elif failure == "overflow":
                    page["viewport"]["scrollWidth"] = 1441
                elif failure == "javascript":
                    page["errors"] = [{"method": "Runtime.exceptionThrown"}]
                elif failure == "script":
                    after["http"]["/"]["body"] += "<SCRIPT>window.unexpected = true</script >"
                elif failure == "image":
                    page["images"][0]["naturalWidth"] = 0
                elif failure == "network":
                    page["network_failures"] = [{"error": "failed"}]
                elif failure == "resource":
                    page["network_responses"] = [{"url": "https://unexpected.invalid/script", "status": 200, "type": "Script"}]
                elif failure == "missing-route":
                    after["pages"] = []
                elif failure == "browser":
                    after["browser"]["product"] = "different"
                elif failure == "fonts":
                    page["platform_fonts"] = {"h1": "substituted"}
                with self.assertRaises(RuntimeError):
                    live.validate_observations(before, after)


if __name__ == "__main__":
    unittest.main()
