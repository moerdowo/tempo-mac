use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Stdio;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CliInfo {
    pub installed: bool,
    pub path: Option<String>,
    pub version: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CliResult {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
    pub code: Option<i32>,
}

fn candidate_paths() -> Vec<PathBuf> {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    vec![
        home.join(".tempo").join("bin").join("tempo"),
        PathBuf::from("/opt/homebrew/bin/tempo"),
        PathBuf::from("/usr/local/bin/tempo"),
    ]
}

pub fn locate() -> Option<PathBuf> {
    if let Ok(p) = which::which("tempo") {
        return Some(p);
    }
    candidate_paths().into_iter().find(|p| p.exists())
}

pub async fn info() -> CliInfo {
    let Some(path) = locate() else {
        return CliInfo {
            installed: false,
            path: None,
            version: None,
        };
    };
    let version = Command::new(&path)
        .arg("--version")
        .output()
        .await
        .ok()
        .and_then(|out| String::from_utf8(out.stdout).ok())
        .map(|s| s.trim().to_string());
    CliInfo {
        installed: true,
        path: Some(path.to_string_lossy().into_owned()),
        version,
    }
}

pub async fn run_streaming(app: AppHandle, args: Vec<String>) -> Result<CliResult> {
    let path = locate().ok_or_else(|| anyhow!("tempo CLI not found"))?;

    let mut cmd = Command::new(&path);
    cmd.args(&args);
    cmd.stdout(Stdio::piped());
    cmd.stderr(Stdio::piped());
    cmd.kill_on_drop(true);

    let mut child = cmd
        .spawn()
        .map_err(|e| anyhow!("failed to spawn tempo: {e}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| anyhow!("missing stdout"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| anyhow!("missing stderr"))?;

    let app_out = app.clone();
    let stdout_task = tokio::spawn(async move {
        let mut buf = String::new();
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = app_out.emit("cli:log", &line);
            buf.push_str(&line);
            buf.push('\n');
        }
        buf
    });

    let app_err = app.clone();
    let stderr_task = tokio::spawn(async move {
        let mut buf = String::new();
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = app_err.emit("cli:log", &line);
            buf.push_str(&line);
            buf.push('\n');
        }
        buf
    });

    let status = child.wait().await?;
    let stdout = stdout_task.await.unwrap_or_default();
    let stderr = stderr_task.await.unwrap_or_default();

    Ok(CliResult {
        success: status.success(),
        stdout,
        stderr,
        code: status.code(),
    })
}

pub async fn run_capture(args: Vec<String>) -> Result<CliResult> {
    let path = locate().ok_or_else(|| anyhow!("tempo CLI not found"))?;
    let output = Command::new(&path)
        .args(&args)
        .output()
        .await
        .map_err(|e| anyhow!("failed to run tempo: {e}"))?;
    Ok(CliResult {
        success: output.status.success(),
        stdout: String::from_utf8_lossy(&output.stdout).to_string(),
        stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        code: output.status.code(),
    })
}

pub async fn run_login(app: AppHandle, testnet: bool) -> Result<CliResult> {
    let mut args = vec!["wallet".to_string(), "login".to_string()];
    if testnet {
        args.push("--testnet".to_string());
    }
    let res = run_streaming(app, args).await?;
    if !res.success {
        return Err(anyhow!(
            "tempo wallet login failed: {}",
            res.stderr.trim()
        ));
    }
    Ok(res)
}

pub async fn run_logout() -> Result<CliResult> {
    run_capture(vec![
        "wallet".to_string(),
        "logout".to_string(),
        "--yes".to_string(),
    ])
    .await
}

pub async fn run_whoami(testnet: bool) -> Result<CliResult> {
    let mut args = vec!["wallet".to_string(), "whoami".to_string()];
    if testnet {
        args.push("--testnet".to_string());
    }
    run_capture(args).await
}

pub async fn run_transfer(
    app: AppHandle,
    amount: String,
    token: String,
    to: String,
    testnet: bool,
) -> Result<CliResult> {
    let mut args = vec!["wallet".to_string(), "transfer".to_string()];
    if testnet {
        args.push("--testnet".to_string());
    }
    args.push(amount);
    args.push(token);
    args.push(to);
    args.push("--yes".to_string());
    run_streaming(app, args).await
}

pub async fn run_request(
    app: AppHandle,
    url: String,
    method: Option<String>,
    body: Option<String>,
    dry_run: bool,
    testnet: bool,
) -> Result<CliResult> {
    let mut args = vec!["request".to_string()];
    if testnet {
        args.push("--testnet".to_string());
    }
    if let Some(m) = method {
        if m.to_uppercase() != "GET" {
            args.push("-X".to_string());
            args.push(m.to_uppercase());
        }
    }
    if let Some(b) = body {
        if !b.is_empty() {
            args.push("--json".to_string());
            args.push(b);
        }
    }
    if dry_run {
        args.push("--dry-run".to_string());
    }
    args.push(url);
    run_streaming(app, args).await
}
