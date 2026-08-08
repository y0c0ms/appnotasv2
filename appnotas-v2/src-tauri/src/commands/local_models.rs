//! Discovery of local model servers.
//!
//! People run local models behind whatever server suits their hardware:
//! Ollama, llama.cpp's `llama-server`, LM Studio, vLLM, Jan, KoboldCpp,
//! TabbyAPI. Every one of them except Ollama speaks the OpenAI HTTP API, so
//! probing collapses to two shapes - Ollama's `/api/tags` and OpenAI's
//! `/v1/models` - and the UI only ever has to branch two ways.
//!
//! Nothing is configured by hand: each known server is probed concurrently on
//! its documented port and whatever answers gets offered to the user. Extra
//! base URLs (a remote box, a non-standard port) come from settings and are
//! probed for both shapes since their protocol is unknown up front.

use serde::Serialize;

/// Wire protocol a model server speaks.
#[derive(Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Api {
    Ollama,
    OpenAi,
}

/// A model server that answered a probe.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalRuntime {
    pub id: String,
    pub label: String,
    pub base_url: String,
    pub api: Api,
    /// Endpoint the UI posts a streamed chat completion to. Resolved here so
    /// the frontend never has to know how each protocol lays out its paths.
    pub chat_url: String,
    /// Models the server is offering. Can be empty: a server that is up but
    /// has nothing loaded is worth reporting, because "why is my model
    /// missing" is otherwise indistinguishable from "nothing is running".
    pub models: Vec<String>,
}

struct Known {
    id: &'static str,
    label: &'static str,
    base_url: &'static str,
    api: Api,
}

/// Default ports, as documented by each project.
const KNOWN: &[Known] = &[
    Known { id: "ollama", label: "Ollama", base_url: "http://127.0.0.1:11434", api: Api::Ollama },
    Known { id: "lmstudio", label: "LM Studio", base_url: "http://127.0.0.1:1234", api: Api::OpenAi },
    Known { id: "llamacpp", label: "llama.cpp", base_url: "http://127.0.0.1:8080", api: Api::OpenAi },
    Known { id: "vllm", label: "vLLM", base_url: "http://127.0.0.1:8000", api: Api::OpenAi },
    Known { id: "jan", label: "Jan", base_url: "http://127.0.0.1:1337", api: Api::OpenAi },
    Known { id: "koboldcpp", label: "KoboldCpp", base_url: "http://127.0.0.1:5001", api: Api::OpenAi },
    Known { id: "tabbyapi", label: "TabbyAPI", base_url: "http://127.0.0.1:5000", api: Api::OpenAi },
];

fn models_url(base_url: &str, api: Api) -> String {
    match api {
        Api::Ollama => format!("{base_url}/api/tags"),
        Api::OpenAi => format!("{base_url}/v1/models"),
    }
}

fn chat_url(base_url: &str, api: Api) -> String {
    match api {
        Api::Ollama => format!("{base_url}/api/chat"),
        Api::OpenAi => format!("{base_url}/v1/chat/completions"),
    }
}

fn parse_models(api: Api, json: &serde_json::Value) -> Vec<String> {
    let (list, key) = match api {
        Api::Ollama => (json["models"].as_array(), "name"),
        Api::OpenAi => (json["data"].as_array(), "id"),
    };
    list.map(|items| {
        items
            .iter()
            .filter_map(|item| item[key].as_str().map(str::to_string))
            .collect()
    })
    .unwrap_or_default()
}

async fn probe(
    client: &reqwest::Client,
    id: &str,
    label: &str,
    base_url: &str,
    api: Api,
) -> Option<LocalRuntime> {
    let resp = client.get(models_url(base_url, api)).send().await.ok()?;
    if !resp.status().is_success() {
        return None;
    }
    // A server on the right port speaking the wrong protocol answers 200 with
    // something that is not a model list; `parse_models` yields nothing and the
    // shape check below rejects it.
    let json: serde_json::Value = resp.json().await.ok()?;
    let expected_key = match api {
        Api::Ollama => "models",
        Api::OpenAi => "data",
    };
    if !json[expected_key].is_array() {
        return None;
    }

    Some(LocalRuntime {
        id: id.to_string(),
        label: label.to_string(),
        base_url: base_url.to_string(),
        api,
        chat_url: chat_url(base_url, api),
        models: parse_models(api, &json),
    })
}

