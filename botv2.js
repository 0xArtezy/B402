// bot.js - FINAL (gabungan fitur)
// ==========================================
// CLEAR SCREEN
// ==========================================
console.clear();

// ==========================================
// IMPORTS & SETUP
// ==========================================
const fs = require("fs");
const { fork } = require("child_process");
const readline = require("readline");
const axios = require("axios");
const { ethers } = require("ethers");
const { randomUUID } = require("crypto");

// ==========================================
// GLOBAL LOG WRAPPERS & SUMMARY COUNTERS
// - We only change how logs are shown, not core functions
// ==========================================
const originalConsoleLog = console.log;

// Hide dotenv noisy message if present
console.log = function (...args) {
  if (typeof args[0] === "string" && args[0].includes("[dotenv@")) return;
  originalConsoleLog.apply(console, args);
};

// Summary counters based on mint output lines (accurate)
let globalMintSuccess = 0;
let globalMintFailed = 0;

// We'll wrap console.log again later in startScript for per-run counters.
// ==========================================
// SPINNER HELPERS
// ==========================================
function spinner(text) {
  const frames = ["|", "/", "—", "\\"];
  let i = 0;
  const interval = setInterval(() => {
    process.stdout.write(`\r${text} ${frames[i++ % frames.length]}`);
  }, 120);
  return () => {
    clearInterval(interval);
    process.stdout.write(`\r${text} DONE\n`);
  };
}

function watchSpinner(text) {
  const frames = ["|", "/", "—", "\\"];
  let i = 0;
  const interval = setInterval(() => {
    process.stdout.write(`\r${text} ${frames[i++ % frames.length]}`);
  }, 150);
  return () => {
    clearInterval(interval);
    process.stdout.write(`\r${text} DONE\n`);
  };
}

// ==========================================
// READLINE PROMPT
// ==========================================
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question) {
  return new Promise((resolve) => rl.question(question, (ans) => resolve(ans.trim())));
}

// ==========================================
// ENTRY: Mode selection & multi-wallet prompt
// ==========================================
(async function mainEntry() {
  // Mode selection: multi-wallet prompt first
  console.clear();
  console.log("===== B402 BOT =====");
  let multiAns = await ask("Enable multi-wallet mode? (y/n): ");

  if (["y", "yes"].includes(multiAns.toLowerCase())) {
    // ask sequential vs parallel
    console.log("\nSelect multi-wallet execution mode:");
    console.log("1 = Sequential (run one wallet at a time) - recommended");
    console.log("2 = Parallel   (run all wallets in parallel) - advanced\n");

    let mwMode = await ask("Enter mode (1/2, default 1): ");
    if (!["1", "2"].includes(mwMode)) mwMode = "1";

    rl.close();

    // Read wallet.txt
    const filePath = "./wallet.txt";
    if (!fs.existsSync(filePath)) {
      console.log("❌ wallet.txt not found. Create wallet.txt with one private key per line.");
      process.exit(1);
    }

    const wallets = fs.readFileSync(filePath, "utf8")
      .split("\n")
      .map(l => l.trim())
      .filter(l => l.length > 0);

    if (wallets.length === 0) {
      console.log("❌ No wallets found in wallet.txt.");
      process.exit(1);
    }

    console.log(`\n📁 Found ${wallets.length} wallet(s) in wallet.txt\n`);

    if (mwMode === "2") {
      // Parallel mode: fork this script for each wallet (child processes)
      console.log("⚡ Running in parallel mode...");
      for (let i = 0; i < wallets.length; i++) {
        const pk = wallets[i];
        if (!pk.startsWith("0x")) {
          console.log(`Wallet ${i + 1} invalid, skipping.`);
          continue;
        }
        // spawn child process with PRIVATE_KEY env set
        const child = fork(__filename, [], {
          env: { ...process.env, PRIVATE_KEY: pk, MULTI_CHILD: "1" },
          stdio: "inherit"
        });
        console.log(`▶ Spawned wallet ${i + 1} (PID ${child.pid})`);
      }
      // parent exits
      process.exit(0);
    } else {
      // Sequential mode: run startScript for each wallet one by one
      for (let i = 0; i < wallets.length; i++) {
        const pk = wallets[i];
        console.log("\n=======================================");
        console.log(`▶ Processing wallet ${i + 1}/${wallets.length}`);
        console.log("=======================================\n");

        if (!pk.startsWith("0x")) {
          console.log("❌ Invalid private key, skipping.");
          continue;
        }

        // clear screen so private keys not visible
        process.stdout.write("\x1Bc");

        // set env for this run
        process.env.PRIVATE_KEY = pk;
        // Keep MINT_COUNT from env if present else default to 10
        process.env.MINT_COUNT = process.env.MINT_COUNT || "10";

        try {
          await startScript({ isMultiRun: true, walletIndex: i, totalWallets: wallets.length });
          console.log(`\n✔ Wallet ${i + 1} finished.\n`);
        } catch (e) {
          console.log(`⚠ Wallet ${i + 1} crashed: ${e.message || e}`);
        }
      }

      console.log("\n🎉 All wallets processed (sequential).");
      process.exit(0);
    }
  } else {
    // Single wallet mode: prompt for private key and mint count
    let pk = await ask("Masukkan Private Key: ");
    let mint = await ask("Masukkan Jumlah Mint (default 10): ");
    rl.close();

    if (!pk.startsWith("0x")) {
      console.log("❌ Private key tidak valid!");
      process.exit(1);
    }
    if (!mint.trim()) mint = "10";

    // clear terminal to hide private key
    process.stdout.write("\x1Bc");

    process.env.PRIVATE_KEY = pk;
    process.env.MINT_COUNT = mint.toString();

    await startScript({ isMultiRun: false });
    // keep process alive (startScript runs watcher)
  }
})();

