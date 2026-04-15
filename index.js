#!/usr/bin/env node
'use strict';

const { PACKAGE_JSON } = require('./lib/constants');
const { loadConfig, saveConfig } = require('./lib/config');
const ui = require('./lib/ui');
const { createPermissionManager } = require('./lib/permissions');
const { createToolExecutor, extractToolCalls } = require('./lib/tools');
const { readFileContext } = require('./lib/context');
const { createApiClient } = require('./lib/api');
const { createAgentRunner } = require('./lib/agent');
const { createCommands } = require('./lib/commands');
const { parseArgs } = require('./lib/args');
const { CONFIG_PATH } = require('./lib/constants');

let config = loadConfig();

function getConfig() {
  return config;
}

function setConfig(nextConfig) {
  config = nextConfig;
  saveConfig(config);
}

const permissionManager = createPermissionManager(ui);
const { agentExecShell, agentExecFile } = createToolExecutor(permissionManager, ui);
const apiClient = createApiClient({
  getConfig,
  saveConfig: (nextConfig) => {
    saveConfig(nextConfig);
    config = nextConfig;
  },
  ui,
});
const { runAgentLoop } = createAgentRunner({
  chatStream: apiClient.chatStream,
  extractToolCalls,
  agentExecShell,
  agentExecFile,
  ui,
});
const commands = createCommands({
  getConfig,
  setConfig,
  permissionManager,
  ui,
  apiClient,
  runAgentLoop,
  readFileContext,
  agentExecShell,
});

async function main() {
  const rawArgs = process.argv.slice(2);

  if (rawArgs.length === 0) {
    await commands.cmdChat({});
    return;
  }

  const command = rawArgs[0];

  if (command === '--help' || command === '-h') {
    console.log(`
Semalt.AI — Self-hosted AI Coding Assistant

Usage: semalt-code [command] [options]

Commands:
  (none)            Interactive chat mode (default)
  chat              Interactive chat mode
  code <prompt>     Generate code from a prompt
  edit <file> <instruction>  Edit a file with AI
  shell <command>   Run and optionally analyze a shell command
  models            List saved model profiles
  models add        Add a saved model profile
  init              Initialize config

Options:
  -m, --model <name>      Model name
  -f, --file <path>       Load file into context  (code command)
  -a, --analyze           Analyze output with AI  (shell command)
  --dry-run               Don't save changes      (edit command)
  --api-base <url>        API base URL            (init)
  --api-key  <key>        API key                 (init)
  --default-model <name>  Default model           (init)
  -v, --version           Show CLI version

Config: ${CONFIG_PATH}
`);
    return;
  }

  if (command === '--version' || command === '-v') {
    console.log(PACKAGE_JSON.version);
    return;
  }

  if (command === 'chat') {
    const { opts } = parseArgs(rawArgs.slice(1));
    await commands.cmdChat(opts);
  } else if (command === 'code') {
    const { opts, positional } = parseArgs(rawArgs.slice(1));
    await commands.cmdCode(opts, positional);
  } else if (command === 'edit') {
    const { opts, positional } = parseArgs(rawArgs.slice(1));
    await commands.cmdEdit(opts, positional[0], positional.slice(1));
  } else if (command === 'shell') {
    const { opts, positional } = parseArgs(rawArgs.slice(1));
    await commands.cmdShell(opts, positional);
  } else if (command === 'models') {
    if (rawArgs[1] === 'add') await commands.cmdModelsAdd();
    else await commands.cmdModels();
  } else if (command === 'init') {
    const { opts } = parseArgs(rawArgs.slice(1));
    commands.cmdInit(opts);
  } else {
    const { opts } = parseArgs(rawArgs);
    await commands.cmdChat(opts);
  }
}

main().catch((error) => {
  process.stderr.write(`\n  ${ui.FG_RED}✗ Fatal: ${error.message}${ui.RST}\n\n`);
  process.exit(1);
});
