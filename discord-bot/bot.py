"""Exodus LARP economy bot — simulated balances only.

This bot never connects to Bitcoin/Ethereum networks and never sends real funds.
"""
import json
import asyncio
import atexit
import msvcrt
import os
import secrets
import time
from decimal import Decimal, InvalidOperation, ROUND_DOWN
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

import discord
from discord import app_commands
from discord.ext import commands, tasks
from dotenv import load_dotenv

load_dotenv(Path(__file__).with_name(".env"))
DATA_FILE = Path(os.getenv("LEDGER_FILE", Path(os.getenv("APPDATA", ".")) / "ExodusCopy" / "discord-ledger.json"))
PREF_FILE = Path(os.getenv("APPDATA", ".")) / "ExodusCopy" / "pref.json"
COINS = {"btc": "BTC", "eth": "ETH"}
WALLET_API = os.getenv("WALLET_API", "https://qernix-alpha.vercel.app").rstrip("/")
PANIC_CHANNEL_ID = 1563981574796476516
BOT_LOCK_FILE = Path(os.getenv("APPDATA", ".")) / "ExodusCopy" / "discord-bot.lock"


def acquire_instance_lock():
    BOT_LOCK_FILE.parent.mkdir(parents=True, exist_ok=True)
    handle = BOT_LOCK_FILE.open("a+")
    handle.seek(0)
    try:
        msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
    except OSError:
        handle.close()
        raise SystemExit("Another Discord bot instance is already running.")
    handle.seek(0)
    handle.write(str(os.getpid()))
    handle.flush()
    atexit.register(handle.close)
    return handle


def wallet_request(endpoint, payload=None):
    request = Request(WALLET_API + endpoint,
                      data=json.dumps(payload).encode() if payload is not None else None,
                      headers={"Content-Type": "application/json"},
                      method="POST" if payload is not None else "GET")
    try:
        with urlopen(request, timeout=2) as response:
            return json.load(response)
    except HTTPError as error:
        raise ValueError(json.load(error).get("error", "Wallet request failed.")) from error
    except (URLError, TimeoutError) as error:
        raise ValueError("The Qernix wallet API is unreachable. Check WALLET_API and that the deployed site is online.") from error


def load_ledger():
    if not DATA_FILE.exists():
        return {}
    try:
        return json.loads(DATA_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}


ledger = load_ledger()
ledger.setdefault("walletBalances", {})
ledger.setdefault("transfers", [])


def save_ledger():
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    temp = DATA_FILE.with_suffix(".tmp")
    temp.write_text(json.dumps(ledger, indent=2), encoding="utf-8")
    temp.replace(DATA_FILE)


def resolve_wallet(wallet, symbol):
    wallet = wallet.strip()
    if wallet.casefold() != "exodus":
        return wallet
    try:
        preferences = json.loads(PREF_FILE.read_text(encoding="utf-8"))
        for coin in preferences["Coins"]:
            if coin["Symbol"] == symbol:
                return coin["Address"]
    except (OSError, ValueError, KeyError, TypeError):
        pass
    raise ValueError("Open this project's Exodus app once to create its wallet address, then try again.")


def money(value):
    amount = Decimal(value)
    if not amount.is_finite():
        raise ValueError("Amount must be finite")
    return amount.quantize(Decimal("0.00000001"), rounding=ROUND_DOWN)