// ==========================================
// startScript wrapper: runs the bot for current env.PRIVATE_KEY
// - Accepts options object so we can call sequentially
// ==========================================
async function startScript(opts = {}) {
  // local counters (per run)
  let mintSuccess = 0;
  let mintFailed = 0;

  // Minimal console wrapper for per-run summary counting (does not alter core functions)
  const origLog = console.log;
  console.log = function (...args) {
    const txt = typeof args[0] === "string" ? args[0] : "";

    // Count only our formatted mint lines
    if (txt.includes(" - Minting Success")) mintSuccess++;
    if (txt.includes(" - Minting Failed")) mintFailed++;

    // Do not display any original full array summary if exists
    if (txt.includes("📊 SUMMARY:")) return;

    origLog.apply(console, args);
  };

  // Load dotenv config silently
  process.env.DOTENV_CONFIG_SILENT = "true";
  require("dotenv").config();

  // Extract env
  const {
    PRIVATE_KEY,
    CAPTCHA_KEY,
    TURNSTILE_SITEKEY,
    RPC,
    API_BASE,
    CLIENT_ID,
    RECIPIENT,
    RELAYER,
    TOKEN,
    MINT_COUNT = 10,
    GAS_PRICE_GWEI,
    GAS_LIMIT
  } = process.env;

  // PROVIDER + WALLET
  const provider = new ethers.providers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const WALLET = wallet.address;

  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  // SHOW BALANCES (without the "Checking wallet balances..." text)
  async function showBalances() {
    try {
      const bnbBal = await provider.getBalance(WALLET);
      const bnb = Number(ethers.utils.formatEther(bnbBal)).toFixed(6);

      const erc20Abi = [
        "function balanceOf(address) view returns (uint256)",
        "function decimals() view returns (uint8)"
      ];
      const token = new ethers.Contract(TOKEN, erc20Abi, provider);
      const decimals = await token.decimals();
      const usdtBal = await token.balanceOf(WALLET);
      const usdtFormatted = (Number(usdtBal) / 10 ** decimals).toFixed(2);

      console.log("Address :", WALLET);
      console.log("USDT    :", usdtFormatted);
      console.log("BNB     :", bnb, "\n");
    } catch (e) {
      console.log("⚠ Gagal membaca saldo:", e.message || e);
    }
  }

  // ---------- Begin main flow ----------
  await showBalances();

  // Define helper gasOptions
  function gasOptions() {
    const opts = {};
    if (GAS_PRICE_GWEI) opts.gasPrice = ethers.utils.parseUnits(GAS_PRICE_GWEI, "gwei");
    if (GAS_LIMIT) opts.gasLimit = Number(GAS_LIMIT);
    return opts;
  }

  // CAPTCHA SOLVER (unchanged semantics)
  async function solveTurnstile() {
    const job = await axios.get(
      `http://2captcha.com/in.php?key=${CAPTCHA_KEY}&method=turnstile&sitekey=${TURNSTILE_SITEKEY}&pageurl=https://www.b402.ai/experience-b402&json=1`
    );
    const id = job.data.request;

    while (true) {
      await delay(5000);
      const r = await axios.get(
        `http://2captcha.com/res.php?key=${CAPTCHA_KEY}&action=get&id=${id}&json=1`
      );
      if (r.data.status === 1) return r.data.request;
      // spinner dot handled at caller
    }
  }

  // AUTH helpers (unchanged semantics)
  async function getChallenge(ts) {
    const lid = randomUUID();
    const res = await axios.post(`${API_BASE}/auth/web3/challenge`, {
      walletType: "evm",
      walletAddress: WALLET,
      clientId: CLIENT_ID,
      lid,
      turnstileToken: ts
    });
    return { lid, challenge: res.data };
  }

  async function verifyChallenge(lid, sig, ts) {
    const res = await axios.post(`${API_BASE}/auth/web3/verify`, {
      walletType: "evm",
      walletAddress: WALLET,
      clientId: CLIENT_ID,
      lid,
      signature: sig,
      turnstileToken: ts
    });
    return res.data;
  }

  // APPROVE (unchanged)
  async function approveUnlimited() {
    const abi = ["function approve(address spender, uint256 value)"];
    const token = new ethers.Contract(TOKEN, abi, wallet);
    const Max = ethers.constants.MaxUint256;
    console.log("🟦 Approving unlimited USDT for relayer...");
    const tx = await token.approve(RELAYER, Max, gasOptions());
    console.log("🔄 Approve TX:", tx.hash);
    await tx.wait();
    console.log("🟩 Unlimited USDT approved!");
  }

  // PERMIT builder (unchanged semantics)
  async function buildPermit(amount, relayer) {
    const net = await provider.getNetwork();
    const now = Math.floor(Date.now() / 1000);

    const msg = {
      token: TOKEN,
      from: WALLET,
      to: RECIPIENT,
      value: amount,
      validAfter: now - 20,
      validBefore: now + 1800,
      nonce: ethers.utils.hexlify(ethers.utils.randomBytes(32))
    };

    const domain = {
      name: "B402",
      version: "1",
      chainId: net.chainId,
      verifyingContract: relayer
    };

    const types = {
      TransferWithAuthorization: [
        { name: "token", type: "address" },
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" }
      ]
    };

    const sig = await wallet._signTypedData(domain, types, msg);
    return { authorization: msg, signature: sig };
  }

  // RUN CLAIM (unchanged semantics)
  async function runClaim(jwt) {
    console.log("🔍 Fetching payment requirement...");

    let pay;
    try {
      await axios.post(
        `${API_BASE}/faucet/drip`,
        { recipientAddress: RECIPIENT },
        { headers: { Authorization: `Bearer ${jwt}` } }
      );
    } catch (err) {
      if (err.response?.status === 402) {
        pay = err.response.data.paymentRequirements;
        console.log("💰 Payment requirement:", pay.amount);
      } else {
        throw new Error("❌ Cannot fetch payment requirement");
      }
    }

    console.log("🟦 Approving unlimited...");
    await approveUnlimited();

    console.log(`🧱 Building ${MINT_COUNT} permits...\n`);
    const permits = [];
    for (let i = 0; i < MINT_COUNT; i++) {
      permits.push(await buildPermit(pay.amount, pay.relayerContract));
      // progress counter
      console.log(`${i + 1}/${MINT_COUNT}`);
    }

    console.log("\n🚀 START MINTING…\n");

    const concurrencyLimit = 3;
    let running = 0;
    let index = 0;

    function mintPermit(p, i) {
      return axios
        .post(
          `${API_BASE}/faucet/drip`,
          {
            recipientAddress: RECIPIENT,
            paymentPayload: { token: TOKEN, payload: p },
            paymentRequirements: {
              network: pay.network,
              relayerContract: pay.relayerContract
            }
          },
          { headers: { Authorization: `Bearer ${jwt}` } }
        )
        .then((res) => {
          console.log(`${i + 1}/${MINT_COUNT} - Minting Success!`);
          // mark per-run counters
        })
        .catch((err) => {
          const msg = err.response?.data?.error || err.response?.data || err.message;
          const lower = JSON.stringify(msg).toLowerCase();

          if (lower.includes("already")) {
            console.log(`${i + 1}/${MINT_COUNT} - Already Minted!`);
            // treat as success logically
          } else {
            console.log(`${i + 1}/${MINT_COUNT} - Minting Failed!`);
          }
        });
    }

    async function pipeline() {
      while (index < permits.length) {
        if (running < concurrencyLimit) {
          const cur = index++;
          running++;
          mintPermit(permits[cur], cur).finally(() => running--);
        } else {
          await delay(50);
        }
      }

      while (running > 0) await delay(50);
    }

    await pipeline();

    // Show per-run summary line (using the counters we tracked via console wrapper)
    console.log(`\n📊 SUMMARY: ${mintSuccess} success | ${mintFailed} failed\n`);
  }

  // WATCHER (spinner integrated) - unchanged logic
  const WATCH_ADDR = [
    "0x39dcdd14a0c40e19cd8c892fd00e9e7963cd49d3".toLowerCase(),
    "0xafcD15f17D042eE3dB94CdF6530A97bf32A74E02".toLowerCase()
  ];

  let lastBlock = 0;
  let runningClaim = false;

  async function watchDistribution(jwt) {
    let stopWatch = watchSpinner("👁 Watching for distribution...");
    while (true) {
      try {
        const block = await provider.getBlockNumber();
        if (block > lastBlock) {
          const d = await provider.getBlockWithTransactions(block);

          for (const tx of d.transactions) {
            if (!runningClaim && WATCH_ADDR.includes(tx.from.toLowerCase())) {
              // stop spinner, print detection, run claim, then restart spinner for "watching again"
              stopWatch();
              console.log("\n🔥 DISTRIBUTION DETECTED\n");

              runningClaim = true;
              await runClaim(jwt);
              runningClaim = false;

              stopWatch = watchSpinner("👁 Watching again...");
            }
          }
          lastBlock = block;
        }
      } catch (err) {
        stopWatch();
        console.log("⚠ Watcher error:", err.message || err);
        stopWatch = watchSpinner("👁 Watching for distribution...");
      }

      await delay(500);
    }
  }

  // BOOT: captcha spinner & challenge spinner, then login & watch
  const stop1 = spinner("🔵 Solving captcha...");
  const ts = await solveTurnstile();
  stop1();

  const stop2 = spinner("🔵 Getting challenge...");
  const { lid, challenge } = await getChallenge(ts);
  stop2();

  const signed = await wallet.signMessage(challenge.message);
  const verify = await verifyChallenge(lid, signed, ts);

  const jwt = verify.jwt || verify.token;

  console.log("🟢 LOGIN SUCCESS!\n");

  // start watching (this function keeps running)
  await watchDistribution(jwt);

  // when startScript is used in sequential multi-wallet mode, it will return only if watchDistribution exits (which normally doesn't)
  // If this was run as a child process (parallel mode via fork), the child will run independently.
}

// End of file
