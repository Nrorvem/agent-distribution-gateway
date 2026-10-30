/**
 * Local HTTP Signing Server for Ledger Hardware Wallet Ownership Proofs.
 *
 * Runs a local HTTP server on http://localhost:3333 so Chrome/MetaMask/Rabby can
 * safely inject `window.ethereum` (which Chrome blocks on file:// URLs).
 *
 * Once signed on the Ledger, it automatically receives the signature,
 * validates cryptographic recovery against 0x7C38096030c9CF41Ec551dAcDFC1aBaA60590AbC,
 * saves it to `.env.local`, and exits.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";
import { recoverPersonalSignAddress } from "../src/lib/eip3009-signer.ts";

const PORT = 3333;
const TARGET_ORIGIN =
  process.argv[2] ||
  process.env.TARGET_ORIGIN ||
  process.env.PUBLIC_GATEWAY_ORIGIN ||
  "https://enrichmatch.dev";
const EXPECTED_MERCHANT = "0x7C38096030c9CF41Ec551dAcDFC1aBaA60590AbC";

function saveProofToEnvLocal(proof: string, origin: string) {
  const envPath = path.resolve(process.cwd(), ".env.local");
  let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf-8") : "";

  // Parse existing X402_OWNERSHIP_PROOFS map or initialize with legacy proof
  let proofsMap: Record<string, string> = {
    "agent-distribution-gateway.vercel.app":
      "0x492c2e9d58f6d51d1e4871ad0592b8213e714456ef810d930f14bf4806209ab350606aca8a865ea952ed288286a173d7ff9ba106a052ce579f72c38f537cfc311c",
  };

  const match = content.match(/X402_OWNERSHIP_PROOFS=(.+)/);
  if (match) {
    try {
      proofsMap = { ...proofsMap, ...JSON.parse(match[1].trim()) };
    } catch {
      // ignore
    }
  }

  const hostKey = origin.replace(/^https?:\/\//i, "").split("/")[0].toLowerCase();
  proofsMap[hostKey] = proof;
  const mapJson = JSON.stringify(proofsMap);

  if (content.includes("X402_OWNERSHIP_PROOFS=")) {
    content = content.replace(/X402_OWNERSHIP_PROOFS=.*/g, `X402_OWNERSHIP_PROOFS=${mapJson}`);
  } else {
    content += `\nX402_OWNERSHIP_PROOFS=${mapJson}\n`;
  }

  if (content.includes("PUBLIC_GATEWAY_ORIGIN=")) {
    content = content.replace(/PUBLIC_GATEWAY_ORIGIN=.*/g, `PUBLIC_GATEWAY_ORIGIN=${origin}`);
  } else {
    content += `\nPUBLIC_GATEWAY_ORIGIN=${origin}\n`;
  }

  // Also set X402_OWNERSHIP_PROOF for backward compatibility
  if (content.includes("X402_OWNERSHIP_PROOF=")) {
    content = content.replace(/X402_OWNERSHIP_PROOF=.*/g, `X402_OWNERSHIP_PROOF=${proof}`);
  } else {
    content += `\nX402_OWNERSHIP_PROOF=${proof}\n`;
  }

  fs.writeFileSync(envPath, content, "utf-8");
  console.log(`\n✅ Saved X402_OWNERSHIP_PROOFS, X402_OWNERSHIP_PROOF, and PUBLIC_GATEWAY_ORIGIN to .env.local!`);
}

