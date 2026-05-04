use anyhow::{anyhow, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use toml_edit::{DocumentMut, Item, Value};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entry {
    #[serde(rename = "walletAddress")]
    pub wallet_address: String,
    #[serde(rename = "walletType")]
    pub wallet_type: String,
    #[serde(rename = "chainId")]
    pub chain_id: u64,
    #[serde(rename = "keyType")]
    pub key_type: String,
    #[serde(rename = "keyAddress")]
    pub key_address: String,
    pub key: String,
    #[serde(rename = "keyAuthorization")]
    pub key_authorization: String,
    pub expiry: i64,
    #[serde(default)]
    pub limits: Vec<Limit>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Limit {
    pub token: String,
    pub limit: String,
}

pub fn default_path() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(".tempo").join("wallet").join("keys.toml")
}

fn as_str(item: &Item) -> Option<String> {
    item.as_value().and_then(|v| match v {
        Value::String(s) => Some(s.value().clone()),
        _ => None,
    })
}

fn as_int(item: &Item) -> Option<i64> {
    if let Some(v) = item.as_value() {
        match v {
            Value::Integer(i) => Some(*i.value()),
            Value::String(s) => s.value().parse::<i64>().ok(),
            _ => None,
        }
    } else {
        None
    }
}

pub fn load_all() -> Result<Vec<Entry>> {
    let path = default_path();
    if !path.exists() {
        return Ok(vec![]);
    }
    let text = std::fs::read_to_string(&path)?;
    parse(&text)
}

/// Parses the TOML written by the official Tempo CLI:
/// ```toml
/// [[keys]]
/// wallet_type = "passkey"
/// wallet_address = "0x..."
/// chain_id = 4217
/// key_type = "secp256k1"
/// key_address = "0x..."
/// key = "0x..."
/// key_authorization = "0x..."
/// expiry = 1700000000
///
/// [[keys.limits]]
/// currency = "0x..."
/// limit = "1000000"
/// ```
pub fn parse(text: &str) -> Result<Vec<Entry>> {
    let doc: DocumentMut = text.parse()?;
    let mut entries = Vec::new();
    let Some(item) = doc.as_table().get("keys") else {
        return Ok(entries);
    };
    let Some(arr) = item.as_array_of_tables() else {
        return Ok(entries);
    };

    for tbl in arr {
        let wallet_address = match tbl.get("wallet_address").and_then(as_str) {
            Some(s) => s,
            None => continue,
        };
        let wallet_type = tbl
            .get("wallet_type")
            .and_then(as_str)
            .unwrap_or_else(|| "passkey".to_string());
        let chain_id = match tbl.get("chain_id").and_then(as_int) {
            Some(i) => i as u64,
            None => continue,
        };
        let key_type = match tbl.get("key_type").and_then(as_str) {
            Some(s) => s,
            None => continue,
        };
        let key_address = match tbl.get("key_address").and_then(as_str) {
            Some(s) => s,
            None => continue,
        };
        let key = match tbl.get("key").and_then(as_str) {
            Some(s) => s,
            None => continue,
        };
        let key_authorization = match tbl.get("key_authorization").and_then(as_str) {
            Some(s) => s,
            None => continue,
        };
        let expiry = tbl.get("expiry").and_then(as_int).unwrap_or(0);

        let mut limits = Vec::new();
        if let Some(limits_item) = tbl.get("limits") {
            if let Some(limits_arr) = limits_item.as_array_of_tables() {
                for lim in limits_arr {
                    let token = lim
                        .get("currency")
                        .and_then(as_str)
                        .or_else(|| lim.get("token").and_then(as_str));
                    let limit = lim.get("limit").and_then(as_str);
                    if let (Some(token), Some(limit)) = (token, limit) {
                        limits.push(Limit { token, limit });
                    }
                }
            }
        }

        entries.push(Entry {
            wallet_address,
            wallet_type,
            chain_id,
            key_type,
            key_address,
            key,
            key_authorization,
            expiry,
            limits,
        });
    }

    Ok(entries)
}

pub fn find_active(chain_id: u64) -> Result<Option<Entry>> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let entries = load_all()?;
    for entry in entries.into_iter().rev() {
        if entry.chain_id != chain_id {
            continue;
        }
        if entry.expiry > 0 && entry.expiry < now {
            continue;
        }
        return Ok(Some(entry));
    }
    Ok(None)
}

pub fn remove_for_chain(chain_id: u64) -> Result<()> {
    let path = default_path();
    if !path.exists() {
        return Ok(());
    }
    let text = std::fs::read_to_string(&path)?;
    let mut doc: DocumentMut = text.parse()?;
    let Some(item) = doc.as_table_mut().get_mut("keys") else {
        return Ok(());
    };
    let Some(arr) = item.as_array_of_tables_mut() else {
        return Ok(());
    };
    arr.retain(|tbl| match tbl.get("chain_id").and_then(as_int) {
        Some(i) => (i as u64) != chain_id,
        None => true,
    });
    std::fs::write(&path, doc.to_string()).map_err(|e| anyhow!(e))?;
    Ok(())
}
