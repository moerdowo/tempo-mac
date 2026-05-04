mod cli_login;
mod keyring;

use cli_login::CliResult;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::time::Duration;
use tauri::AppHandle;

#[derive(Debug, Serialize, Deserialize)]
pub struct ProbeResponse {
    pub status: u16,
    pub headers: HashMap<String, String>,
    pub body: Option<String>,
    pub www_authenticate: Option<String>,
    pub accept_payment: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PaidRequest {
    pub url: String,
    pub method: Option<String>,
    pub headers: Option<HashMap<String, String>>,
    pub body: Option<String>,
}

fn build_client() -> reqwest::Result<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent("Tempo-Mac/0.1")
        .timeout(Duration::from_secs(30))
        .build()
}

fn collect_headers(headers: &reqwest::header::HeaderMap) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for (k, v) in headers.iter() {
        if let Ok(value) = v.to_str() {
            out.insert(k.as_str().to_lowercase(), value.to_string());
        }
    }
    out
}

#[tauri::command]
async fn probe_payment(req: PaidRequest) -> Result<ProbeResponse, String> {
    let client = build_client().map_err(|e| e.to_string())?;
    let method = req.method.as_deref().unwrap_or("GET").to_uppercase();
    let mut builder = client.request(
        method.parse().map_err(|_| "invalid method".to_string())?,
        &req.url,
    );
    if let Some(headers) = req.headers {
        for (k, v) in headers {
            builder = builder.header(k, v);
        }
    }
    if let Some(body) = req.body {
        builder = builder.header("content-type", "application/json").body(body);
    }
    let res = builder.send().await.map_err(|e| e.to_string())?;
    let status = res.status().as_u16();
    let header_map = collect_headers(res.headers());
    let www_authenticate = header_map.get("www-authenticate").cloned();
    let accept_payment = header_map.get("accept-payment").cloned();
    let body = res.text().await.ok();
    Ok(ProbeResponse {
        status,
        headers: header_map,
        body,
        www_authenticate,
        accept_payment,
    })
}

#[tauri::command]
async fn fetch_services() -> Result<serde_json::Value, String> {
    let client = build_client().map_err(|e| e.to_string())?;
    let res = client
        .get("https://mpp.dev/api/services")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("status {}", res.status()));
    }
    res.json::<serde_json::Value>()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn fetch_tokens(chain_id: u64) -> Result<serde_json::Value, String> {
    let client = build_client().map_err(|e| e.to_string())?;
    let url = format!("https://tokenlist.tempo.xyz/list/{}", chain_id);
    let res = client
        .get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("status {}", res.status()));
    }
    res.json::<serde_json::Value>()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn fetch_openapi(url: String) -> Result<serde_json::Value, String> {
    let client = build_client().map_err(|e| e.to_string())?;
    let res = client
        .get(&url)
        .header("accept", "application/json,application/openapi+json")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !res.status().is_success() {
        return Err(format!("status {}", res.status()));
    }
    res.json::<serde_json::Value>()
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn cli_info() -> cli_login::CliInfo {
    cli_login::info().await
}

#[tauri::command]
async fn cli_login(app: AppHandle, testnet: bool) -> Result<CliResult, String> {
    cli_login::run_login(app, testnet)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn cli_logout() -> Result<CliResult, String> {
    cli_login::run_logout().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn cli_whoami(testnet: bool) -> Result<CliResult, String> {
    cli_login::run_whoami(testnet)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn cli_transfer(
    app: AppHandle,
    amount: String,
    token: String,
    to: String,
    testnet: bool,
) -> Result<CliResult, String> {
    cli_login::run_transfer(app, amount, token, to, testnet)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn cli_request(
    app: AppHandle,
    url: String,
    method: Option<String>,
    body: Option<String>,
    dry_run: bool,
    testnet: bool,
) -> Result<CliResult, String> {
    cli_login::run_request(app, url, method, body, dry_run, testnet)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn keyring_load() -> Result<Vec<keyring::Entry>, String> {
    keyring::load_all().map_err(|e| e.to_string())
}

#[tauri::command]
fn keyring_active(chain_id: u64) -> Result<Option<keyring::Entry>, String> {
    keyring::find_active(chain_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn keyring_remove_chain(chain_id: u64) -> Result<(), String> {
    keyring::remove_for_chain(chain_id).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            probe_payment,
            fetch_openapi,
            fetch_tokens,
            fetch_services,
            cli_info,
            cli_login,
            cli_logout,
            cli_whoami,
            cli_transfer,
            cli_request,
            keyring_load,
            keyring_active,
            keyring_remove_chain,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tempo-mac");
}
