// 答案生成器：根据试卷文本调用 OpenAI 兼容 LLM API，流式生成参考答案 HTML。
//
// 功能：
//   - generate_answers:           组装 Prompt → 调 chat/completions（stream:true）→
//                                 逐段 emit "answer-stream-chunk" 事件 → 返回完整 HTML
//   - cancel_answer_generation:   置取消标志，流式循环逐行检查后中止
//   - convert_answer_html_to_pdf: 把答案 HTML 写入缓存目录，复用捆绑 LibreOffice
//                                 转 PDF（soffice --convert-to pdf），返回 PDF 路径
//
// 约定：
//   - OpenAI 兼容 SSE 格式：逐行 `data: {json}`，`choices[0].delta.content` 为增量文本，
//     末尾 `data: [DONE]`。
//   - 重活放 spawn_blocking，错误统一 Result<T, String> 中文友好提示。
//   - API Key / BaseURL / 模型名由前端配置页传入，此处仅做非空兜底校验。

use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::path::Path;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use tauri::{Emitter, Manager};
use ureq::AgentBuilder;

// 生成任务取消标志注册表：task_id → 是否已请求取消。
// 用 OnceLock 惰性初始化（HashMap::new 非常量，无法直接 static 初始化）。
fn cancel_registry() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    static REGISTRY: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

// 生成完成/取消/失败后自动从注册表移除任务，避免残留。
struct GenerationGuard<'a> {
    task_id: &'a str,
}

impl Drop for GenerationGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut reg) = cancel_registry().lock() {
            reg.remove(self.task_id);
        }
    }
}

// 流式推送 payload：前端按 taskId 过滤，避免陈旧事件串台。
#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct StreamChunkPayload {
    task_id: String,
    delta: String,
}

/// 生成参考答案。返回完整 HTML；期间通过 "answer-stream-chunk" 事件流式推送增量。
#[tauri::command]
pub async fn generate_answers(
    app: tauri::AppHandle,
    pdf_text: String,
    custom_prompt: Option<String>,
    base_url: String,
    api_key: String,
    model: String,
    task_id: String,
    protocol: String,
) -> Result<String, String> {
    // 网络请求 + SSE 读取放阻塞线程池执行，避免占用主线程/IPC 异步运行时。
    tauri::async_runtime::spawn_blocking(move || {
        generate_answers_sync(
            &app,
            &pdf_text,
            custom_prompt.as_deref(),
            &base_url,
            &api_key,
            &model,
            &task_id,
            &protocol,
        )
    })
    .await
    .map_err(|e| format!("答案生成后台执行失败：{e}"))?
}

/// 取消指定任务。流式循环在每次读到一行后检查标志；阻塞 read 期间最长 ~60s 生效。
#[tauri::command]
pub fn cancel_answer_generation(task_id: String) -> Result<(), String> {
    let reg = cancel_registry()
        .lock()
        .map_err(|e| format!("内部状态锁失效：{e}"))?;
    if let Some(flag) = reg.get(&task_id) {
        flag.store(true, Ordering::Relaxed);
    }
    Ok(())
}

/// 测试 API 连接：用当前配置发一次最小请求，快速验证 key / 地址 / 模型名是否可用。
/// 非 2xx 会透出服务端错误（如 401 表示 key 无效、404 表示模型名不存在）。
/// 网络请求放阻塞线程池执行：同步命令跑在主线程，一旦 HTTP 阻塞 UI 会整个冻结转圈。
#[tauri::command]
pub async fn test_api_connection(
    base_url: String,
    api_key: String,
    model: String,
    protocol: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        test_api_connection_sync(&base_url, &api_key, &model, &protocol)
    })
    .await
    .map_err(|e| format!("测试连接内部错误：{e}"))?
}

