'use strict';

const fs = require('fs');
const readline = require('readline');

const { CONFIG_PATH, DEFAULT_API_TIMEOUT_MS } = require('./constants');
const { getSystemPrompt } = require('./prompts');

function createCommands({
  getConfig,
  setConfig,
  permissionManager,
  ui,
  apiClient,
  runAgentLoop,
  readFileContext,
  agentExecShell,
}) {
  const {
    BOLD,
    FG_BLUE,
    FG_CYAN,
    FG_DARK,
    FG_GRAY,
    FG_GREEN,
    FG_RED,
    FG_TEAL,
    FG_YELLOW,
    RST,
    getCols,
    printBanner,
    printHelpHints,
    printStatusBar,
    readInteractiveInput,
  } = ui;
  const {
    chatStream,
    chatSync,
    chooseSavedModelProfile,
    describeModelProfile,
    estimateTokens,
    setActiveModelProfile,
  } = apiClient;

  async function cmdChat(opts) {
    printBanner();
    const cwd = process.cwd();
    let currentModel = opts.model || getConfig().default_model;
    let isRunningAgent = false;

    printStatusBar(currentModel, cwd);
    printHelpHints();

    let messages = [{ role: 'system', content: getSystemPrompt() }];
    const promptHistory = [];
    const cols = getCols();

    while (true) {
      const inputResult = await readInteractiveInput(`  ${FG_TEAL}${BOLD}>${RST} `, {
        trim: false,
        allowCursorNavigation: true,
        history: promptHistory,
      });

      if (inputResult.type === 'eof') {
        console.log(`\n  ${FG_GRAY}Goodbye!${RST}\n`);
        return;
      }

      if (inputResult.type === 'sigint') {
        if (!isRunningAgent) {
          console.log(`\n  ${FG_YELLOW}Use Ctrl+D or type exit to quit.${RST}`);
        }
        continue;
      }

      const text = (inputResult.value || '').trim();
      if (!text) continue;
      promptHistory.push(text);

      if (['exit', 'quit', '/exit', '/quit'].includes(text.toLowerCase())) {
        console.log(`\n  ${FG_GRAY}Goodbye!${RST}\n`);
        return;
      }

      if (text === '/help') {
        console.log(`
  ${FG_BLUE}${BOLD}Commands:${RST}
  ${FG_CYAN}/file <path>${RST}     ${FG_GRAY}Load file or dir into context${RST}
  ${FG_CYAN}/model${RST}           ${FG_GRAY}Choose saved model profile${RST}
  ${FG_CYAN}/model <name>${RST}    ${FG_GRAY}Switch model manually${RST}
  ${FG_CYAN}/models${RST}          ${FG_GRAY}Choose saved model profile${RST}
  ${FG_CYAN}/clear${RST}           ${FG_GRAY}Clear conversation${RST}
  ${FG_CYAN}/compact${RST}         ${FG_GRAY}Show token usage${RST}
  ${FG_CYAN}/shell <cmd>${RST}     ${FG_GRAY}Run shell command directly${RST}
  ${FG_CYAN}!<cmd>${RST}           ${FG_GRAY}Run shell command directly${RST}
  ${FG_CYAN}/approve${RST}         ${FG_GRAY}Toggle auto-approve for all actions${RST}
  ${FG_CYAN}/config${RST}          ${FG_GRAY}Show config${RST}
  ${FG_CYAN}exit${RST}             ${FG_GRAY}Quit${RST}

  ${FG_DARK}The AI can execute commands — you'll be asked to approve each one.${RST}
`);
        continue;
      }

      if (text.startsWith('/file ')) {
        const fp = text.slice(6).trim();
        const ctx = readFileContext([fp], ui);
        if (ctx) messages.push({ role: 'user', content: `Here is the file context:\n${ctx}` });
        continue;
      }

      if (text === '/model' || text === '/models') {
        await new Promise((resolve) => {
          const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            terminal: true,
          });
          chooseSavedModelProfile(rl, currentModel, cwd, (nextModel) => {
            currentModel = nextModel;
            rl.close();
            resolve();
          });
        });
        continue;
      }

      if (text.startsWith('/model ')) {
        currentModel = text.slice(7).trim();
        console.log(`  ${FG_GREEN}✓${RST} ${FG_GRAY}Model → ${currentModel}${RST}`);
        printStatusBar(currentModel, cwd);
        continue;
      }

      if (text === '/clear') {
        messages = [{ role: 'system', content: getSystemPrompt() }];
        permissionManager.clear();
        console.log(`  ${FG_GREEN}✓${RST} ${FG_GRAY}Conversation and approvals cleared${RST}\n`);
        continue;
      }

      if (text === '/compact' || text === '/cost') {
        const total = messages.reduce((sum, message) => sum + estimateTokens(message.content), 0);
        console.log(`  ${FG_GRAY}${messages.length - 1} messages · ~${total} tokens${RST}\n`);
        continue;
      }

      if (text === '/config') {
        console.log(`  ${FG_GRAY}${JSON.stringify(getConfig(), null, 2)}${RST}\n`);
        continue;
      }

      if (text === '/approve') {
        const enabled = permissionManager.toggleAll();
        const state = enabled ? 'ON' : 'OFF';
        const color = enabled ? FG_GREEN : FG_RED;
        console.log(`  ${color}●${RST} ${FG_GRAY}Auto-approve: ${state}${RST}\n`);
        continue;
      }

      if (text.startsWith('/shell ') || text.startsWith('!')) {
        const cmd = text.startsWith('/shell ') ? text.slice(7).trim() : text.slice(1).trim();
        await agentExecShell(cmd);
        continue;
      }

      messages.push({ role: 'user', content: text });
      console.log(`  ${FG_DARK}${'─'.repeat(Math.min(cols, 70) - 4)}${RST}`);

      isRunningAgent = true;
      messages = await runAgentLoop(messages, currentModel);
      isRunningAgent = false;

      console.log(`  ${FG_DARK}${'━'.repeat(Math.min(cols, 70) - 4)}${RST}`);
      console.log();
    }
  }

  async function cmdCode(opts, promptArgs) {
    if (!promptArgs.length) {
      console.log(`  ${FG_RED}Usage: semalt-code code <prompt>${RST}`);
      return;
    }

    const userPrompt = promptArgs.join(' ');
    const context = opts.file ? readFileContext(opts.file, ui) : '';
    const fullPrompt = context ? `Context files:\n${context}\n\nTask: ${userPrompt}` : userPrompt;

    let messages = [
      { role: 'system', content: getSystemPrompt() },
      { role: 'user', content: fullPrompt },
    ];
    messages = await runAgentLoop(messages, opts.model || getConfig().default_model);
    console.log();
  }

  async function cmdEdit(opts, filePath, instructionArgs) {
    if (!filePath) {
      console.log(`  ${FG_RED}Usage: semalt-code edit <file> <instruction>${RST}`);
      return;
    }
    if (!fs.existsSync(filePath)) {
      console.log(`  ${FG_RED}✗ File not found: ${filePath}${RST}`);
      return;
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const instruction = instructionArgs.join(' ');

    const messages = [
      { role: 'system', content: 'You are Semalt.AI. Output ONLY the modified file. No explanations, no fences.' },
      { role: 'user', content: `File: ${filePath}\n\n\`\`\`\n${content}\n\`\`\`\n\nInstruction: ${instruction}` },
    ];

    console.log(`  ${FG_GRAY}Editing ${filePath}...${RST}`);
    let result = await chatSync(messages, { model: opts.model });

    if (result && !opts.dryRun) {
      if (result.startsWith('```')) {
        const lines = result.split('\n');
        result = lines.at(-1).trim() === '```'
          ? lines.slice(1, -1).join('\n')
          : lines.slice(1).join('\n');
      }
      fs.writeFileSync(filePath, result);
      console.log(`  ${FG_GREEN}✓ Saved: ${filePath}${RST}`);
    } else if (opts.dryRun) {
      console.log(`  ${FG_YELLOW}⚠ Dry run — not modified${RST}`);
    }
  }

  async function cmdShell(opts, commandArgs) {
    const command = commandArgs.join(' ');
    if (!command) {
      console.log(`  ${FG_RED}Usage: semalt-code shell <command>${RST}`);
      return;
    }

    const result = await agentExecShell(command);

    if (opts.analyze) {
      const messages = [
        { role: 'system', content: 'You are Semalt.AI. Analyze the command output concisely.' },
        { role: 'user', content: `Command: ${command}\nExit: ${result.exit_code}\nStdout:\n${result.stdout}\nStderr:\n${result.stderr}` },
      ];
      console.log();
      console.log(`  ${FG_TEAL}${BOLD}◆ Semalt.AI${RST}`);
      console.log();
      process.stdout.write('  ');
      await chatStream(messages, { model: opts.model });
      console.log();
    }
  }

  async function cmdModels() {
    const config = getConfig();
    if (!config.models.length) {
      console.log(`  ${FG_RED}✗${RST} ${FG_GRAY}No saved model profiles. Use semalt-code models add first.${RST}`);
      return;
    }

    console.log();
    console.log(`  ${FG_TEAL}${BOLD}◆ Saved Models${RST}`);
    console.log(`  ${FG_DARK}${'─'.repeat(40)}${RST}`);
    config.models.forEach((profile, index) => {
      const active = profile.api_base === config.api_base &&
        profile.api_key === config.api_key &&
        profile.model === config.default_model;
      const marker = active ? `${FG_GREEN}●${RST}` : `${FG_DARK}○${RST}`;
      console.log(`  ${marker} ${FG_CYAN}${index + 1}.${RST} ${describeModelProfile(profile)}`);
    });
    console.log();
  }

  async function cmdModelsAdd() {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });

    function ask(question) {
      return new Promise((resolve) => {
        rl.question(question, (answer) => resolve((answer || '').trim()));
      });
    }

    console.log();
    console.log(`  ${FG_TEAL}${BOLD}◆ Add Model Profile${RST}`);
    console.log(`  ${FG_DARK}${'─'.repeat(40)}${RST}`);

    const apiBase = await ask(`  ${FG_CYAN}API Base URL:${RST} `);
    const apiKey = await ask(`  ${FG_CYAN}API Key:${RST} `);
    const modelId = await ask(`  ${FG_CYAN}Model ID:${RST} `);
    rl.close();

    if (!apiBase || !modelId) {
      console.log(`\n  ${FG_RED}✗${RST} ${FG_GRAY}API Base URL and Model ID are required.${RST}\n`);
      return;
    }

    const config = getConfig();
    const profile = {
      api_base: apiBase,
      api_key: apiKey || 'any',
      model: modelId,
    };

    config.models.push(profile);
    setActiveModelProfile(profile);
    console.log(`\n  ${FG_GREEN}✓${RST} Saved model profile: ${describeModelProfile(profile)}\n`);
  }

  function cmdInit(opts) {
    const current = getConfig();
    const cfg = {
      api_base: opts.apiBase || 'http://127.0.0.1:8800',
      api_key: opts.apiKey || 'any',
      default_model: opts.defaultModel || 'default',
      temperature: 0.7,
      request_timeout_ms: DEFAULT_API_TIMEOUT_MS,
      stream: true,
      models: current.models,
    };
    setConfig(cfg);
    console.log(`\n  ${FG_GREEN}✓${RST} Config saved to ${CONFIG_PATH}`);
    console.log(`  ${FG_GRAY}${JSON.stringify(cfg, null, 2)}${RST}\n`);
  }

  return {
    cmdChat,
    cmdCode,
    cmdEdit,
    cmdInit,
    cmdModels,
    cmdModelsAdd,
    cmdShell,
  };
}

module.exports = {
  createCommands,
};
