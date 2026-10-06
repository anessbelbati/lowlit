# Contributing

Thank you for looking. Bug reports are the most useful thing you can send right now.

## Reporting a bug

Open an issue with:

- what you did, what you expected, what happened;
- your Windows version, and the output of `claude --version`;
- the commit you are on (`git rev-parse --short HEAD`);
- the lines of Lowlit's own log around the moment it happened: `%APPDATA%\lowlit\desk.log`. It is written to hold no conversation text, but read what you paste.

**Pictures:** a screenshot of Lowlit shows your chats' names and words. Blur them, or reproduce the bug in the self-test's window, which only ever shows made-up chats.

## How the code is laid out

Everything is in `app/`: an Electron app in plain JavaScript, with no build step and no framework.

- `main.cjs` is the main program. The other `.cjs` files are its parts: `watch.cjs` reads what Claude Code writes, `chats.cjs` and `keeper.cjs` hold the terminals, `browser.cjs` and `browser-mcp.cjs` are the Browser and its door, `viewer.cjs` the Viewer.
- The `.js` files are the window's page. They share one global scope, in the order `index.html` lists them, so no two of them may declare the same name: `npm run check` catches that.
- `styles/` holds the stylesheets, one per part of the window.
- `selftest.cjs` is the self-test. It starts the app in a hidden window with made-up chats and checks one area at a time.

## Before you send a change

```
npm run check
powershell -File app\dev\run-selftest.ps1 -Name mine -Only states -Quiet
```

Run the area your change touches: `states`, `browser`, `viewer`, `servers`, `glance`, `nest`, `jev`, `work`, `notes`. One run opens one hidden window for a minute or two and prints what failed. A change to something a test covers comes with its check.

A few house rules, so the code stays one voice:

- Match the file you are in: its naming, its comments, its way of doing the same thing elsewhere.
- Comments say what the code cannot: a constraint, a reason, a thing learned the hard way. Not what the next line does.
- No new dependency without a word first. There are five, on purpose.
- Lowlit never sees a login, never talks to Anthropic, and never types into a chat by itself. A change that crosses one of those lines will not be merged.

## How changes land

The code here is synced from the tree I work in every day. When I accept a pull request I apply it there, and it comes back here with the next sync, with your name on the commit. So a pull request may be closed rather than merged: the change is in all the same.

Small, single-purpose pull requests are the ones I can take quickly. For anything larger, open an issue first and say what you have in mind.
