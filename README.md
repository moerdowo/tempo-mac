# Tempo Mac

A native macOS app for the [Tempo](https://docs.tempo.xyz) wallet. Connect via the
official Tempo Wallet (passkey-backed), check stablecoin balances, send transfers,
discover Machine Payments Protocol services, and pay for HTTP services directly
from your desktop.

Built with **Tauri 2** (Rust + WKWebView), **React 19**, **viem**, and the
[`accounts`](https://www.npmjs.com/package/accounts) and
[`mppx`](https://www.npmjs.com/package/mppx) SDKs.

## Features

- **Sign in like the CLI** — `Connect` runs `tempo wallet login`, your default browser handles the passkey, the app reads `~/.tempo/wallet/keys.toml` and uses the delegated access key for everything. No fragile WebAuthn-in-WKWebView dance.
- **Balance** — per-stablecoin balances via `wallet_getBalances` over the public RPC.
- **Send** — wraps `tempo wallet transfer <amount> <token> <to>`.
- **Services** — paid HTTP via `tempo request`, plus a native dry-run probe that captures 402 challenges without paying.
- **Discover** — loads a service's OpenAPI spec and reads `x-payment-info` annotations to show pricing per endpoint.
- **History** — recent token transfers via `eth_getLogs`.
- **Network switch** — Tempo mainnet (default) / Moderato testnet.

## Run in dev

```bash
npm install
npm run tauri dev
```

The first Rust compile takes a minute or two; subsequent runs are fast.

## Build a `.app`

```bash
npm run tauri build
```

The bundled app lands in `src-tauri/target/release/bundle/macos/Tempo.app` and a `.dmg`
in the `dmg` subdirectory next to it.

## Prerequisite

Install the official Tempo CLI:

```bash
curl -fsSL https://tempo.xyz/install | bash
```

The Mac app detects the CLI on startup and prompts to install it if missing.

## Architecture

```
src/             React + TypeScript UI
  lib/wallet.ts  Public RPC client + Tauri command bindings
  lib/mpp.ts     CLI request wrappers + native 402 probe + OpenAPI discovery
  lib/history.ts Transfer log queries via viem public client
  components/    Connect / Wallet / Send / Services / History
src-tauri/       Rust shell
  src/lib.rs       Tauri command handlers
  src/cli_login.rs Spawns `tempo` and streams stdout/stderr to the UI
  src/keyring.rs   Reads `~/.tempo/wallet/keys.toml` (the official CLI's keystore)
  tauri.conf.json
```

The desktop app never sees passkey material. The flow:

1. **Connect** spawns `tempo wallet login`, which opens your default browser.
2. You approve in the browser with your passkey (where WebAuthn just works).
3. The CLI writes a delegated, scoped, expiring secp256k1 access key into
   `~/.tempo/wallet/keys.toml`.
4. The app reads that file to know who you are; for any signing operation it
   shells back to `tempo wallet transfer` / `tempo request`, which use the same
   access key the CLI manages.

This is exactly how an agent uses Tempo from the terminal — but with a UI on top.

## Notes

- The native Rust side handles the `probe_payment` command (a non-paying HEAD-style
  request that captures the `WWW-Authenticate: Payment` 402 challenge) so the UI can
  show payment requirements before authorising a charge.
- The "Send & pay" flow uses `mppx`'s polyfilled `fetch`, which transparently handles
  the 402 → sign → retry cycle through the connected Tempo Wallet account.
- Service discovery is OpenAPI-based: the app fetches `/openapi.json` (or
  `/.well-known/openapi.json`) and parses the `x-service-info` and `x-payment-info`
  extensions defined by MPP.

## Networks

| Network | Chain ID | RPC |
|---------|----------|-----|
| Mainnet | 4217 | https://rpc.tempo.xyz |
| Moderato (testnet) | 42431 | https://rpc.moderato.tempo.xyz |

Switch via the link in the sidebar footer.