fn test_api_connection_sync(
    base_url: &str,
    api_key: &str,
    model: &str,
    protocol: &str,
) -> Result<String, String> {
    if api_key.trim().is_empty() {
        return Err("未配置 API Key".to_string());
    }
    if base_url.trim().is_empty() {
        return Err("未配置接口地址(BaseURL)".to_string());
    }
    if model.trim().is_empty() {
        return Err("未配置模型名称".to_string());
    }
    let anthropic = protocol == "anthropic";
    // 探测性请求：超时收短到 10s，服务端无响应时不用等太久。
    let agent = AgentBuilder::new()
        .timeout(Duration::from_secs(10))
        .build();
    let resp = if anthropic {
        let url = anthropic_messages_url(base_url);
        let body = serde_json::json!({
            "model": model,
            "max_tokens": 8,
            "messages": [{ "role": "user", "content": "hi" }],
        });
        agent
            .post(&url)
            .set("Content-Type", "application/json")
            .set("x-api-key", api_key.trim())
            .set("anthropic-version", "2023-06-01")
            .send_json(body)
            .map_err(http_error_message)?
    } else {
        let url = openai_chat_url(base_url);
        let body = serde_json::json!({
            "model": model,
            "messages": [{ "role": "user", "content": "hi" }],
            "max_tokens": 5,
        });
        agent
            .post(&url)
            .set("Content-Type", "application/json")
            .set("Authorization", &format!("Bearer {}", api_key.trim()))
            .send_json(body)
            .map_err(http_error_message)?
    };
    Ok(format!("连接成功(HTTP {})", resp.status()))
}

/// 将答案 HTML 转 PDF：写入 {app_data}/answer_cache/{task_id}/answer.html，
/// 复用捆绑 LibreOffice 无头转换，返回生成的 PDF 缓存路径（前端随后 copy_file 到用户位置）。
#[tauri::command]
pub async fn convert_answer_html_to_pdf(
    app: tauri::AppHandle,
    task_id: String,
    html: String,
) -> Result<String, String> {
    // soffice 子进程等待，放阻塞线程池执行，避免冻结 UI 线程。
    tauri::async_runtime::spawn_blocking(move || {
        let app_data = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("获取应用数据目录失败：{e}"))?;
        let cache_dir = app_data.join("answer_cache").join(&task_id);
        fs::create_dir_all(&cache_dir).map_err(|e| format!("创建缓存目录失败：{e}"))?;
        let html_path = cache_dir.join("answer.html");
        fs::write(&html_path, &html).map_err(|e| format!("写入 HTML 失败：{e}"))?;

        let soffice = crate::find_libreoffice(&app)
            .ok_or_else(|| "未检测到 LibreOffice，请先安装后再导出 PDF".to_string())?;
        let ok = crate::run_soffice_single(
            &soffice,
            html_path.to_str().unwrap_or(""),
            &cache_dir,
            Duration::from_secs(120),
        );
        if !ok {
            return Err("HTML 转 PDF 失败或超时".to_string());
        }
        // soffice 输出名 = 输入 html 的 stem：answer.html → answer.pdf
        let pdf_path = cache_dir.join("answer.pdf");
        if !pdf_path.exists() {
            return Err("HTML 转换未生成 PDF 文件".to_string());
        }
        Ok(pdf_path.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| format!("HTML 转换后台执行失败：{e}"))?
}

// 组装完整 Prompt：自定义指令(或默认，由前端保证非空) + 试卷文本。
fn build_prompt(custom: Option<&str>, pdf_text: &str) -> Result<String, String> {
    let instruction = custom
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| "Prompt 为空，请配置后重试".to_string())?;
    Ok(format!(
        "{instruction}\n\n下面是需要作答的试卷文本，请按原题顺序逐一作答：\n\n--- 试卷开始 ---\n{pdf_text}\n--- 试卷结束 ---"
    ))
}

/// 去掉 baseUrl 末尾的斜杠，避免拼出 `//chat/completions`。
fn strip_trailing_slash(s: &str) -> &str {
    s.trim_end_matches('/')
}

