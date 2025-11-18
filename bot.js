// ==========================================
// CLEAR SCREEN
// ==========================================
console.clear();

// ==========================================
// INPUT PRIVATE KEY & MINT COUNT
// ==========================================
const readline = require("readline");

// Hide dotenv logs
const originalDotenvLog = console.log;
console.log = function (...args) {
  if (typeof args[0] === "string" && args[0].includes("[dotenv@")) return;
  originalDotenvLog.apply(console, args);
};

// ==========================================
// SUMMARY LOG (AKURAT)
// ==========================================
const originalSummary = console.log;
let mintSuccess = 0;
let mintFailed = 0;

console.log = function (...args) {
  const txt = typeof args[0] === "string" ? args[0] : "";

  if (txt.startsWith("🟩 Mint")) mintSuccess++;
  if (txt.startsWith("🟥 Mint")) mintFailed++;

  if (txt.includes("📊 SUMMARY")) return;

  if (
    txt.includes("All permits processed") ||
    txt.includes("All mints failed")
  ) {
    originalSummary(`📊 SUMMARY: ${mintSuccess} success | ${mintFailed} failed`);
  }

  originalSummary.apply(console, args);
};

// ==========================================
// SPINNER LOADING
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

// ==========================================
// INPUT PROMPT
// ==========================================
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function ask(q) {
  return new Promise((resolve) => rl.question(q, resolve));
}

(async () => {
  const PK = await ask("Masukkan Private Key: ");
  let MINT = await ask("Masukkan Jumlah Mint (default 10): ");

  if (!PK.startsWith("0x")) {
    console.log("❌ Private key tidak valid!");
    process.exit(1);
  }

  if (!MINT.trim()) MINT = 10;
  else MINT = parseInt(MINT);

  rl.close();

  // 🔥 clear terminal setelah input
  process.stdout.write("\x1Bc");

  process.env.PRIVATE_KEY = PK;
  process.env.MINT_COUNT = MINT.toString();

  startScript();
})();

// ========================================================================
// ============================= MAIN SCRIPT ===============================
// ========================================================================
function startScript() {
  process.env.DOTENV_CONFIG_SILENT = "true";
  require("dotenv").config();

  const axios = require("axios");
  const { ethers } = require("ethers");
  const { randomUUID } = require("crypto");

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
    GAS_LIMIT,
  } = process.env;

  const provider = new ethers.providers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const WALLET = wallet.address;

  const delay = (ms) => new Promise((res) => setTimeout(res, ms));

  // ========================= SHOW BALANCES =========================
  async function showBalances() {
    const bnbBal = await provider.getBalance(WALLET);
    const bnb = Number(ethers.utils.formatEther(bnbBal)).toFixed(6);

    const abi = [
      "function balanceOf(address) view returns (uint256)",
      "function decimals() view returns (uint8)",
    ];
    const usdt = new ethers.Contract(TOKEN, abi, provider);
    const decimals = await usdt.decimals();
    const usdtBal = await usdt.balanceOf(WALLET);
    const usdtFinal = (Number(usdtBal) / 10 ** decimals).toFixed(2);
    
    console.log("========================================================\n");
    console.log("Address :", WALLET);
    console.log("USDT    :", usdtFinal);
    console.log("BNB     :", bnb, "\n");
    console.log("========================================================\n");
  }

  // hanya tampilkan saldo, tanpa teks checking
  (async () => {
    await showBalances();
    continueBoot();
  })();

  // =================================================================
  async function continueBoot() {
    const gasOptions = () => {
      const opt = {};
      if (GAS_PRICE_GWEI)
        opt.gasPrice = ethers.utils.parseUnits(GAS_PRICE_GWEI, "gwei");
      if (GAS_LIMIT) opt.gasLimit = Number(GAS_LIMIT);
      return opt;
    };

    // ============ CAPTCHA SOLVER ============
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
      }
    }

    // ============ AUTH ============
    async function getChallenge(ts) {
      const lid = randomUUID();
      const res = await axios.post(`${API_BASE}/auth/web3/challenge`, {
        walletType: "evm",
        walletAddress: WALLET,
        clientId: CLIENT_ID,
        lid,
        turnstileToken: ts,
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
        turnstileToken: ts,
      });
      return res.data;
    }

    // ============ APPROVE ============
    async function approveUnlimited() {
      const abi = ["function approve(address spender, uint256 value)"];
      const token = new ethers.Contract(TOKEN, abi, wallet);

      console.log("🟦 Approving unlimited USDT for relayer...");
      const tx = await token.approve(
        RELAYER,
        ethers.constants.MaxUint256,
        gasOptions()
      );
      console.log("🔄 Approve TX:", tx.hash);
      await tx.wait();
      console.log("🟩 Unlimited USDT approved!");
    }

    // ============ PERMIT ============
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
        nonce: ethers.utils.hexlify(ethers.utils.randomBytes(32)),
      };

      const domain = {
        name: "B402",
        version: "1",
        chainId: net.chainId,
        verifyingContract: relayer,
      };

      const types = {
        TransferWithAuthorization: [
          { name: "token", type: "address" },
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      };

      const sig = await wallet._signTypedData(domain, types, msg);
      return { authorization: msg, signature: sig };
    }

    // ============ CLAIM ============
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
        } else throw new Error("❌ Cannot fetch payment requirement");
      }

      console.log("🟦 Approving unlimited...");
      await approveUnlimited();

      console.log(`🧱 Building ${MINT_COUNT} permits...`);
      const permits = [];
      for (let i = 0; i < MINT_COUNT; i++) {
        permits.push(await buildPermit(pay.amount, pay.relayerContract));
      }

      console.log("\n🚀 START MINTING…\n");

      const concurrency = 3;
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
                relayerContract: pay.relayerContract,
              },
            },
            { headers: { Authorization: `Bearer ${jwt}` } }
          )
          .then((res) =>
            console.log(`🟩 Mint #${i + 1} SUCCESS → ${res.data.nftTransaction}`)
          )
          .catch((err) =>
            console.log(`🟥 Mint #${i + 1} FAILED →`, err.response?.data || err.message)
          );
      }

      async function pipeline() {
        while (index < permits.length) {
          if (running < concurrency) {
            const cur = index++;
            running++;
            mintPermit(permits[cur], cur).finally(() => running--);
          } else await delay(50);
        }
        while (running > 0) await delay(50);
      }

      await pipeline();

      console.log(
        "\n⚠ All mints failed, script will continue waiting for next distribution."
      );
    }

    // ============ WATCHER ============
    const WATCH_ADDR = [
      "0x39dcdd14a0c40e19cd8c892fd00e9e7963cd49d3".toLowerCase(),
      "0xAfcD15f17D042eE3dB94CdF6530A97bf32A74E02".toLowerCase(),
    ];

    let lastBlock = 0;
    let runningClaim = false;

    async function watchDistribution(jwt) {
      console.log("👁 Watching For Distribution!");

      while (true) {
        try {
          const block = await provider.getBlockNumber();
          if (block > lastBlock) {
            const d = await provider.getBlockWithTransactions(block);

            for (const tx of d.transactions) {
              if (!runningClaim && WATCH_ADDR.includes(tx.from.toLowerCase())) {
                console.log("🔥 DISTRIBUTION DETECTED");

                runningClaim = true;
                await runClaim(jwt);
                runningClaim = false;

                console.log("👁 Watching again...");
              }
            }

            lastBlock = block;
          }
        } catch (err) {
          console.log("⚠ Watcher error:", err.message);
        }

        await delay(500);
      }
    }

    // ============ BOOT LOGIN ============
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

    watchDistribution(jwt);
  }
    }
