# AI Crypto Auditor GitHub Action 🛡️

Automatically audits smart contracts (Solidity, Rust, Move, Go) and crypto trading scripts for security vulnerabilities, logic issues, and gas optimizations using Gemini AI on every Pull Request.

## How It Works
When a Pull Request is opened or updated, this Action scans the changed files and runs a deep security audit using the Gemini LLM. It then posts detailed reviews with severity ratings directly as comments on the Pull Request.

## Niche Opportunities
* **Smart Contract Security**: Scans Solidity (\`.sol\`), Rust/Anchor (\`.rs\`), and Move (\`.move\`) for reentrancy, access control flaws, and math bugs.
* **Trading Scripts Audit**: Evaluates trading bots (\`.py\`, \`.js\`, \`.ts\`) for risk management bugs, calculation errors, or API misuse.
* **Gas & Performance Optimization**: Recommends structural changes to optimize gas consumption on-chain.

## Setup Instructions

### 1. Add API Key to Secrets
Obtain a Gemini API key and add it to your GitHub repository secrets as \`GEMINI_API_KEY\`.

### 2. Configure Workflow
Create a workflow file in your repository at \`.github/workflows/crypto-audit.yml\`:

\`\`\`yaml
name: AI Crypto Audit
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  audit:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      issues: write
    steps:
      - name: Checkout Code
        uses: actions/checkout@v4

      - name: Run AI Audit
        uses: AKzar1el/ai-crypto-auditor@main
        with:
          gemini-api-key: \${{ secrets.GEMINI_API_KEY }}
\`\`\`

## Contributing
Pull requests are welcome! Let's make Web3 safer, one commit at a time.
