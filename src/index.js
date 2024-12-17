const {
  Connection,
  Keypair,
  VersionedTransaction,
  LAMPORTS_PER_SOL,
} = require("@solana/web3.js");
const bs58 = require("bs58");
const fetch = require("node-fetch");
const winston = require("winston");
const dotenv = require("dotenv");

// Load environment variables
dotenv.config();

// Configure logger with simpler format
const logger = winston.createLogger({
  level: "info",
  format: winston.format.printf(({ message }) => message),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({ filename: "swap.log" }),
  ],
});

// Validate required environment variables
const requiredEnvVars = ["PRIVATE_KEY", "RPC_URL", "LST_MINT"];
for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    logger.error(`Missing required environment variable: ${envVar}`);
    process.exit(1);
  }
}

// Set default swap amount if not provided
const SWAP_AMOUNT_SOL = process.env.SWAP_AMOUNT_SOL || "0.01";
logger.info(`Using swap amount: ${SWAP_AMOUNT_SOL} SOL`);

async function checkWalletBalance() {
  try {
    const keypair = Keypair.fromSecretKey(bs58.decode(process.env.PRIVATE_KEY));
    const connection = new Connection(process.env.RPC_URL);

    const balance = await connection.getBalance(keypair.publicKey);
    const balanceInSol = balance / LAMPORTS_PER_SOL;

    // We need the swap amount plus a little extra for transaction fees
    const minimumRequired = Number(SWAP_AMOUNT_SOL) + 0.005;

    logger.info(`Wallet balance: ${balanceInSol.toFixed(4)} SOL`);

    if (balanceInSol < minimumRequired) {
      logger.error(
        `Insufficient balance. Need at least ${minimumRequired.toFixed(
          4
        )} SOL to safely perform swaps.`
      );
      logger.error(
        `Please fund your wallet with ${(
          minimumRequired - balanceInSol
        ).toFixed(4)} more SOL.`
      );
      return false;
    }

    return true;
  } catch (error) {
    logger.error(`Failed to check balance: ${error.message}`);
    return false;
  }
}

async function performSwap(direction = "buy", amount = null) {
  try {
    const keypair = Keypair.fromSecretKey(bs58.decode(process.env.PRIVATE_KEY));
    const connection = new Connection(process.env.RPC_URL);

    logger.info(`\n${direction.toUpperCase()} - Starting swap`);

    // Set input and output mints based on direction
    const inputMint =
      direction === "buy"
        ? "So11111111111111111111111111111111111111112" // SOL
        : process.env.LST_MINT;
    const outputMint =
      direction === "buy"
        ? process.env.LST_MINT
        : "So11111111111111111111111111111111111111112"; // SOL

    // For buy, use configured SOL amount. For sell, use provided LST amount
    const swapAmount =
      direction === "buy"
        ? Math.floor(SWAP_AMOUNT_SOL * LAMPORTS_PER_SOL).toString()
        : amount;

    logger.info(
      `${direction.toUpperCase()} - Amount: ${
        direction === "buy"
          ? SWAP_AMOUNT_SOL + " SOL"
          : Number(swapAmount) / LAMPORTS_PER_SOL + " LST"
      }`
    );

    // Get Jupiter quote
    const quoteResponse = await (
      await fetch(
        "https://quote-api.jup.ag/v6/quote?" +
          new URLSearchParams({
            inputMint,
            outputMint,
            amount: swapAmount,
            slippageBps: "50",
            onlyDirectRoutes: "true",
          })
      )
    ).json();

    if (quoteResponse.error) {
      throw new Error(`Quote error: ${quoteResponse.error}`);
    }

    logger.info(
      `${direction.toUpperCase()} - Expected output: ${
        direction === "buy"
          ? Number(quoteResponse.outAmount) / LAMPORTS_PER_SOL + " LST"
          : Number(quoteResponse.outAmount) / LAMPORTS_PER_SOL + " SOL"
      }`
    );

    // Get swap transaction
    const swapResponse = await (
      await fetch("https://quote-api.jup.ag/v6/swap", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          quoteResponse,
          userPublicKey: keypair.publicKey.toString(),
          dynamicComputeUnitLimit: true,
          dynamicSlippage: {
            maxBps: 300,
          },
          prioritizationFeeLamports: {
            priorityLevelWithMaxLamports: {
              maxLamports: 10000000,
              priorityLevel: "veryHigh",
            },
          },
        }),
      })
    ).json();

    if (!swapResponse.swapTransaction) {
      throw new Error(`No swap transaction in response`);
    }

    // Process transaction
    const swapTransactionBuf = Buffer.from(
      swapResponse.swapTransaction,
      "base64"
    );
    const transaction = VersionedTransaction.deserialize(swapTransactionBuf);

    transaction.sign([keypair]);

    const latestBlockHash = await connection.getLatestBlockhash();
    const rawTransaction = transaction.serialize();

    const txid = await connection.sendRawTransaction(rawTransaction, {
      skipPreflight: true,
      maxRetries: 3,
    });

    logger.info(`${direction.toUpperCase()} - Transaction sent: ${txid}`);

    // Use shorter confirmation timeout
    const confirmation = await connection.confirmTransaction(
      {
        signature: txid,
        blockhash: latestBlockHash.blockhash,
        lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
      },
      "confirmed"
    );

    if (confirmation.value.err) {
      throw new Error(`Transaction failed: ${confirmation.value.err}`);
    }

    logger.info(`${direction.toUpperCase()} - Transaction confirmed ✓`);

    return {
      success: true,
      data: {
        txid,
        inputAmount: swapAmount,
        outputAmount: quoteResponse.outAmount,
        direction,
      },
    };
  } catch (error) {
    logger.error(`${direction.toUpperCase()} - Failed: ${error.message}`);
    return {
      success: false,
      error: error.message,
    };
  }
}

async function main() {
  logger.info("\n=== Starting LST Auto-Volume ===");

  // Check wallet balance first
  const hasEnoughBalance = await checkWalletBalance();
  if (!hasEnoughBalance) {
    return;
  }

  // First buy LST with SOL
  const buyResult = await performSwap("buy");
  if (!buyResult.success) {
    logger.error("Buy failed, skipping sell");
    return;
  }

  // Wait 5 seconds
  await new Promise((resolve) => setTimeout(resolve, 5000));

  // Sell the exact amount of LST we received
  const sellResult = await performSwap("sell", buyResult.data.outputAmount);
  if (!sellResult.success) {
    logger.error("Sell failed");
    return;
  }

  logger.info("\n=== Swap cycle completed successfully ===");
}

// Execute if running directly
if (require.main === module) {
  main().catch((error) => {
    logger.error(`\nFatal error: ${error.message}`);
    process.exit(1);
  });
}
