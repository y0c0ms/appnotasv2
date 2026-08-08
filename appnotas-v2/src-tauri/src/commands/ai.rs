// AI HTTP transport + Claude Code credential access.
//
// All AI provider traffic (Gemini and Claude) goes through `ai_http` so it uses
// a reqwest client whose TLS validates against the OS certificate store. On a
// corporate machine running Zscaler, IT installs Zscaler's root CA into the
// Windows certificate store, so TLS interception is trusted and HTTPS works.
// Browser `fetch` and the previous tauri-plugin-http path had no usable cert
// store wired in, which is why AI calls failed behind the proxy.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug, Deserialize)]
pub struct HttpRequest {
    pub url: String,
    pub method: String,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    /// Raw request body (already serialized, e.g. JSON string). Optional.
    #[serde(default)]
    pub body: Option<String>,
    /// Timeout in milliseconds. Defaults to 120s.
    #[serde(default)]
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Serialize)]
pub struct HttpResponse {
    pub status: u16,
    pub ok: bool,
    pub headers: HashMap<String, String>,
    pub body: String,
}

/// Generic AI HTTP request. Uses native-root TLS (trusts OS cert store, incl.
/// corporate proxies like Zscaler) and honours system proxy env vars
/// (HTTPS_PROXY / HTTP_PROXY / NO_PROXY), which reqwest reads automatically.
#[tauri::command]
pub async fn ai_http(req: HttpRequest) -> Result<HttpResponse, String> {
    let timeout = std::time::Duration::from_millis(req.timeout_ms.unwrap_or(120_000));

    let client = reqwest::Client::builder()
        .timeout(timeout)
        // reqwest auto-detects HTTP(S)_PROXY/NO_PROXY from the environment.
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let method = reqwest::Method::from_bytes(req.method.to_uppercase().as_bytes())
        .map_err(|e| format!("Invalid HTTP method '{}': {e}", req.method))?;

    let mut builder = client.request(method, &req.url);

    for (k, v) in &req.headers {
        builder = builder.header(k.as_str(), v.as_str());
    }

    if let Some(body) = req.body {
        builder = builder.body(body);
    }

    let resp = builder.send().await.map_err(|e| {
        // Surface a clearer hint for the common corporate-proxy TLS failure.
        if e.is_connect() || e.to_string().to_lowercase().contains("certificate") {
            format!(
                "Network/TLS error reaching {}: {e}. If you are on a corporate \
                 network (e.g. Zscaler), make sure the proxy root certificate is \
                 installed in your OS certificate store.",
                req.url
            )
        } else {
            format!("Request to {} failed: {e}", req.url)
        }
    })?;

    let status = resp.status();
    let mut headers = HashMap::new();
    for (k, v) in resp.headers().iter() {
        if let Ok(val) = v.to_str() {
            headers.insert(k.as_str().to_string(), val.to_string());
        }
    }

    let body = resp
        .text()
        .await
        .map_err(|e| format!("Failed to read response body: {e}"))?;

    Ok(HttpResponse {
        status: status.as_u16(),
        ok: status.is_success(),
        headers,
        body,
    })
}

/// One line of a streamed NDJSON response, pushed to the webview as it arrives.
#[derive(Clone, Serialize)]
struct StreamChunk {
    id: String,
    chunk: String,
}

#[derive(Debug, Deserialize)]
pub struct StreamRequest {
    /// Correlation id echoed back on every `ai-stream-chunk` event so the UI can
    /// ignore chunks belonging to another in-flight request.
    pub id: String,
    pub url: String,
    /// Raw JSON request body (must ask the server for a streamed response).
    pub body: String,
}