/// 解析一行 SSE（OpenAI 与 Anthropic 兼容协议统一处理）：
///   - OpenAI：`data: {json}`，文本在 choices[0].delta.content，末尾 `data: [DONE]`
///   - Anthropic：`data: {json}`，文本在 content_block_delta.delta.text，结束是 message_stop
/// 注释行（`:` 开头）、空行、`event:`/`id:`/`retry:` 均忽略。
#[derive(Debug)]
enum SseEvent {
    Chunk(String),
    Done,
    Error(String),
    Ignore,
}

fn parse_sse_line(line: &str) -> SseEvent {
    let line = line.trim();
    if line.is_empty() || line.starts_with(':') {
        return SseEvent::Ignore;
    }
    let Some(payload) = line.strip_prefix("data:") else {
        return SseEvent::Ignore;
    };
    let payload = payload.trim();
    if payload == "[DONE]" {
        return SseEvent::Done;
    }
    let Ok(v) = serde_json::from_str::<serde_json::Value>(payload) else {
        return SseEvent::Ignore;
    };
    // 错误：OpenAI 与 Anthropic 都放在 error 字段
    if let Some(err) = v.get("error") {
        let msg = err
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("流中错误")
            .to_string();
        return SseEvent::Error(msg);
    }
    // OpenAI 兼容：choices[0].delta.content（推理型模型先发 role/reasoning，content 可能缺失）
    if let Some(delta) = v
        .get("choices")
        .and_then(|c| c.as_array())
        .and_then(|a| a.first())
        .and_then(|c| c.get("delta"))
        .and_then(|d| d.get("content"))
        .and_then(|s| s.as_str())
    {
        if delta.is_empty() {
            return SseEvent::Ignore;
        }
        return SseEvent::Chunk(delta.to_string());
    }
    // Anthropic 兼容：content_block_delta 事件，文本在 delta.text
    if v.get("type").and_then(|t| t.as_str()) == Some("content_block_delta") {
        if let Some(text) = v
            .get("delta")
            .and_then(|d| d.get("text"))
            .and_then(|s| s.as_str())
        {
            if !text.is_empty() {
                return SseEvent::Chunk(text.to_string());
            }
        }
        return SseEvent::Ignore;
    }
    // Anthropic：message_stop 表示流结束
    if v.get("type").and_then(|t| t.as_str()) == Some("message_stop") {
        return SseEvent::Done;
    }
    SseEvent::Ignore
}

/// OpenAI 兼容接口地址：`{base}/chat/completions`。
fn openai_chat_url(base_url: &str) -> String {
    format!("{}/chat/completions", strip_trailing_slash(base_url))
}

/// Anthropic 兼容接口地址：`{base}/v1/messages`。
/// base 已含 /v1 前缀则直接用（如 opencode go 的 .../zen/go/v1），否则补上。
fn anthropic_messages_url(base_url: &str) -> String {
    let base = strip_trailing_slash(base_url);
    let base = if base.ends_with("/v1") {
        base.to_string()
    } else {
        format!("{base}/v1")
    };
    format!("{base}/messages")
}

/// 拉取提供商可用模型列表（OpenAI 兼容 /models 端点，如 opencode go 的 .../v1/models）。
/// 返回模型 ID 数组，供前端下拉选择；key 为空时也尝试（目录可能公开）。
/// 同步命令会卡主线程，这里同样放阻塞线程池执行。
#[tauri::command]
pub async fn list_available_models(
    base_url: String,
    api_key: String,
) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        list_available_models_sync(&base_url, &api_key)
    })
    .await
    .map_err(|e| format!("获取模型列表内部错误：{e}"))?
}

fn list_available_models_sync(base_url: &str, api_key: &str) -> Result<Vec<String>, String> {
    if base_url.trim().is_empty() {
        return Err("未配置接口地址(BaseURL)".to_string());
    }
    let agent = AgentBuilder::new()
        .timeout(Duration::from_secs(15))
        .build();
    let url = format!("{}/models", strip_trailing_slash(base_url));
    let mut req = agent.get(&url);
    if !api_key.trim().is_empty() {
        req = req.set("Authorization", &format!("Bearer {}", api_key.trim()));
    }
    let resp = req.call().map_err(http_error_message)?;
    let body = resp
        .into_string()
        .map_err(|e| format!("读取模型列表失败：{e}"))?;
    parse_models_response(&body).ok_or_else(|| "解析模型列表失败，接口响应格式异常".to_string())
}

