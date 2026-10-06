'use strict';
// Lowlit's list of servers, from the command line: what Claude Code uses to pin a server once the person has said
// yes. It only writes the list (servers.json in Lowlit's own folder); it never starts or stops anything: the
// person does that on the Servers page. An open window takes the change in within two seconds.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readList, writeList, takeServer, folderOf } = require('./servers.cjs');

const HELP = `Lowlit servers: the list on the Servers page.

  node servers-cli.cjs list [--json]
  node servers-cli.cjs add --name "Chess dashboard" --folder "D:\\projects\\chess" --command "npm run dev" [--url localhost:5173]
  node servers-cli.cjs remove <id or name>

add pins a server: the folder it runs in and the command that starts it there, as typed in a console. --url is the
address to open it at; left out, Lowlit finds it once the server runs. Nothing is started: the person starts it from
the Servers page. Pin a server only once the person has said yes.
--profile <folder> works on another copy of the list (the app's test runs use one).`;

function parse(argv) {
  const opts = {};
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const m = /^--([a-z]+)(?:=(.*))?$/.exec(a);
    if (!m) { rest.push(a); continue; }
    if (m[1] === 'json' || m[1] === 'help') opts[m[1]] = true;
    else opts[m[1]] = m[2] !== undefined ? m[2] : argv[++i];
  }
  return { cmd: rest.shift() || '', rest, opts };
}

function main() {
  const { cmd, rest, opts } = parse(process.argv.slice(2));
  if (!cmd || opts.help || cmd === 'help') { console.log(HELP); return 0; }
  const dir = opts.profile || process.env.LOWLIT_PROFILE || path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'lowlit');
  const file = path.join(dir, 'servers.json');
  const list = readList(file);
  if (!list) { console.error(`${file} is there but cannot be read as a list: nothing was changed.`); return 2; }

  if (cmd === 'list') {
    if (opts.json) { console.log(JSON.stringify(list.servers, null, 1)); return 0; }
    if (!list.servers.length) { console.log('Nothing is pinned.'); return 0; }
    for (const s of list.servers) console.log(`${s.id}  ${s.name}\n    folder:  ${s.folder}\n    command: ${s.command}${s.url ? `\n    address: ${s.url}` : ''}`);
    return 0;
  }

  if (cmd === 'add') {
    const s = takeServer({ name: opts.name, folder: opts.folder, command: opts.command, url: opts.url, by: 'claude' });
    if (!s) {
      console.error(`A server needs --name, --folder (a whole path, like D:\\projects\\chess) and --command.${opts.folder && !folderOf(opts.folder) ? ` "${opts.folder}" is not a whole path.` : ''}`);
      return 1;
    }
    if (opts.url && !s.url) { console.error(`"${opts.url}" is not a web address (http or https).`); return 1; }
    let isDir = false;
    try { isDir = fs.statSync(s.folder).isDirectory(); } catch { /* not there */ }
    if (!isDir) { console.error(`The folder ${s.folder} is not there.`); return 1; }
    const twin = list.servers.find((x) => x.folder.toLowerCase() === s.folder.toLowerCase() && x.command === s.command);
    if (twin) { console.log(`Already pinned as ${twin.name} (${twin.id}).`); return 0; }
    if (list.servers.length >= 40) { console.error('The list holds 40 servers at most.'); return 1; }
    list.servers.push(s);
    writeList(file, list);
    console.log(`Pinned ${s.name} (${s.id}). It is on the Servers page of Lowlit, to start and stop from there.`);
    return 0;
  }

  if (cmd === 'remove') {
    const which = rest.join(' ').trim();
    const s = list.servers.find((x) => x.id === which) || list.servers.find((x) => x.name.toLowerCase() === which.toLowerCase());
    if (!s) { console.error(`No pinned server is called "${which}".`); return 1; }
    list.servers = list.servers.filter((x) => x !== s);
    writeList(file, list);
    console.log(`Unpinned ${s.name}. If it runs, it goes on running.`);
    return 0;
  }

  console.error(`"${cmd}" is not one of list, add, remove.\n\n${HELP}`);
  return 1;
}

process.exitCode = main();