class ExodusBot(commands.Bot):
    def __init__(self):
        super().__init__(command_prefix="!", intents=discord.Intents.default())

    async def setup_hook(self):
        await self.tree.sync()
        self.panic_alerts.start()

    async def close(self):
        self.panic_alerts.cancel()
        await super().close()

    @tasks.loop(seconds=3)
    async def panic_alerts(self):
        try:
            status = await asyncio.to_thread(wallet_request, "/api/balances")
            event = status.get("panicEvent")
            if not event or event["id"] == ledger.get("lastPanicAlert"):
                return
            channel = self.get_channel(PANIC_CHANNEL_ID) or await self.fetch_channel(PANIC_CHANNEL_ID)
            await channel.send(
                "🚨 **QERNIX — PANIC ENABLED**\n"
                "All new transactions have been disabled.\n"
                "Simulated backup-wallet transfer completed: all local crypto balances cleared to zero.\n"
                "Session terminated. Restart the Node server to restore access.\n"
                f"Event: `{event['id']}` • {event['at']}",
                allowed_mentions=discord.AllowedMentions.none(),
            )
            ledger["lastPanicAlert"] = event["id"]
            save_ledger()
        except (ValueError, OSError, discord.HTTPException) as error:
            print(f"Panic alert pending: {error}")

    @panic_alerts.before_loop
    async def before_panic_alerts(self):
        await self.wait_until_ready()


bot = ExodusBot()


@bot.event
async def on_ready():
    print(f"logged in as {bot.user}")


@bot.tree.command(name="send", description="transfer crypto from qernix's raised funds")
@app_commands.describe(coin="btc or eth", amount="amount to send", wallet="use exodus for flku's wallet, exodus2 for x's wallet or paste a receive address")
@app_commands.choices(coin=[app_commands.Choice(name="BTC", value="btc"), app_commands.Choice(name="ETH", value="eth")])
async def send(interaction: discord.Interaction, coin: app_commands.Choice[str], amount: str, wallet: str):
    try:
        status = await asyncio.to_thread(wallet_request, "/api/balances")
    except ValueError as error:
        await interaction.response.send_message(f"❌ {error}", ephemeral=True)
        return
    session = status.get("session", {})
    if not session.get("loggedIn", True):
        await interaction.response.send_message("❌ Logged out. All actions are disabled until the Node server restarts.", ephemeral=True)
        return
    if session.get("paymentsLocked", False):
        await interaction.response.send_message("❌ Lockdown active. All payments are locked until the Node server restarts.", ephemeral=True)
        return
    symbol = COINS[coin.value]
    try:
        value = money(amount)
    except (InvalidOperation, ValueError):
        await interaction.response.send_message("❌ enter a valid amount nigga", ephemeral=True)
        return
    if value <= 0:
        await interaction.response.send_message("❌ amount must be greater than zero", ephemeral=True)
        return
    try:
        wallet = resolve_wallet(wallet, symbol)
    except ValueError as error:
        await interaction.response.send_message(f"❌ {error}", ephemeral=True)
        return
    if len(wallet) < 3 or len(wallet) > 120:
        await interaction.response.send_message("❌ Wallet label/address must be 3–120 characters.", ephemeral=True)
        return

    txid = secrets.token_hex(32)
    await interaction.response.defer(thinking=True)
    try:
        await asyncio.to_thread(wallet_request, "/api/reserve", {"id": txid, "coin": coin.value, "amount": str(value)})
    except ValueError as error:
        await interaction.edit_original_response(content=f"❌ {error}")
        return
    try:
        await interaction.edit_original_response(content=
        f"✅ **transfer queued**\n`{value} {symbol}` → `{wallet}`\n"
        f"Transaction ID: `{txid}`\n"
        )
    except discord.HTTPException:
        await asyncio.to_thread(wallet_request, "/api/refund", {"id": txid})
        raise
    ledger["transfers"].append({
        "transactionId": txid, "wallet": wallet, "symbol": symbol,
        "amount": str(value), "availableAt": time.time() + 10.0,
    })
    destination = ledger["walletBalances"].setdefault(wallet, {"BTC": "0", "ETH": "0"})
    destination[symbol] = str(Decimal(destination.get(symbol, "0")) + value)
    save_ledger()


token = os.getenv("DISCORD_TOKEN")
if not token:
    raise SystemExit("Set DISCORD_TOKEN before running the bot.")
instance_lock = acquire_instance_lock()
bot.run(token)
