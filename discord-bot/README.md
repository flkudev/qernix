# Exodus LARP Discord bot

This is a roleplay/economy bot. It uses a local JSON ledger and **does not connect to or transfer real cryptocurrency**.

## Setup

1. Create a Discord application and bot in the Discord Developer Portal. Enable the `applications.commands` scope when inviting it to your server.
2. Install Python 3.10+.
3. In this folder, run:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
py -m pip install -r requirements.txt
# Put DISCORD_TOKEN=your_bot_token in a file named .env in this folder
py bot.py
```

Commands:

- `/send coin amount wallet` — deducts from the simulated Qernix wallet balance. BTC maps to the website's HBTC card. Use `exodus` as the wallet label for the fake Exodus visual, or paste a label/address. This never sends real cryptocurrency.

By default, the bot calls the deployed API at `https://qernix-alpha.vercel.app`. Override it in `.env` with `WALLET_API=https://your-domain.example`. The current deployment still needs its Supabase-backed API before global balance changes will persist. Keep `DISCORD_TOKEN` and `WALLET_API_KEY` private and do not commit them.
