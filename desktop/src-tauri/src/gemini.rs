use reqwest::Client;
use serde_json::json;
use std::env;
use std::error::Error;

#[derive(Clone)]
pub struct Gemini {
    client: Client,
    api_key: String,
}

impl Gemini {
    pub fn new() -> Self {
        dotenv::dotenv().ok();
        let api_key = env::var("GEMINI_API_KEY").unwrap_or_default();
        Self {
            client: Client::new(),
            api_key,
        }
    }

    pub async fn improve_note(&self, content: &str, dynamic_key: Option<String>) -> Result<String, Box<dyn Error + Send + Sync>> {
        let key = dynamic_key.unwrap_or_else(|| self.api_key.clone());
        
        if key.is_empty() {
            return Err("Gemini API Key is missing. Please set it in Settings.".into());
        }

        // Try gemini-2.5-flash first, fallback to preview version
        let models = vec![
            "gemini-2.5-flash",
            "gemini-2.5-flash-preview-0924"
        ];
        
        let mut last_error = String::new();
        
        for model in models {
            let url = format!(
                "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
                model, key
            );

            let response = match self.client
                .post(&url)
                .json(&json!({
                    "contents": [{
                        "parts": [{
                            "text": format!("You are a note-taking assistant. Rewrite this note to be clearer, more concise, and better organized. Return ONLY the improved note text with no explanations, options, or meta-commentary:\n\n{}", content)
                        }]
                    }]
                }))
                .send()
                .await {
                    Ok(r) => r,
                    Err(e) => {
                        last_error = format!("Request failed for {}: {}", model, e);
                        continue;
                    }
                };

            let json: serde_json::Value = match response.json().await {
                Ok(j) => j,
                Err(e) => {
                    last_error = format!("JSON parse failed for {}: {}", model, e);
                    continue;
                }
            };
            
            // Check if there's an error in the response
            if let Some(error) = json.get("error") {
                let error_msg = error.get("message")
                    .and_then(|m| m.as_str())
                    .unwrap_or("Unknown API error");
                last_error = format!("{}: {}", model, error_msg);
                continue; // Try next model
            }
            
            // Success! Extract the text
            if let Some(improved) = json["candidates"][0]["content"]["parts"][0]["text"].as_str() {
                return Ok(improved.trim().to_string());
            } else {
                last_error = format!("{}: Failed to parse response structure", model);
                continue;
            }
        }
        
        // All models failed
        Err(format!("All models failed. Last error: {}", last_error).into())
    }
}
