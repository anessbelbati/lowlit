# Security

## Reporting a problem

Please report it privately: on this repository, **Security > Report a vulnerability**. That opens a private thread with me, not a public issue. I answer within a few days.

Say what you did, what happened, and which commit you were on. A short way to reproduce it helps most.

## What counts

Lowlit runs on your own computer and reads files there, so the problems that matter most are the ones that would let something else reach through it:

- a web page, or a program other than Claude Code, calling the Browser's door (the MCP server on `127.0.0.1`) without its key;
- a page opened in the Browser being handed a file it must never get: a file that holds keys, a folder whose name starts with a dot, AppData;
- a chat reading a site on your ask-first list without your yes;
- anything that makes Lowlit open `~/.claude/.credentials.json`, or send something off the machine while Jev is switched off;
- a key or a password showing up in Lowlit's own log (`%APPDATA%\lowlit\desk.log`) or in what a chat is handed.

## What Lowlit is built to keep

- It never sees or stores your Claude login, and never talks to Anthropic.
- The Browser's door answers on `127.0.0.1` only, with a key only Claude Code is given.
- Nothing leaves the machine unless you switch on Jev, or a page is opened in the Browser.

If you find one of these not holding, that is a security problem: report it as above.
