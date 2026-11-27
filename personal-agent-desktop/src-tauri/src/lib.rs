use futures_util::StreamExt;
use serde::Deserialize;
use tauri::Emitter;

#[derive(Deserialize)]
struct ChatMessage { role: String, content: String }

#[tauri::command]
async fn chat_stream(
    window: tauri::Window,
    request_id: String,
    endpoint: String,
    api_key: String,
    model: String,
    messages: Vec<ChatMessage>,
) -> Result<(), String> {
    let client = reqwest::Client::new();
    let mut request = client.post(&endpoint).json(&serde_json::json!({
        "model": model, "stream": true,
        "messages": messages.iter().map(|m| serde_json::json!({"role":m.role,"content":m.content})).collect::<Vec<_>>()
    }));
    if !api_key.trim().is_empty() { request = request.bearer_auth(api_key); }
    let response = request.send().await.map_err(|e| format!("模型连接失败: {e}"))?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("模型请求失败 ({status}): {}", body.chars().take(500).collect::<String>()));
    }
    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    while let Some(chunk) = stream.next().await {
        let bytes = chunk.map_err(|e| format!("读取模型响应失败: {e}"))?;
        buffer.push_str(&String::from_utf8_lossy(&bytes));
        while let Some(pos) = buffer.find('\n') {
            let line = buffer[..pos].trim_end_matches('\r').to_string();
            buffer.drain(..=pos);
            if let Some(data) = line.strip_prefix("data:") {
                let data = data.trim();
                if data.is_empty() || data == "[DONE]" { continue; }
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(data) {
                    if let Some(token) = value["choices"][0]["delta"]["content"].as_str() {
                        if !token.is_empty() {
                            window.emit("model-stream", serde_json::json!({"requestId":request_id.clone(),"token":token}))
                                .map_err(|e| format!("发送模型事件失败: {e}"))?;
                        }
                    }
                }
            }
        }
    }
    window.emit("model-stream", serde_json::json!({"requestId":request_id.clone(),"done":true}))
        .map_err(|e| format!("结束模型事件失败: {e}"))?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![chat_stream])
        .run(tauri::generate_context!())
        .expect("error while running Personal Agent");
}