const HTML_CONTENT = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>x402scan Ledger Ownership Proof Signer</title>
  <style>
    :root {
      --bg: #090a0f;
      --card: #13151f;
      --border: #232738;
      --accent: #3b82f6;
      --accent-hover: #2563eb;
      --text: #f3f4f6;
      --muted: #9ca3af;
      --success: #10b981;
      --danger: #ef4444;
    }
    body {
      margin: 0;
      padding: 40px 20px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      box-sizing: border-box;
    }
    .container {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 16px;
      max-width: 680px;
      width: 100%;
      padding: 32px;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5);
    }
    h1 {
      font-size: 24px;
      margin-top: 0;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .badge {
      background: rgba(59, 130, 246, 0.15);
      color: #60a5fa;
      font-size: 12px;
      padding: 4px 8px;
      border-radius: 6px;
      border: 1px solid rgba(59, 130, 246, 0.3);
      font-weight: 500;
    }
    p {
      color: var(--muted);
      line-height: 1.5;
      margin-bottom: 24px;
    }
    .info-box {
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 16px;
      margin-bottom: 24px;
      font-size: 14px;
    }
    .info-row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 8px;
      word-break: break-all;
    }
    .info-row:last-child {
      margin-bottom: 0;
    }
    .info-label {
      color: var(--muted);
      min-width: 130px;
      font-weight: 500;
    }
    .info-value {
      color: var(--text);
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    button {
      background: var(--accent);
      color: white;
      border: none;
      border-radius: 8px;
      padding: 14px 24px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      width: 100%;
      transition: background 0.15s ease;
    }
    button:hover {
      background: var(--accent-hover);
    }
    button:disabled {
      background: #374151;
      cursor: not-allowed;
    }
    .result {
      margin-top: 24px;
      display: none;
    }
    .result.visible {
      display: block;
    }
    .sig-box {
      background: #0d1117;
      border: 1px solid #30363d;
      border-radius: 8px;
      padding: 14px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 13px;
      word-break: break-all;
      color: #7ee787;
      margin: 12px 0;
      user-select: all;
    }
    .status-msg {
      padding: 12px;
      border-radius: 8px;
      font-size: 14px;
      margin-top: 16px;
      margin-bottom: 16px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .status-msg.success {
      background: rgba(16, 185, 129, 0.1);
      border: 1px solid rgba(16, 185, 129, 0.3);
      color: var(--success);
    }
    .status-msg.error {
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.3);
      color: var(--danger);
    }
    .status-msg.info {
      background: rgba(59, 130, 246, 0.1);
      border: 1px solid rgba(59, 130, 246, 0.3);
      color: #60a5fa;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>
      x402scan Ownership Proof
      <span class="badge">Local HTTP Server</span>
    </h1>
    <p>
      Connect your <strong>Ledger Nano S Plus</strong> (via MetaMask or Rabby) to create the EIP-191 domain ownership proof for <strong>x402scan</strong>.
    </p>

    <div class="info-box">
      <div class="info-row">
        <span class="info-label">Domain Origin:</span>
        <span class="info-value">${TARGET_ORIGIN}</span>
      </div>
      <div class="info-row">
        <span class="info-label">Expected Wallet:</span>
        <span class="info-value">0x7C38096030c9CF41Ec551dAcDFC1aBaA60590AbC</span>
      </div>
      <div class="info-row">
        <span class="info-label">Network / Cost:</span>
        <span class="info-value" style="color: var(--success);">$0.00 (Off-chain signature, zero gas)</span>
      </div>
    </div>

    <button id="signBtn" onclick="handleSign()">
      Connect Ledger &amp; Sign Message
    </button>

    <div id="statusArea"></div>

    <div id="resultArea" class="result">
      <div class="status-msg success">
        ✓ Cryptographic signature successfully verified and saved to .env.local!
      </div>
      <div style="font-size: 13px; color: var(--muted); margin-bottom: 4px;">
        Generated EIP-191 Proof:
      </div>
      <div class="sig-box" id="sigVal"></div>
      <div style="font-size: 14px; color: #9ca3af; margin-top: 16px;">
        You can now return to your terminal.
      </div>
    </div>
  </div>

  <script>
    const ORIGIN = "${TARGET_ORIGIN}";
    const EXPECTED_WALLET = "0x7c38096030c9cf41ec551dacdfc1abaa60590abc";

    let provider = null;

    // Detect provider (window.ethereum or EIP-6963)
    function getProvider() {
      if (provider) return provider;
      if (window.ethereum) return window.ethereum;
      return null;
    }

    window.addEventListener("eip6963:announceProvider", (event) => {
      if (!provider && event.detail && event.detail.provider) {
        provider = event.detail.provider;
        console.log("Found EIP-6963 provider:", event.detail.info.name);
      }
    });
    window.dispatchEvent(new Event("eip6963:requestProvider"));

    async function handleSign() {
      const btn = document.getElementById("signBtn");
      const statusArea = document.getElementById("statusArea");
      const resultArea = document.getElementById("resultArea");
      statusArea.innerHTML = "";
      resultArea.classList.remove("visible");

      const eth = getProvider();
      if (!eth) {
        statusArea.innerHTML = \`
          <div class="status-msg error">
            No web3 wallet detected. Please make sure MetaMask or Rabby extension is enabled in this browser window.
          </div>
        \`;
        return;
      }

      btn.disabled = true;
      btn.innerText = "Connecting wallet...";

      try {
        const accounts = await eth.request({ method: "eth_requestAccounts" });
        if (!accounts || accounts.length === 0) {
          throw new Error("No account selected in wallet.");
        }
        const activeAccount = accounts[0];
        console.log("Connected account:", activeAccount);

        if (activeAccount.toLowerCase() !== EXPECTED_WALLET) {
          statusArea.innerHTML = \`
            <div class="status-msg error">
              Selected account (\${activeAccount}) does not match your Ledger address (0x7C38096030c9CF41Ec551dAcDFC1aBaA60590AbC).<br>
              Please switch to your Ledger account in MetaMask/Rabby and click again.
            </div>
          \`;
          btn.disabled = false;
          btn.innerText = "Connect Ledger & Sign Message";
          return;
        }

        btn.innerText = "Please confirm the message on your Ledger device...";
        statusArea.innerHTML = \`
          <div class="status-msg info">
            Check your physical Ledger screen: verify the message is "\${ORIGIN}" and approve.
          </div>
        \`;

        // Request EIP-191 personal_sign
        const signature = await eth.request({
          method: "personal_sign",
          params: [ORIGIN, activeAccount],
        });

        btn.innerText = "Saving & Verifying...";

        // Send to local backend server
        const resp = await fetch("/api/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ signature }),
        });

        const data = await resp.json();
        if (!resp.ok || !data.success) {
          throw new Error(data.error || "Server verification failed");
        }

        statusArea.innerHTML = "";
        document.getElementById("sigVal").innerText = signature;
        resultArea.classList.add("visible");
        btn.innerText = "Signed & Saved Successfully!";
        btn.disabled = true;
      } catch (err) {
        console.error(err);
        statusArea.innerHTML = \`
          <div class="status-msg error">
            Signing error: \${err.message || String(err)}
          </div>
        \`;
        btn.disabled = false;
        btn.innerText = "Connect Ledger & Sign Message";
      }
    }
  </script>
</body>
</html>
`;

function startServer() {
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(HTML_CONTENT);
      return;
    }

    if (req.method === "POST" && req.url === "/api/save") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        try {
          const { signature } = JSON.parse(body);
          if (!signature || typeof signature !== "string" || !signature.startsWith("0x")) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: "Invalid signature format" }));
            return;
          }

          const recovered = recoverPersonalSignAddress(TARGET_ORIGIN, signature);
          console.log(`\n• Received Signature : ${signature}`);
          console.log(`• Recovered Signer   : ${recovered}`);
          console.log(`• Expected Signer    : ${EXPECTED_MERCHANT}`);

          if (recovered.toLowerCase() !== EXPECTED_MERCHANT.toLowerCase()) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(
              JSON.stringify({
                success: false,
                error: `Recovered address (${recovered}) does not match expected Ledger address (${EXPECTED_MERCHANT})`,
              })
            );
            return;
          }

          saveProofToEnvLocal(signature, TARGET_ORIGIN);

          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true, recovered }));

          console.log(`\n🎉 PROOF CAPTURED & SAVED SUCCESSFULLY!`);
          console.log(`Closing local signing server...`);
          setTimeout(() => {
            server.close();
            process.exit(0);
          }, 1500);
        } catch (err: any) {
          console.error("Verification error:", err);
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      });
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  });

  server.listen(PORT, "127.0.0.1", () => {
    const url = `http://localhost:${PORT}`;
    console.log(`=================================================================`);
    console.log(`Ledger Ownership Proof Signing Server`);
    console.log(`=================================================================`);
    console.log(`• Local Server running at : ${url}`);
    console.log(`• Expected Ledger Address : ${EXPECTED_MERCHANT}`);
    console.log(`• Origin string to sign   : ${TARGET_ORIGIN}`);
    console.log(`\nOpening your browser to ${url} ...`);

    exec(`open ${url}`, (err) => {
      if (err) {
        console.log(`Please open this URL in Chrome: ${url}`);
      }
    });

    console.log(`Waiting for Ledger signature in browser (Press Ctrl+C to stop)...`);
  });
}

startServer();