/// Probe a user-supplied base URL, whose protocol is unknown. OpenAI first:
/// it is what everything but Ollama speaks.
async fn probe_unknown(client: &reqwest::Client, base_url: &str) -> Option<LocalRuntime> {
    for api in [Api::OpenAi, Api::Ollama] {
        if let Some(runtime) = probe(client, base_url, base_url, base_url, api).await {
            return Some(runtime);
        }
    }
    None
}

/// Find every local model server that is currently running.
///
/// `extra_endpoints` are base URLs from settings, e.g.
/// `http://192.168.1.50:8080`; the known defaults are always probed too.
#[tauri::command]
pub async fn discover_local_runtimes(
    extra_endpoints: Vec<String>,
) -> Result<Vec<LocalRuntime>, String> {
    use futures_util::future::join_all;

    let client = reqwest::Client::builder()
        // Nothing listening fails instantly with ECONNREFUSED; these caps only
        // bound a host that accepts the connection and then stalls.
        .connect_timeout(std::time::Duration::from_millis(700))
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let known = KNOWN
        .iter()
        .map(|k| probe(&client, k.id, k.label, k.base_url, k.api));

    // Trailing slashes would produce `//v1/models`, which some servers 404.
    let custom: Vec<String> = extra_endpoints
        .iter()
        .map(|url| url.trim().trim_end_matches('/').to_string())
        .filter(|url| !url.is_empty())
        .filter(|url| !KNOWN.iter().any(|k| k.base_url == url))
        .collect();

    let (mut found, extra) = futures_util::future::join(
        join_all(known),
        join_all(custom.iter().map(|url| probe_unknown(&client, url))),
    )
    .await;

    found.extend(extra);
    Ok(found.into_iter().flatten().collect())
}


#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    /// Answers every request with the same JSON, on a free port. A probe may
    /// try both protocols against one port, so this keeps serving rather than
    /// closing after the first connection.
    fn serve(body: &'static str) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().expect("local addr").port();

        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { break };
                let _ = stream.read(&mut [0u8; 2048]);
                let _ = stream.write_all(
                    format!(
                        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\
                         Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    )
                    .as_bytes(),
                );
            }
        });

        format!("http://127.0.0.1:{port}")
    }

    fn discover(extra: Vec<String>) -> Vec<LocalRuntime> {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("tokio runtime")
            .block_on(discover_local_runtimes(extra))
            .expect("discovery reports per-server failures by omission, not by erroring")
    }

    #[test]
    fn adopts_an_openai_server_on_a_custom_port() {
        let base = serve(r#"{"object":"list","data":[{"id":"qwen2.5-coder-7b"},{"id":"phi-4"}]}"#);

        // Trailing slash on purpose: it must not survive into the built URLs.
        let found = discover(vec![format!("{base}/")]);

        let runtime = found
            .iter()
            .find(|r| r.base_url == base)
            .expect("the server should have been found");
        assert!(matches!(runtime.api, Api::OpenAi));
        assert_eq!(runtime.chat_url, format!("{base}/v1/chat/completions"));
        assert_eq!(runtime.models, ["qwen2.5-coder-7b", "phi-4"]);
    }

    /// The OpenAI probe is tried first and gets a 200 carrying the wrong shape;
    /// it must be rejected on shape rather than accepted as an empty server.
    #[test]
    fn falls_back_to_the_ollama_shape_when_the_body_is_not_openai() {
        let base = serve(r#"{"models":[{"name":"llama3.2:3b"}]}"#);

        let found = discover(vec![base.clone()]);

        let runtime = found
            .iter()
            .find(|r| r.base_url == base)
            .expect("the server should have been found");
        assert!(matches!(runtime.api, Api::Ollama));
        assert_eq!(runtime.chat_url, format!("{base}/api/chat"));
        assert_eq!(runtime.models, ["llama3.2:3b"]);
    }

    #[test]
    fn ignores_an_endpoint_with_nothing_behind_it() {
        // Port 1 needs privileges to bind, so nothing of ours can be there.
        let found = discover(vec!["http://127.0.0.1:1".into()]);

        assert!(found.iter().all(|r| r.base_url != "http://127.0.0.1:1"));
    }
}