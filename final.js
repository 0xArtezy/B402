// ===================================================
//  B402 BOT FINAL (bot4_final.js)
//  - Prefix per wallet (Parallel safe)
//  - Spinner tidak tabrakan
//  - Multi-wallet (Sequential / Parallel)
//  - Mint count multi-wallet
//  - Tidak mengubah fungsi inti
// ===================================================

console.clear();

// Imports
const fs = require("fs");
const { fork } = require("child_process");
const readline = require("readline");
const axios = require("axios");
const { ethers } = require("ethers");
const { randomUUID } = require("crypto");

// Detect child process / non-TTY
const isChildProcess =
  process.env.MULTI_CHILD === "1" ||
  (typeof process.stdin.isTTY === "boolean" && !process.stdin.isTTY);

// Hide dotenv messages
const originalConsoleLog = console.log;
console.log = function (...args) {
  if (typeof args[0] === "string" && args[0].includes("[dotenv@")) return;
  originalConsoleLog.apply(console, args);
};

// Readline (only parent)
let rl = null;
if (!isChildProcess) {
  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function ask(q) {
  return new Promise((resolve) => rl.question(q, (ans) => resolve(ans.trim())));
}

// ============================
//       MAIN ENTRY (PARENT)
// ============================
if (!isChildProcess) {
  (async () => {
    console.log("===== B402 BOT FINAL =====\n");

    const multi = await ask("Enable multi-wallet mode? (y/n): ");

    if (["y", "yes"].includes(multi.toLowerCase())) {
      console.log("\nSelect multi-wallet execution mode:");
      console.log("1 = Sequential (recommended)");
      console.log("2 = Parallel   (advanced)\n");

      let mode = await ask("Enter mode (1/2, default 1): ");
      if (!["1", "2"].includes(mode)) mode = "1";

      let mint = await ask(
        "Masukkan jumlah mint untuk SEMUA wallet (default 10): "
      );
      if (!mint.trim()) mint = "10";

      process.env.MINT_COUNT = mint;

      const filePath = "./wallet.txt";
      if (!fs.existsSync(filePath)) {
        console.log("❌ wallet.txt tidak ditemukan!");
        process.exit(1);
      }

      const wallets = fs
        .readFileSync(filePath, "utf8")
        .split("\n")
        .map((x) => x.trim())
        .filter((x) => x.length > 0);

      console.log(`\n📁 Found ${wallets.length} wallets\n`);

      rl.close();

      if (mode === "2") {
        // ========== PARALLEL MODE ==========
        console.log("⚡ Running parallel mode...\n");

        wallets.forEach((pk, idx) => {
          if (!pk.startsWith("0x")) {
            console.log(`Skipping invalid wallet at line ${idx + 1}`);
            return;
          }

          const child = fork(__filename, [], {
            env: {
              ...process.env,
              PRIVATE_KEY: pk,
              MULTI_CHILD: "1",
              WALLET_INDEX: idx + 1,
              TOTAL_WALLETS: wallets.length,
            },
            stdio: "inherit",
          });

          console.log(
            `▶ Spawned Wallet #${idx + 1} (PID ${child.pid}) for parallel run`
          );
        });

        return;
      }

      // ========== SEQUENTIAL MODE ==========
      for (let i = 0; i < wallets.length; i++) {
        const pk = wallets[i];

        console.log("\n=====================================");
        console.log(`▶ Running wallet ${i + 1}/${wallets.length}`);
        console.log("=====================================\n");

        if (!pk.startsWith("0x")) {
          console.log(`Skipping invalid private key at wallet ${i + 1}`);
          continue;
        }

        process.stdout.write("\x1Bc");

        process.env.PRIVATE_KEY = pk;
        process.env.WALLET_INDEX = i + 1;
        process.env.TOTAL_WALLETS = wallets.length;

        await startScript();
      }

      console.log("\n🎉 Semua wallet SELESAI\n");
      return;
    }

    // ==================
    // Single wallet mode
    // ==================
    const pk = await ask("Masukkan Private Key: ");
    if (!pk.startsWith("0x")) {
      console.log("❌ Private key tidak valid!");
      return;
    }

    let mint = await ask("Masukkan jumlah mint (default 10): ");
    if (!mint.trim()) mint = "10";

    rl.close();

    process.stdout.write("\x1Bc");

    process.env.PRIVATE_KEY = pk;
    process.env.MINT_COUNT = mint;

    await startScript();
  })();
}

// ============================
//         START SCRIPT
// ============================
async function startScript() {
  // ========== PARALLEL-SAFE PREFIX ==========
  const prefix =
    process.env.WALLET_INDEX && process.env.TOTAL_WALLETS
      ? `[WALLET #${process.env.WALLET_INDEX}] `
      : isChildProcess
      ? `[WALLET CHILD] `
      : "";

  // Patch console.log
  const origLog = console.log;
  console.log = function (...args) {
    if (typeof args[0] === "string")
      origLog(prefix + args[0], ...args.slice(1));
    else origLog(prefix, ...args);
  };

  // Spinner patch
  function spinner(text) {
    const frames = ["|", "/", "—", "\\"];
    let i = 0;
    let interval = setInterval(() => {
      process.stdout.write(`\r${prefix}${text} ${frames[i++ % frames.length]}`);
    }, 120);
    return () => {
      clearInterval(interval);
      process.stdout.write(`\r${prefix}${text} DONE\n`);
    };
  }

  function watchSpinner(text) {
    const frames = ["|", "/", "—", "\\"];
    let i = 0;
    let interval = setInterval(() => {
      process.stdout.write(`\r${prefix}${text} ${frames[i++ % frames.length]}`);
    }, 150);
    return () => {
      clearInterval(interval);
      process.stdout.write(`\r${prefix}${text} DONE\n`);
    };
  }

  // Load ENV quietly
  require("dotenv").config({ silent: true });

  const {
    PRIVATE_KEY,
    MINT_COUNT = 10,
    RPC,
    TOKEN,
    API_BASE,
    CLIENT_ID,
    RECIPIENT,
    RELAYER,
    CAPTCHA_KEY,
    TURNSTILE_SITEKEY,
    GAS_PRICE_GWEI,
    GAS_LIMIT,
  } = process.env;

  const provider = new ethers.providers.JsonRpcProvider(RPC);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  // ============================
  //     SHOW BALANCE (PATCHED)
  // ============================
  async function showBalances() {
    try {
      const WALLET = wallet.address;

      const bnb = Number(
        ethers.utils.formatEther(await provider.getBalance(WALLET))
      ).toFixed(6);

      const erc20 = new ethers.Contract(
        TOKEN,
        ["function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)"],
        provider
      );

      const decimals = await erc20.decimals();
      const usdt = (
        Number(await erc20.balanceOf(WALLET)) /
        10 ** decimals
      ).toFixed(2);

      console.log(`Address : ${WALLET}`);
      console.log(`USDT    : ${usdt}`);
      console.log(`BNB     : ${bnb}\n`);
    } catch (e) {
      console.log("⚠ Tidak dapat membaca saldo");
    }
  }

  await showBalances();

  // ========== GAS OPTIONS ==========
  function gasOptions() {
    const o = {};
    if (GAS_PRICE_GWEI)
      o.gasPrice = ethers.utils.parseUnits(GAS_PRICE_GWEI, "gwei");
    if (GAS_LIMIT) o.gasLimit = Number(GAS_LIMIT);
    return o;
  }

  // ============================
  //  CAPTCHA + AUTH (UNCHANGED)
  // ============================
  async function solveTurnstile() {
    const res = await axios.get(
      `http://2captcha.com/in.php?key=${CAPTCHA_KEY}&method=turnstile&sitekey=${TURNSTILE_SITEKEY}&pageurl=https://www.b402.ai/experience-b402&json=1`
    );
    const id = res.data.request;

    while (true) {
      await delay(5000);
      const r = await axios.get(
        `http://2captcha.com/res.php?key=${CAPTCHA_KEY}&action=get&id=${id}&json=1`
      );
      if (r.data.status === 1) return r.data.request;
    }
  }

  async function getChallenge(ts) {
    const lid = randomUUID();
    const res = await axios.post(`${API_BASE}/auth/web3/challenge`, {
      walletAddress: wallet.address,
      walletType: "evm",
      clientId: CLIENT_ID,
      lid,
      turnstileToken: ts,
    });
    return { lid, challenge: res.data };
  }

  async function verifyChallenge(lid, sig, ts) {
    const res = await axios.post(`${API_BASE}/auth/web3/verify`, {
      walletAddress: wallet.address,
      walletType: "evm",
      clientId: CLIENT_ID,
      lid,
      signature: sig,
      turnstileToken: ts,
    });
    return res.data.jwt || res.data.token;
  }

  // ============================  
  //  APPROVE + PERMIT + CLAIM  
  // ============================
  async function approveUnlimited() {
    console.log("🟦 Approving unlimited USDT...");

    const token = new ethers.Contract(
      TOKEN,
      ["function approve(address,uint256)"],
      wallet
    );
    const tx = await token.approve(
      RELAYER,
      ethers.constants.MaxUint256,
      gasOptions()
    );

    console.log("🔄 Approve TX:", tx.hash);
    await tx.wait();
    console.log("🟩 Unlimited USDT approved!");
  }

  async function buildPermit(amount, relayer) {
    const net = await provider.getNetwork();
    const now = Math.floor(Date.now() / 1000);

    const msg = {
      token: TOKEN,
      from: wallet.address,
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

  async function runClaim(jwt) {
    console.log("🔍 Fetching payment requirement...");

    let pay = null;
    try {
      await axios.post(
        `${API_BASE}/faucet/drip`,
        { recipientAddress: RECIPIENT },
        { headers: { Authorization: `Bearer ${jwt}` } }
      );
    } catch (e) {
      if (e.response?.status === 402) {
        pay = e.response.data.paymentRequirements;
      } else {
        throw new Error("Failed to fetch requirement");
      }
    }

    await approveUnlimited();

    console.log(`🧱 Building ${MINT_COUNT} permits...\n`);

    const permits = [];
    for (let i = 0; i < MINT_COUNT; i++) {
      permits.push(await buildPermit(pay.amount, pay.relayerContract));
      console.log(`${i + 1}/${MINT_COUNT}`);
    }

    console.log("\n🚀 START MINTING…\n");

    const concurrency = 3;
    let running = 0;
    let index = 0;

    async function mintOne(p, i) {
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
        .then(() => {
          console.log(`${i + 1}/${MINT_COUNT} - Minting Success!`);
        })
        .catch((err) => {
          const m =
            err.response?.data?.error || err.response?.data || err.message;
          const l = JSON.stringify(m).toLowerCase();
          if (l.includes("already")) {
            console.log(`${i + 1}/${MINT_COUNT} - Already Minted!`);
          } else {
            console.log(`${i + 1}/${MINT_COUNT} - Minting Failed!`);
          }
        });
    }

    async function pipeline() {
      while (index < permits.length) {
        if (running < concurrency) {
          const cur = index++;
          running++;
          mintOne(permits[cur], cur).finally(() => running--);
        } else {
          await delay(50);
        }
      }
      while (running > 0) await delay(50);
    }

    await pipeline();

    console.log(`\n📊 SUMMARY: Finished ${MINT_COUNT} mints\n`);
  }

  // ============================
  //         WATCHER
  // ============================
  const WATCH_ADDR = [
    "0x39dcdd14a0c40e19cd8c892fd00e9e7963cd49d3",
    "0xafcD15f17D042eE3dB94CdF6530A97bf32A74E02",
  ].map((x) => x.toLowerCase());

  let lastBlock = 0;

  async function watchDistribution(jwt) {
    let stop = watchSpinner("👁 Watching for distribution...");

    while (true) {
      try {
        const block = await provider.getBlockNumber();
        if (block > lastBlock) {
          const b = await provider.getBlockWithTransactions(block);

          for (const tx of b.transactions) {
            if (WATCH_ADDR.includes(tx.from.toLowerCase())) {
              stop();
              console.log("\n🔥 DISTRIBUTION DETECTED\n");
              await runClaim(jwt);
              stop = watchSpinner("👁 Watching again...");
            }
          }

          lastBlock = block;
        }
      } catch (e) {
        stop();
        console.log("Watcher error:", e.message);
        stop = watchSpinner("👁 Watching for distribution...");
      }
      await delay(500);
    }
  }

  // ============================
  //       BOOT PROCESS
  // ============================
  const stop1 = spinner("🔵 Solving captcha...");
  const ts = await solveTurnstile();
  stop1();

  const stop2 = spinner("🔵 Getting challenge...");
  const { lid, challenge } = await getChallenge(ts);
  stop2();

  const sig = await wallet.signMessage(challenge.message);
  const jwt = await verifyChallenge(lid, sig, ts);

  console.log("🟢 LOGIN SUCCESS!\n");

  await watchDistribution(jwt);
}

// ============================
//   CHILD: START IMMEDIATELY
// ============================
if (isChildProcess) {
  (async () => {
    await startScript();
  })();
    }