/// 在系统文件管理器中打开指定文件夹（批量生成完成后「打开文件」用）。
/// macOS `open` / Windows `explorer` / Linux `xdg-open`，零新增依赖。
#[tauri::command]
pub fn open_folder(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err(format!("文件夹不存在：{path}"));
    }
    #[cfg(target_os = "macos")]
    let st = Command::new("open").arg(&path).status();
    #[cfg(target_os = "windows")]
    let st = Command::new("explorer").arg(&path).status();
    #[cfg(target_os = "linux")]
    let st = Command::new("xdg-open").arg(&path).status();
    st.map_err(|e| format!("打开文件夹失败：{e}"))
        .and_then(|s| {
            if s.success() {
                Ok(())
            } else {
                Err("打开文件夹失败".to_string())
            }
        })
}

/// 解析 OpenAI 兼容 /models 响应（{ "data": [{ "id": "..." }] }），返回模型 ID。
fn parse_models_response(body: &str) -> Option<Vec<String>> {
    let v: serde_json::Value = serde_json::from_str(body).ok()?;
    let arr = v.get("data")?.as_array()?;
    let ids: Vec<String> = arr
        .iter()
        .filter_map(|m| m.get("id").and_then(|i| i.as_str()).map(str::to_string))
        .collect();
    if ids.is_empty() {
        None
    } else {
        Some(ids)
    }
}

// 将 ureq 错误转成中文友好提示；非 2xx 尝试解析服务端 error.message。
// 常见状态码附加一句判断提示，帮用户区分「配置问题」还是「服务端问题」。
fn http_error_message(e: ureq::Error) -> String {
    match e {
        ureq::Error::Status(code, resp) => {
            let mut body = String::new();
            let _ = resp.into_reader().take(2048).read_to_string(&mut body);
            // 服务端错误通常是 { "error": { "message": "..." } }
            let msg = match serde_json::from_str::<serde_json::Value>(&body) {
                Ok(v) => v
                    .get("error")
                    .and_then(|e| e.get("message"))
                    .and_then(|m| m.as_str())
                    .map(|m| m.to_string())
                    .unwrap_or_else(|| body.trim().to_string()),
                Err(_) => body.trim().to_string(),
            };
            let hint = if code == 401 {
                "（API Key 无效，请检查）"
            } else if code == 404 {
                "（接口或模型名不存在，请检查地址/模型名）"
            } else if code == 429 {
                "（请求过于频繁或额度不足）"
            } else if code >= 500 {
                "（服务端异常，请稍后重试；若持续出现可换 DeepSeek 官方试试）"
            } else {
                ""
            };
            if msg.is_empty() {
                format!("请求失败(HTTP {code}){hint}")
            } else {
                format!("请求失败(HTTP {code}): {msg}{hint}")
            }
        }
        ureq::Error::Transport(t) => format!(
            "网络错误：{}",
            t.message().unwrap_or("未知网络错误")
        ),
    }
}

