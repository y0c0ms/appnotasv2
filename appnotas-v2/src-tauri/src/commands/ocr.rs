//! Clipboard / file OCR.
//!
//! The recognition itself lives in `ocr.py`, embedded at compile time so the
//! binary stays self-contained and the script cannot drift away from the code
//! that calls it. Python hosts the work because every usable OCR engine
//! (RapidOCR, EasyOCR) ships as a Python package; the script also drives the
//! `tesseract` CLI, which is the dependency-light path declared on the RPM.

const OCR_SCRIPT: &str = include_str!("ocr.py");

/// `ocr.py` exit code: no OCR engine is installed.
const EXIT_NO_ENGINE: i32 = 2;
/// `ocr.py` exit code: there was no image to read.
const EXIT_NO_IMAGE: i32 = 3;

/// Interpreter names to try, in order. Linux and macOS ship `python3`, a
/// stock Windows install only registers `python`, and the Store build only
/// puts the `py` launcher on PATH.
const PYTHONS: [&str; 3] = ["python3", "python", "py"];

/// Extract text from `image_path`, or from the system clipboard when it is
/// `None`. Returns an empty string when the image holds no readable text.
#[tauri::command]
pub async fn run_ocr(image_path: Option<String>) -> Result<String, String> {
    // Recognition burns whole seconds of CPU. Running it inline would block a
    // runtime worker and stall every other async command sharing it.
    tokio::task::spawn_blocking(move || ocr_blocking(image_path))
        .await
        .map_err(|e| format!("OCR task failed: {e}"))?
}

fn ocr_blocking(image_path: Option<String>) -> Result<String, String> {
    for python in PYTHONS {
        let mut cmd = std::process::Command::new(python);
        cmd.arg("-c").arg(OCR_SCRIPT);
        if let Some(path) = &image_path {
            // Passed as argv rather than interpolated into the script, so
            // paths containing quotes or backslashes cannot break it.
            cmd.arg(path);
        }
        // OCR output is arbitrary Unicode (µ, curly quotes, accents). Piped
        // Python writes stdout in the locale codepage and dies with
        // UnicodeEncodeError on anything outside it; this pins the pipe to
        // UTF-8, which the `from_utf8_lossy` below already expects.
        cmd.env("PYTHONIOENCODING", "utf-8");
        cmd.env("PYTHONUTF8", "1");

        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }

        let output = match cmd.output() {
            Ok(output) => output,
            // This interpreter name is not on PATH; try the next spelling.
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(e) => return Err(format!("Failed to run {python}: {e}")),
        };

        if output.status.success() {
            return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
        }

        // The script writes an actionable message to stderr for the exit codes
        // it defines; anything else is an unexpected crash worth labelling.
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(match output.status.code() {
            Some(EXIT_NO_ENGINE) | Some(EXIT_NO_IMAGE) => stderr,
            _ => format!("OCR failed: {stderr}"),
        });
    }

    Err(format!(
        "No Python interpreter on PATH (tried {}). OCR needs Python 3 installed.",
        PYTHONS.join(", ")
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ocr(image_path: Option<String>) -> Result<String, String> {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("tokio runtime")
            .block_on(run_ocr(image_path))
    }

    /// Exercises everything except the recognition itself: that the embedded
    /// script survives `include_str!`, that an interpreter is found, that the
    /// path arrives as argv, and that exit code 3 surfaces the script's own
    /// message instead of a generic failure. Needs only Python 3.
    #[test]
    fn missing_image_is_reported_verbatim() {
        let missing = std::env::temp_dir().join("appnotas-no-such-image.png");
        let _ = std::fs::remove_file(&missing);

        let err = ocr(Some(missing.display().to_string())).expect_err("should fail");

        assert_eq!(err, format!("Image not found: {}", missing.display()));
    }

    /// Full round trip through a real OCR engine. Ignored by default because
    /// it needs an engine installed and an image to read; run it with:
    ///
    /// ```text
    /// APPNOTAS_OCR_FIXTURE=/path/to/image.png cargo test -p app -- --ignored
    /// ```
    #[test]
    #[ignore = "needs an OCR engine and APPNOTAS_OCR_FIXTURE"]
    fn reads_text_from_an_image() {
        let fixture = std::env::var("APPNOTAS_OCR_FIXTURE")
            .expect("set APPNOTAS_OCR_FIXTURE to an image containing text");

        let text = ocr(Some(fixture)).expect("OCR should succeed");

        assert!(!text.is_empty(), "engine returned no text");
    }
}
