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

- `/send coin amount wallet` — deducts from the localhost website balance. BTC maps to the website's HBTC card. Use `exodus` as the wallet to update this PC's Exodus visual, or paste its matching BTC/ETH receive address. Increase balances using **U** on the website; no claim command is needed.

Run `npm start` in `wallet-site` before starting this bot. The bot and app must run on the same Windows account and PC. The shared ledger is saved to `%APPDATA%\ExodusCopy\discord-ledger.json`. Try `/send btc 2 exodus`; the website's default 5 becomes 3, Discord replies, and the Exodus credit is scheduled 10 seconds later with the same transaction ID. Restart the bot after code changes. Keep your bot token private and do not commit it.
