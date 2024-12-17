# LST Auto-Volume

Simple script to maintain minimum trading volume for your LST token by automatically swapping small amounts of SOL back and forth.

## Setup (GitHub Actions)

1. Create a new Solana wallet for the script to use:

   - Create a new keypair
   - Fund it with ~$20 worth of SOL for transaction fees and swaps

2. Fork this repo
3. Go to your forked repo's Settings → Secrets and variables → Actions
4. Click "New repository secret"
5. Add these required secrets:

   ```
   Name: PRIVATE_KEY
   Secret: your_wallet_private_key (from step 1)

   Name: RPC_URL
   Secret: your_rpc_url (like from Helius)

   Name: LST_MINT
   Secret: your_lst_token_address
   ```

6. Optionally, you can set a custom swap amount (defaults to 0.01 SOL if not set):

   ```
   Name: SWAP_AMOUNT_SOL
   Secret: 0.01
   ```

7. Enable the GitHub Actions workflow:
   - Go to the Actions tab in your forked repository
   - Click the "I understand my workflows, go ahead and enable them" button
   - The workflow will now run automatically every 2 hours

You can also manually trigger the workflow anytime from the Actions tab.

## Run Locally (Optional)

If you want to test the script locally before setting up GitHub Actions:

1. Clone the repo
2. Copy `.env.example` to `.env` and edit the values:

   ```
   # Required
   PRIVATE_KEY=your_wallet_private_key
   RPC_URL=your_rpc_url (like from Helius)
   LST_MINT=your_lst_token_address

   # Optional (defaults to 0.01)
   SWAP_AMOUNT_SOL=0.01
   ```

3. Install dependencies and run:
   ```bash
   npm install
   node src/index.js
   ```
