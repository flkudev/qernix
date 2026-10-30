# Qernix localhost dashboard

From this folder, run `npm start`, then open http://127.0.0.1:3000.
No packages need to be installed. Node.js 18 or newer is required.

**Users.** Everyone visits as an automatic **guest**: read-only balances, terminal commands, and a help-ticket form/button that sends a message to the owners' inbox. A welcome message explains the balances and tickets on first load; `welcome` reopens it. Log in with **flku / 12345** from the login button (or the `login` terminal command) to get the owner account. The owner can press **U** or run `edit` to change balances, run `tickets` to read the inbox, `close <id>` to close a ticket, `logout` to return to guest, and `panic` for the emergency flush.

Guest tickets are stored in `site-tickets.json` next to the wallet file (`%APPDATA%\ExodusCopy\` by default). Set `WALLET_TICKETS_FILE` to override the path.

Starts with 5 HBTC and 5 ETH. Balances persist in `%APPDATA%\ExodusCopy\site-wallet.json`, shared by all browsers on this server and the Discord bot. The editor's defaults button fills both inputs with 5; Save applies them.

The bot's `/send btc 2 exodus` deducts 2 from the website's HBTC balance (5 becomes 3); ETH works the same way. The website refreshes balances every half second. The Exodus visual receives the transfer 10 seconds after the Discord message. Insufficient website balances are rejected. Run this server before using the bot. The server listens on loopback only. If you change `PORT`, set the bot's `WALLET_API` to the matching localhost URL.

Terminal command `panic` is owner-only. It sets both simulated balances to zero, locks new payments, and logs out every browser until Node restarts. The blackout view is black and white and includes a glitch effect, an endless synthesized horror ambience and a clearly marked simulated IP-logging prank (no IP is collected). The ambience starts for every visitor viewing the panic screen. Browsers normally block autoplay until a click, so run `open-site.cmd` to open the site in Edge/Chrome/Brave with autoplay allowed in its own profile — no click needed. The running Discord bot checks every three seconds and posts the latest unannounced panic event to channel `1563981574796476516`; it needs View Channel and Send Messages permissions. Events survive Node restarts and the bot remembers the last successfully announced event. Discord `/send` displays the logout message when a payment is attempted. Restart Node to log back in and clear lockdown; cleared balances stay at zero. Transfers already queued in the desktop app are not canceled.
