"""Cross-platform OCR helper for AppNotas.

Usage:
    python ocr.py             # read the image currently on the clipboard
    python ocr.py IMAGE_PATH  # read an image file

Recognised text goes to stdout; every diagnostic goes to stderr so it can
never be mistaken for OCR output.

Exit codes:
    0  success (stdout may be empty when the image genuinely holds no text)
    2  no OCR engine is installed
    3  there was no image to read (empty clipboard, or path does not exist)

Engines are tried in order and the first confident result wins:
    RapidOCR   `pip install rapidocr-onnxruntime` - bundles its own ONNX
               weights, so it works offline and needs no LLM runtime.
    Tesseract  `dnf install tesseract tesseract-langpack-{eng,por}` - the
               dependency-light path, declared as a dependency of the RPM.
    EasyOCR    `pip install easyocr` - last resort; downloads ~100 MB of
               weights the first time it runs.
"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile

PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
WORKDIR = os.path.join(tempfile.gettempdir(), "appnotas-ocr")

EXIT_NO_ENGINE = 2
EXIT_NO_IMAGE = 3

# Fewer recognised characters than this means the engine almost certainly
# misfired, so the chain keeps going instead of returning junk.
MIN_CONFIDENT_CHARS = 5

INSTALL_HINT = (
    "No OCR engine installed. Install one of:\n"
    "  Fedora/RHEL   sudo dnf install tesseract tesseract-langpack-eng tesseract-langpack-por\n"
    "  Debian/Ubuntu sudo apt install tesseract-ocr tesseract-ocr-eng tesseract-ocr-por\n"
    "  any platform  pip install rapidocr-onnxruntime"
)


def log(message: str) -> None:
    print(message, file=sys.stderr)


def trust_corporate_ca() -> None:
    """Trust an exported corporate root CA when one is present.

    EasyOCR fetches its weights over HTTPS on first use. The work laptop runs
    Zscaler, which intercepts TLS, so that download fails unless Python trusts
    Zscaler's root. Everywhere else the file is absent and the system trust
    store is left alone.
    """
    candidates = (
        os.environ.get("APPNOTAS_CA_BUNDLE"),
        os.path.join(os.path.expanduser("~"), "zscaler.crt.cer"),
    )
    for cert in candidates:
        if cert and os.path.isfile(cert):
            os.environ.setdefault("SSL_CERT_FILE", cert)
            os.environ.setdefault("REQUESTS_CA_BUNDLE", cert)
            return


def clipboard_png_via_cli() -> bytes | None:
    """Pull a PNG off the clipboard with the Wayland/X11 clipboard tools.

    Pillow's `ImageGrab.grabclipboard()` shells out to these same binaries on
    Linux, but it raises when neither is installed and it requires Pillow in
    the first place. Calling them directly keeps Pillow optional here.
    """
    readers = (
        ["wl-paste", "--no-newline", "--type", "image/png"],
        ["xclip", "-selection", "clipboard", "-target", "image/png", "-out"],
    )
    for argv in readers:
        try:
            done = subprocess.run(argv, capture_output=True, timeout=20)
        except (OSError, subprocess.SubprocessError):
            continue  # tool not installed, or it hung - try the next one
        if done.returncode == 0 and done.stdout.startswith(PNG_MAGIC):
            return done.stdout
    return None


def grab_clipboard() -> str | None:
    """Write the clipboard image to disk and return its path, else None."""
    if sys.platform.startswith("linux"):
        data = clipboard_png_via_cli()
        if data is None:
            return None
        path = os.path.join(WORKDIR, "clipboard.png")
        with open(path, "wb") as handle:
            handle.write(data)
        return path

    try:
        from PIL import ImageGrab
    except ImportError:
        log("Reading the clipboard needs Pillow on this platform: pip install pillow")
        return None

    grabbed = ImageGrab.grabclipboard()
    if grabbed is None:
        return None
    # Copying a file in Explorer/Finder puts a list of paths on the clipboard
    # rather than pixels.
    if isinstance(grabbed, list):
        first = str(grabbed[0]) if grabbed else ""
        return first if os.path.isfile(first) else None

    path = os.path.join(WORKDIR, "clipboard.png")
    grabbed.save(path)
    return path


def preprocess(path: str) -> str:
    """Pad, upscale and contrast-boost the image for better recognition.

    Returns the original path unchanged if Pillow is missing or anything goes
    wrong - a slightly worse read beats no read at all.
    """
    try:
        from PIL import Image, ImageEnhance, ImageOps
    except ImportError:
        return path

    try:
        img = Image.open(path)
        if img.mode != "RGB":
            img = img.convert("RGB")
        # A white margin stops text detectors clipping glyphs at the edge, and
        # small screenshots recognise far better upscaled.
        img = ImageOps.expand(img, border=40, fill="white")
        if img.width < 1200:
            img = img.resize(
                (img.width * 2, img.height * 2), Image.Resampling.LANCZOS
            )
        img = ImageEnhance.Contrast(img).enhance(1.4)

        prepared = os.path.join(WORKDIR, "prepared.png")
        img.save(prepared)
        return prepared
    except Exception as exc:  # corrupt file, unsupported mode, no disk space
        log(f"Preprocessing skipped: {exc}")
        return path


def engine_rapidocr(path: str) -> tuple[bool, list[str]]:
    """(installed, lines) - RapidOCR, the preferred engine."""
    try:
        from rapidocr_onnxruntime import RapidOCR
    except ImportError:
        return False, []
    try:
        result, _ = RapidOCR()(path)
    except Exception as exc:
        log(f"RapidOCR failed: {exc}")
        return True, []
    return True, [line[1] for line in result or []]


def tesseract_langs() -> str | None:
    """The languages to hand tesseract, or None when tesseract is missing."""
    try:
        done = subprocess.run(
            ["tesseract", "--list-langs"], capture_output=True, text=True, timeout=20
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if done.returncode != 0:
        return None
    installed = set(done.stdout.split())
    # Portuguese first: this is a pt-PT user, and tesseract treats the leading
    # language as the dominant one when several are given.
    wanted = [lang for lang in ("por", "eng") if lang in installed]
    return "+".join(wanted) if wanted else "eng"


def engine_tesseract(path: str) -> tuple[bool, list[str]]:
    """(installed, lines) - the packaged Linux engine, driven over its CLI."""
    langs = tesseract_langs()
    if langs is None:
        return False, []
    try:
        done = subprocess.run(
            ["tesseract", path, "stdout", "-l", langs],
            capture_output=True,
            text=True,
            timeout=180,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        log(f"Tesseract failed: {exc}")
        return True, []
    if done.returncode != 0:
        log(f"Tesseract failed: {done.stderr.strip()}")
        return True, []
    return True, [line for line in done.stdout.splitlines() if line.strip()]


def engine_easyocr(path: str) -> tuple[bool, list[str]]:
    """(installed, lines) - heavyweight fallback; downloads weights on first run."""
    try:
        import easyocr
    except ImportError:
        return False, []
    try:
        result = easyocr.Reader(["pt", "en"], gpu=False).readtext(path)
    except Exception as exc:
        log(f"EasyOCR failed: {exc}")
        return True, []
    return True, [line[1] for line in result or []]


ENGINES = (
    ("RapidOCR", engine_rapidocr),
    ("Tesseract", engine_tesseract),
    ("EasyOCR", engine_easyocr),
)


def main(argv: list[str]) -> int:
    trust_corporate_ca()
    os.makedirs(WORKDIR, exist_ok=True)

    if argv:
        source = argv[0]
        if not os.path.isfile(source):
            log(f"Image not found: {source}")
            return EXIT_NO_IMAGE
    else:
        source = grab_clipboard()
        if source is None:
            log("No image on the clipboard.")
            return EXIT_NO_IMAGE

    prepared = preprocess(source)

    any_installed = False
    fallback: list[str] = []
    for name, engine in ENGINES:
        installed, lines = engine(prepared)
        any_installed = any_installed or installed
        if not lines:
            continue
        if len("".join(lines)) >= MIN_CONFIDENT_CHARS:
            log(f"Recognised by {name}.")
            print("\n".join(lines))
            return 0
        # Barely anything came back. Keep walking the chain, but hold on to it
        # in case no later engine does better.
        fallback = fallback or lines

    if fallback:
        print("\n".join(fallback))
        return 0
    if not any_installed:
        log(INSTALL_HINT)
        return EXIT_NO_ENGINE

    log("No text detected in the image.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