/// Stream a chat completion (Ollama `/api/chat` with `"stream": true`).
///
/// Browser `fetch` cannot be used for this: the webview origin is
/// `http://tauri.localhost`, which Ollama rejects as a cross-origin request, so
/// the response never reaches the UI. Reading the socket here keeps the same
/// native-TLS/proxy behaviour as `ai_http` while still being incremental.
///
/// Emits one `ai-stream-chunk` event per complete NDJSON line, and returns the
/// whole body so the caller can reconcile the final text (an event may still be
/// in flight when this resolves).
#[tauri::command]
pub async fn ai_stream(app: tauri::AppHandle, req: StreamRequest) -> Result<String, String> {
    use futures_util::StreamExt;
    use tauri::Emitter;

    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(10))
        // Local generation on CPU is slow; the cap only guards a wedged server.
        .timeout(std::time::Duration::from_secs(900))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let resp = client
        .post(&req.url)
        .header("Content-Type", "application/json")
        .body(req.body)
        .send()
        .await
        .map_err(|e| format!("Request to {} failed: {e}", req.url))?;

    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("HTTP {}: {body}", status.as_u16()));
    }

    let mut full = String::new();
    let mut pending: Vec<u8> = Vec::new();
    let mut stream = resp.bytes_stream();

    while let Some(item) = stream.next().await {
        let bytes = item.map_err(|e| format!("Stream read error: {e}"))?;
        pending.extend_from_slice(&bytes);

        // Emit only whole lines: a chunk boundary can land mid-line (and
        // mid-UTF-8-codepoint), which would break JSON parsing in the UI.
        while let Some(nl) = pending.iter().position(|b| *b == b'\n') {
            let line: Vec<u8> = pending.drain(..=nl).collect();
            let text = String::from_utf8_lossy(&line).trim().to_string();
            if text.is_empty() {
                continue;
            }
            full.push_str(&text);
            full.push('\n');
            let _ = app.emit(
                "ai-stream-chunk",
                StreamChunk {
                    id: req.id.clone(),
                    chunk: text,
                },
            );
        }
    }

    let tail = String::from_utf8_lossy(&pending).trim().to_string();
    if !tail.is_empty() {
        full.push_str(&tail);
        let _ = app.emit(
            "ai-stream-chunk",
            StreamChunk {
                id: req.id,
                chunk: tail,
            },
        );
    }

    Ok(full)
}

fn claude_credentials_path() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("Could not resolve home directory")?;
    Ok(home.join(".claude").join(".credentials.json"))
}

/// Read the raw `~/.claude/.credentials.json` produced by Claude Code.
/// Returns `null` (None) if the file does not exist, so the UI can fall back
/// to Gemini gracefully instead of erroring.
#[tauri::command]
pub async fn claude_read_credentials() -> Result<Option<String>, String> {
    let path = claude_credentials_path()?;
    if !path.exists() {
        return Ok(None);
    }
    std::fs::read_to_string(&path)
        .map(Some)
        .map_err(|e| format!("Failed to read Claude credentials: {e}"))
}

/// Merge updated `claudeAiOauth` fields back into the credentials file without
/// disturbing other top-level keys (mcpOAuth, organizationUuid, ...). Called
/// after a token refresh so the user's real Claude Code login stays valid and
/// in sync (single source of truth for the access/refresh tokens).
#[tauri::command]
pub async fn claude_write_oauth(oauth: serde_json::Value) -> Result<(), String> {
    let path = claude_credentials_path()?;

    // Start from the existing file when present so we preserve sibling keys.
    let mut root: serde_json::Value = if path.exists() {
        let existing = std::fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read Claude credentials: {e}"))?;
        serde_json::from_str(&existing)
            .map_err(|e| format!("Failed to parse Claude credentials: {e}"))?
    } else {
        serde_json::json!({})
    };

    if !root.is_object() {
        return Err("Claude credentials file is not a JSON object".to_string());
    }

    root["claudeAiOauth"] = oauth;

    let serialized = serde_json::to_string_pretty(&root)
        .map_err(|e| format!("Failed to serialize Claude credentials: {e}"))?;

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create .claude dir: {e}"))?;
    }
    std::fs::write(&path, serialized)
        .map_err(|e| format!("Failed to write Claude credentials: {e}"))?;

    Ok(())
}