fn generate_answers_sync(
    app: &tauri::AppHandle,
    pdf_text: &str,
    custom_prompt: Option<&str>,
    base_url: &str,
    api_key: &str,
    model: &str,
    task_id: &str,
    protocol: &str,
) -> Result<String, String> {
    if api_key.trim().is_empty() {
        return Err("未配置 API Key".to_string());
    }
    if base_url.trim().is_empty() {
        return Err("未配置接口地址(BaseURL)".to_string());
    }
    if model.trim().is_empty() {
        return Err("未配置模型名称".to_string());
    }
    let anthropic = protocol == "anthropic";
    let full_prompt = build_prompt(custom_prompt, pdf_text)?;

    // 注册取消标志；guard 负责在任意退出路径上清理注册表。
    let cancel_flag = Arc::new(AtomicBool::new(false));
    {
        let mut reg = cancel_registry()
            .lock()
            .map_err(|e| format!("内部状态锁失效：{e}"))?;
        reg.insert(task_id.to_string(), cancel_flag.clone());
    }
    let _guard = GenerationGuard { task_id };

    let agent = AgentBuilder::new()
        .timeout_connect(Duration::from_secs(15))
        .timeout_read(Duration::from_secs(60))
        .build();
    // 按协议构造请求：OpenAI 兼容（chat/completions + Bearer）或
    // Anthropic 兼容（/v1/messages + x-api-key）。
    let resp = if anthropic {
        let url = anthropic_messages_url(base_url);
        let body = serde_json::json!({
            "model": model,
            "max_tokens": 16000,
            "messages": [{ "role": "user", "content": full_prompt }],
            "stream": true,
            "temperature": 0.3,
        });
        agent
            .post(&url)
            .set("Content-Type", "application/json")
            .set("x-api-key", api_key.trim())
            .set("anthropic-version", "2023-06-01")
            .send_json(body)
            .map_err(http_error_message)?
    } else {
        let url = openai_chat_url(base_url);
        let body = serde_json::json!({
            "model": model,
            "messages": [{ "role": "user", "content": full_prompt }],
            "stream": true,
            "temperature": 0.3,
        });
        agent
            .post(&url)
            .set("Content-Type", "application/json")
            .set("Authorization", &format!("Bearer {}", api_key.trim()))
            .send_json(body)
            .map_err(http_error_message)?
    };

    // 流式读取 SSE：逐行解析 data，累加全文并 emit 增量事件。
    let mut reader = BufReader::new(resp.into_reader());
    let deadline = Instant::now() + Duration::from_secs(300);
    let mut line = String::new();
    let mut full_html = String::new();
    loop {
        line.clear();
        let n = reader
            .read_line(&mut line)
            .map_err(|e| format!("读取响应中断：{e}"))?;
        if n == 0 {
            break;
        }
        if Instant::now() > deadline {
            return Err("生成超时（300 秒），请重试".to_string());
        }
        if cancel_flag.load(Ordering::Relaxed) {
            return Err("已取消".to_string());
        }
        match parse_sse_line(&line) {
            SseEvent::Chunk(delta) => {
                full_html.push_str(&delta);
                let _ = app.emit(
                    "answer-stream-chunk",
                    StreamChunkPayload {
                        task_id: task_id.to_string(),
                        delta,
                    },
                );
            }
            SseEvent::Done => break,
            SseEvent::Error(m) => return Err(format!("生成失败：{m}")),
            SseEvent::Ignore => {}
        }
    }

    Ok(full_html)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_sse_line_handles_chunk() {
        let line = r#"data: {"choices":[{"delta":{"content":"你好"}}]}"#;
        match parse_sse_line(line) {
            SseEvent::Chunk(d) => assert_eq!(d, "你好"),
            other => panic!("期望 Chunk，得到 {other:?}"),
        }
    }

    #[test]
    fn parse_sse_line_handles_done() {
        match parse_sse_line("data: [DONE]") {
            SseEvent::Done => {}
            other => panic!("期望 Done，得到 {other:?}"),
        }
    }

    #[test]
    fn parse_sse_line_ignores_noise() {
        assert!(matches!(parse_sse_line(""), SseEvent::Ignore));
        assert!(matches!(parse_sse_line(": keep-alive comment"), SseEvent::Ignore));
        assert!(matches!(parse_sse_line("event: message"), SseEvent::Ignore));
        assert!(matches!(parse_sse_line("id: 1"), SseEvent::Ignore));
        // delta.content 缺失或为 null
        assert!(matches!(
            parse_sse_line(r#"data: {"choices":[{"delta":{"role":"assistant"}}]}"#),
            SseEvent::Ignore
        ));
        assert!(matches!(
            parse_sse_line(r#"data: {"choices":[{"delta":{"content":null}}]}"#),
            SseEvent::Ignore
        ));
        // 非 JSON 的 data 行忽略
        assert!(matches!(parse_sse_line("data: not-json"), SseEvent::Ignore));
    }

    #[test]
    fn parse_sse_line_handles_error() {
        let line = r#"data: {"error":{"message":"Insufficient Balance"}}"#;
        match parse_sse_line(line) {
            SseEvent::Error(m) => assert!(m.contains("Insufficient Balance")),
            other => panic!("期望 Error，得到 {other:?}"),
        }
    }

    #[test]
    fn parse_sse_line_handles_anthropic_delta() {
        let line = r#"data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"答案内容"}}"#;
        match parse_sse_line(line) {
            SseEvent::Chunk(d) => assert_eq!(d, "答案内容"),
            other => panic!("期望 Chunk，得到 {other:?}"),
        }
    }

    #[test]
    fn parse_sse_line_handles_anthropic_stop_and_ignore() {
        assert!(matches!(
            parse_sse_line(r#"data: {"type":"message_stop"}"#),
            SseEvent::Done
        ));
        // 非文本事件 / ping / 空 delta 均应忽略
        assert!(matches!(
            parse_sse_line(r#"data: {"type":"content_block_start","content_block":{"type":"text","text":""}}"#),
            SseEvent::Ignore
        ));
        assert!(matches!(
            parse_sse_line(r#"data: {"type":"ping"}"#),
            SseEvent::Ignore
        ));
        assert!(matches!(
            parse_sse_line(r#"data: {"type":"content_block_delta","delta":{"type":"text_delta","text":""}}"#),
            SseEvent::Ignore
        ));
    }

    #[test]
    fn parse_sse_line_handles_anthropic_error() {
        let line = r#"data: {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"}}"#;
        match parse_sse_line(line) {
            SseEvent::Error(m) => assert!(m.contains("invalid x-api-key")),
            other => panic!("期望 Error，得到 {other:?}"),
        }
    }

    #[test]
    fn anthropic_messages_url_normalizes_base() {
        assert_eq!(
            anthropic_messages_url("https://opencode.ai/zen/go/v1"),
            "https://opencode.ai/zen/go/v1/messages"
        );
        assert_eq!(
            anthropic_messages_url("https://opencode.ai/zen/go/v1/"),
            "https://opencode.ai/zen/go/v1/messages"
        );
        assert_eq!(
            anthropic_messages_url("https://api.anthropic.com"),
            "https://api.anthropic.com/v1/messages"
        );
    }

    #[test]
    fn parse_models_response_extracts_ids() {
        let body = r#"{"object":"list","data":[{"id":"deepseek-v4-flash","object":"model"},{"id":"qwen3.8-max"},{"id":"grok-4.5"}]}"#;
        assert_eq!(
            parse_models_response(body),
            Some(vec![
                "deepseek-v4-flash".to_string(),
                "qwen3.8-max".to_string(),
                "grok-4.5".to_string()
            ])
        );
    }

    #[test]
    fn parse_models_response_rejects_bad_shape() {
        assert_eq!(parse_models_response("not json"), None);
        assert_eq!(parse_models_response(r#"{"data":[]}"#), None);
        assert_eq!(parse_models_response(r#"{"object":"list"}"#), None);
    }

    #[test]
    fn build_prompt_requires_non_empty_custom() {
        assert!(build_prompt(None, "试卷").is_err());
        assert!(build_prompt(Some("  "), "试卷").is_err());
        assert!(build_prompt(Some(""), "试卷").is_err());
    }

    #[test]
    fn build_prompt_embeds_instruction_and_paper() {
        let prompt = build_prompt(Some("  请作答  "), "第一题内容").unwrap();
        assert!(prompt.starts_with("请作答"));
        assert!(prompt.contains("--- 试卷开始 ---\n第一题内容\n--- 试卷结束 ---"));
    }

    #[test]
    fn strip_trailing_slash_removes_all() {
        assert_eq!(strip_trailing_slash("https://api.deepseek.com"), "https://api.deepseek.com");
        assert_eq!(strip_trailing_slash("https://api.deepseek.com/"), "https://api.deepseek.com");
        assert_eq!(strip_trailing_slash("https://api.deepseek.com///"), "https://api.deepseek.com");
    }
}
