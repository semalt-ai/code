#!/usr/bin/env node
'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawnSync } = require('child_process');
const http = require('http');
const https = require('https');
const { URL } = require('url');

const PACKAGE_JSON = require('./package.json');

const DEFAULT_API_TIMEOUT_MS = 15 * 60 * 1000;

// ── Config ────────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG = {
  api_base: 'http://127.0.0.1:8800',
  api_key: 'any',
  default_model: 'default',
  temperature: 0.7,
  max_tokens: 4096,
  request_timeout_ms: DEFAULT_API_TIMEOUT_MS,
  stream: true,
  models: [],
};

const CONFIG_PATH = path.join(os.homedir(), '.semalt-ai', 'config.json');

function normalizeConfig(cfg = {}) {
  const merged = { ...DEFAULT_CONFIG, ...cfg };
  merged.models = Array.isArray(cfg.models)
    ? cfg.models
        .filter((entry) => entry &&
          typeof entry.api_base === 'string' &&
          typeof entry.api_key === 'string' &&
          typeof entry.model === 'string' &&
          entry.api_base.trim() &&
          entry.model.trim())
        .map((entry) => ({
          api_base: entry.api_base.trim(),
          api_key: entry.api_key,
          model: entry.model.trim(),
        }))
    : [];
  return merged;
}

function loadConfig() {
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      return normalizeConfig(data);
    } catch {}
  }
  return normalizeConfig();
}

function saveConfig(cfg) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(normalizeConfig(cfg), null, 2));
}

let config = loadConfig();

// ── Terminal ──────────────────────────────────────────────────────────────────

function getCols() {
  return process.stdout.columns || 80;
}

const RST     = '\x1b[0m';
const BOLD    = '\x1b[1m';
const DIM     = '\x1b[2m';

const FG_GRAY    = '\x1b[38;5;245m';
const FG_DARK    = '\x1b[38;5;240m';
const FG_BLUE    = '\x1b[38;5;75m';
const FG_CYAN    = '\x1b[38;5;116m';
const FG_GREEN   = '\x1b[38;5;114m';
const FG_YELLOW  = '\x1b[38;5;222m';
const FG_RED     = '\x1b[38;5;203m';
const FG_TEAL    = '\x1b[38;5;73m';

const BOX_H  = '─';
const BOX_V  = '│';
const BOX_TL = '╭';
const BOX_TR = '╮';
const BOX_BL = '╰';
const BOX_BR = '╯';

function hr(char = '─', color = FG_DARK) {
  process.stdout.write(`${color}${char.repeat(getCols())}${RST}\n`);
}

function stripAnsi(str) {
  return str.replace(/\x1b\[[^m]*m/g, '');
}

function boxLine(text, width) {
  const w = width || (getCols() - 4);
  const visible = stripAnsi(text).length;
  const pad = Math.max(0, w - visible);
  return `  ${FG_DARK}${BOX_V}${RST} ${text}${' '.repeat(pad)}${FG_DARK}${BOX_V}${RST}`;
}

// ── Permission system ─────────────────────────────────────────────────────────

let AUTO_APPROVE_SHELL = false;
let AUTO_APPROVE_FILE  = false;

function askPermission(actionType, description) {
  return new Promise((resolve) => {
    if (actionType === 'shell' && AUTO_APPROVE_SHELL) {
      console.log(`  ${FG_GREEN}✓${RST} ${FG_DARK}Auto-approved: ${description}${RST}`);
      return resolve(true);
    }
    if (actionType === 'file' && AUTO_APPROVE_FILE) {
      console.log(`  ${FG_GREEN}✓${RST} ${FG_DARK}Auto-approved: ${description}${RST}`);
      return resolve(true);
    }

    console.log();
    console.log(`  ${FG_YELLOW}${BOLD}⚠ Permission required${RST}`);
    console.log(`  ${FG_GRAY}${actionType}: ${description}${RST}`);
    console.log();
    console.log(`  ${FG_CYAN}[y]${RST} Yes  ${FG_CYAN}[a]${RST} Yes, always  ${FG_CYAN}[n]${RST} No`);
    console.log();

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`  ${FG_YELLOW}?${RST} `, (answer) => {
      rl.close();
      const choice = (answer || '').trim().toLowerCase();
      if (choice === 'y' || choice === 'yes') {
        resolve(true);
      } else if (choice === 'a' || choice === 'always') {
        if (actionType === 'shell') AUTO_APPROVE_SHELL = true;
        else AUTO_APPROVE_FILE = true;
        console.log(`  ${FG_GREEN}✓${RST} ${FG_DARK}Auto-approve enabled for ${actionType} operations${RST}`);
        resolve(true);
      } else {
        console.log(`  ${FG_RED}✗${RST} ${FG_DARK}Denied${RST}`);
        resolve(false);
      }
    });
  });
}

// ── Agent: execute tools ──────────────────────────────────────────────────────

async function agentExecShell(command) {
  const approved = await askPermission('shell', command);
  if (!approved) {
    return { exit_code: -1, stdout: '', stderr: 'Permission denied by user' };
  }

  console.log(`  ${FG_DARK}$ ${command}${RST}`);
  try {
    const result = spawnSync(command, { shell: true, encoding: 'utf8', timeout: 60000 });
    const stdout = result.stdout || '';
    const stderr = result.stderr || '';
    const combined = stdout + (stderr ? '\n' + stderr : '');
    const lines = combined.trim().split('\n').filter(l => l !== '');

    if (lines.length > 20) {
      lines.slice(0, 15).forEach(l => console.log(`  ${FG_GRAY}${l}${RST}`));
      console.log(`  ${FG_DARK}... (${lines.length - 15} more lines)${RST}`);
    } else {
      lines.forEach(l => console.log(`  ${FG_GRAY}${l}${RST}`));
    }
    console.log();

    return { exit_code: result.status ?? 0, stdout, stderr };
  } catch (e) {
    console.log(`  ${FG_RED}✗ ${e.message}${RST}`);
    return { exit_code: -1, stdout: '', stderr: e.message };
  }
}

async function agentExecFile(action, filePath, content = null) {
  if (action === 'read') {
    const approved = await askPermission('file', `Read ${filePath}`);
    if (!approved) return { error: 'Permission denied' };
    try {
      const data = fs.readFileSync(filePath, 'utf8');
      const lines = data.split('\n').length;
      if (lines > 10) {
        console.log(`  ${FG_GREEN}✓${RST} ${FG_GRAY}Read ${filePath} (${lines} lines, ${data.length} chars)${RST}`);
      } else {
        console.log(`  ${FG_GREEN}✓${RST} ${FG_GRAY}Read ${filePath}${RST}`);
      }
      return { content: data, path: filePath };
    } catch (e) {
      console.log(`  ${FG_RED}✗ ${e.message}${RST}`);
      return { error: e.message };
    }
  }

  if (action === 'write' || action === 'append') {
    let desc = `${action === 'write' ? 'Write' : 'Append to'} ${filePath}`;
    if (content) desc += ` (${content.length} chars)`;
    const approved = await askPermission('file', desc);
    if (!approved) return { error: 'Permission denied' };
    try {
      const dir = path.dirname(filePath);
      if (dir && dir !== '.') fs.mkdirSync(dir, { recursive: true });
      if (action === 'write') {
        fs.writeFileSync(filePath, content || '');
      } else {
        fs.appendFileSync(filePath, content || '');
      }
      const verb = action === 'write' ? 'Wrote' : 'Appended to';
      console.log(`  ${FG_GREEN}✓${RST} ${FG_GRAY}${verb} ${filePath}${RST}`);
      return { status: 'ok', path: filePath, bytes: (content || '').length };
    } catch (e) {
      console.log(`  ${FG_RED}✗ ${e.message}${RST}`);
      return { error: e.message };
    }
  }

  return { error: `Unknown action: ${action}` };
}

// ── Tool call extraction ──────────────────────────────────────────────────────

function extractToolCalls(text) {
  const calls = [];

  // ```bash / ```shell / ```sh blocks
  for (const m of text.matchAll(/```(?:shell|bash|sh)\n([\s\S]*?)```/g)) {
    for (const line of m[1].trim().split('\n')) {
      const cmd = line.trim();
      if (cmd && !cmd.startsWith('#')) calls.push(['shell', cmd]);
    }
  }

  // <shell> tags
  for (const m of text.matchAll(/<shell>([\s\S]*?)<\/shell>/g))
    calls.push(['shell', m[1].trim()]);

  // <exec> tags
  for (const m of text.matchAll(/<exec>([\s\S]*?)<\/exec>/g))
    calls.push(['shell', m[1].trim()]);

  // <read_file> tags
  for (const m of text.matchAll(/<read_file>([\s\S]*?)<\/read_file>/g))
    calls.push(['read', m[1].trim()]);

  // <write_file> tags
  for (const m of text.matchAll(/<write_file\s+path="([^"]+)">([\s\S]*?)<\/write_file>/g))
    calls.push(['write', m[1], m[2]]);

  return calls;
}

// ── Stream Renderer ───────────────────────────────────────────────────────────

const FG_CODE_BG     = '\x1b[48;5;236m';
const FG_CODE_BORDER = '\x1b[38;5;240m';
const FG_CODE_LANG   = '\x1b[38;5;75m';
const FG_INLINE_CODE = '\x1b[38;5;215m';
const FG_HEADING     = '\x1b[38;5;75m';
const FG_BULLET      = '\x1b[38;5;114m';
const FG_BOLD_TEXT   = '\x1b[38;5;255m';
const FG_DIFF_ADD    = '\x1b[38;5;114m';
const FG_DIFF_DEL    = '\x1b[38;5;203m';
const FG_DIFF_HDR    = '\x1b[38;5;75m';
const FG_FILEPATH    = '\x1b[38;5;222m';
const FG_TAG         = '\x1b[38;5;176m';

const KEYWORDS = new Set([
  'def', 'class', 'import', 'from', 'return', 'if', 'else', 'elif',
  'for', 'while', 'try', 'except', 'finally', 'with', 'as', 'in',
  'not', 'and', 'or', 'is', 'None', 'True', 'False', 'async', 'await',
  'function', 'const', 'let', 'var', 'export', 'require', 'func',
  'type', 'struct', 'interface', 'package', 'fn', 'pub', 'use',
  'mod', 'impl', 'match', 'enum', 'self', 'print', 'len', 'range',
  'yield', 'lambda', 'raise', 'pass', 'break', 'continue', 'del',
  'global', 'nonlocal', 'assert',
]);

class StreamRenderer {
  constructor() {
    this.buffer = '';
    this.inCodeBlock = false;
    this.codeLang = '';
  }

  feed(chunk) {
    this.buffer += chunk;
    while (this.buffer.includes('\n')) {
      const idx = this.buffer.indexOf('\n');
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      this._renderLine(line);
    }
  }

  flush() {
    if (this.buffer) {
      this._renderLine(this.buffer);
      this.buffer = '';
    }
    if (this.inCodeBlock) {
      process.stdout.write(`  ${FG_CODE_BORDER}╰${'─'.repeat(50)}${RST}\n`);
      this.inCodeBlock = false;
    }
  }

  _renderLine(line) {
    // Code block start
    if (line.startsWith('```') && !this.inCodeBlock) {
      this.inCodeBlock = true;
      this.codeLang = line.slice(3).trim();
      const label = this.codeLang ? ` ${this.codeLang} ` : '';
      process.stdout.write(
        `  ${FG_CODE_BORDER}╭${'─'.repeat(20)}${RST}${FG_CODE_LANG}${label}${RST}` +
        `${FG_CODE_BORDER}${'─'.repeat(Math.max(1, 30 - label.length))}${RST}\n`
      );
      return;
    }

    // Code block end
    if (line.trim() === '```' && this.inCodeBlock) {
      process.stdout.write(`  ${FG_CODE_BORDER}╰${'─'.repeat(50)}${RST}\n`);
      this.inCodeBlock = false;
      return;
    }

    // Inside code block
    if (this.inCodeBlock) {
      process.stdout.write(`  ${FG_CODE_BORDER}│${RST} ${FG_CODE_BG}${this._colorizeCode(line)}${RST}\n`);
      return;
    }

    // Diff lines
    if (/^\+(?!\+\+)/.test(line)) { process.stdout.write(`  ${FG_DIFF_ADD}${line}${RST}\n`); return; }
    if (/^-(?!--)/.test(line))    { process.stdout.write(`  ${FG_DIFF_DEL}${line}${RST}\n`); return; }
    if (line.startsWith('@@'))    { process.stdout.write(`  ${FG_DIFF_HDR}${line}${RST}\n`); return; }

    // Tool tags
    if (/^<(exec|shell|read_file|write_file)/.test(line))  { process.stdout.write(`  ${FG_TAG}${line}${RST}\n`); return; }
    if (/^<\/(exec|shell|read_file|write_file)/.test(line)){ process.stdout.write(`  ${FG_TAG}${line}${RST}\n`); return; }

    // Headings
    const hm = line.match(/^(#{1,4})\s+(.*)/);
    if (hm) {
      const text = hm[2];
      if (hm[1].length <= 2) {
        process.stdout.write(`  ${FG_HEADING}${BOLD}${hm[1]} ${text}${RST}\n`);
      } else {
        process.stdout.write(`  ${FG_HEADING}${hm[1]} ${text}${RST}\n`);
      }
      return;
    }

    // Bullet points
    const bm = line.match(/^(\s*)([-*•])\s+(.*)/);
    if (bm) {
      process.stdout.write(`  ${bm[1]}${FG_BULLET}•${RST} ${this._inlineFormat(bm[3])}\n`);
      return;
    }

    // Numbered list
    const nm = line.match(/^(\s*)(\d+\.)\s+(.*)/);
    if (nm) {
      process.stdout.write(`  ${nm[1]}${FG_CYAN}${nm[2]}${RST} ${this._inlineFormat(nm[3])}\n`);
      return;
    }

    // Regular text
    process.stdout.write(`  ${this._inlineFormat(line)}\n`);
  }

  _inlineFormat(text) {
    text = text.replace(/\*\*(.+?)\*\*/g, `${FG_BOLD_TEXT}${BOLD}$1${RST}`);
    text = text.replace(/`([^`]+)`/g, `${FG_INLINE_CODE}$1${RST}`);
    text = text.replace(/(?<!\w)((?:\/[\w\-.]+)+(?:\.\w+)?)/g, `${FG_FILEPATH}$1${RST}`);
    return text;
  }

  _colorizeCode(line) {
    const C_KW  = '\x1b[38;5;176m';
    const C_STR = '\x1b[38;5;114m';
    const C_CMT = '\x1b[38;5;242m';
    const C_NUM = '\x1b[38;5;215m';
    const C_RST = `${RST}${FG_CODE_BG}`;

    let result = '';
    let i = 0;

    while (i < line.length) {
      // Comment
      if (line[i] === '#' || (line[i] === '/' && line[i + 1] === '/')) {
        result += `${C_CMT}${line.slice(i)}${C_RST}`;
        break;
      }

      // String
      if (line[i] === '"' || line[i] === "'") {
        const q = line[i];
        let j = i + 1;
        while (j < line.length && line[j] !== q) {
          if (line[j] === '\\') j++;
          j++;
        }
        j = Math.min(j + 1, line.length);
        result += `${C_STR}${line.slice(i, j)}${C_RST}`;
        i = j;
        continue;
      }

      // Identifier / keyword
      if (/[a-zA-Z_]/.test(line[i])) {
        let j = i;
        while (j < line.length && /\w/.test(line[j])) j++;
        const word = line.slice(i, j);
        result += KEYWORDS.has(word) ? `${C_KW}${word}${C_RST}` : word;
        i = j;
        continue;
      }

      // Number
      if (/\d/.test(line[i])) {
        let j = i;
        while (j < line.length && /[\d.]/.test(line[j])) j++;
        result += `${C_NUM}${line.slice(i, j)}${C_RST}`;
        i = j;
        continue;
      }

      result += line[i++];
    }

    return result;
  }
}

// ── API Client ────────────────────────────────────────────────────────────────

function apiUrl(urlPath) {
  const base = (config.api_base || '').replace(/\/$/, '');
  const normalizedBase = /\/v1$/i.test(base) ? base : `${base}/v1`;
  const normalizedPath = urlPath.startsWith('/v1/') ? urlPath.slice(3) : urlPath;
  return `${normalizedBase}${normalizedPath}`;
}

function describeModelProfile(profile) {
  return `${profile.model} @ ${profile.api_base}`;
}

function setActiveModelProfile(profile) {
  config.api_base = profile.api_base;
  config.api_key = profile.api_key;
  config.default_model = profile.model;
  saveConfig(config);
}

function chooseSavedModelProfile(rl, currentModel, cwd, onDone) {
  if (!config.models.length) {
    console.log(`  ${FG_RED}✗${RST} ${FG_GRAY}No saved model profiles. Use semalt-code models add first.${RST}`);
    onDone(currentModel);
    return;
  }

  console.log();
  console.log(`  ${FG_TEAL}${BOLD}◆ Saved Models${RST}`);
  console.log(`  ${FG_DARK}${'─'.repeat(40)}${RST}`);
  config.models.forEach((profile, index) => {
    const active = profile.api_base === config.api_base &&
      profile.api_key === config.api_key &&
      profile.model === currentModel;
    const marker = active ? `${FG_GREEN}●${RST}` : `${FG_DARK}○${RST}`;
    console.log(`  ${marker} ${FG_CYAN}${index + 1}.${RST} ${describeModelProfile(profile)}`);
  });
  console.log();

  rl.question(`  ${FG_TEAL}${BOLD}Select model>${RST} `, (answer) => {
    const selected = Number((answer || '').trim());
    if (!Number.isInteger(selected) || selected < 1 || selected > config.models.length) {
      console.log(`  ${FG_RED}✗${RST} ${FG_GRAY}Invalid selection${RST}`);
      onDone(currentModel);
      return;
    }

    const profile = config.models[selected - 1];
    setActiveModelProfile(profile);
    console.log(`  ${FG_GREEN}✓${RST} ${FG_GRAY}Model profile → ${describeModelProfile(profile)}${RST}`);
    printStatusBar(profile.model, cwd);
    onDone(profile.model);
  });
}

function estimateTokens(text) {
  return Math.floor((text || '').length / 4);
}

function httpRequest(urlStr, options, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(urlStr);
    const lib = url.protocol === 'https:' ? https : http;
    const reqOpts = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname + url.search,
      method: options.method || 'GET',
      headers: options.headers || {},
    };

    const req = lib.request(reqOpts, (res) => {
      resolve(res);
    });

    req.on('error', reject);

    if (options.timeout) {
      req.setTimeout(options.timeout, () => {
        req.destroy(new Error('Request timed out'));
      });
    }

    if (body) req.write(body);
    req.end();
  });
}

async function chatStream(messages, { model, temperature, maxTokens } = {}) {
  const payload = {
    model: model || config.default_model,
    messages,
    temperature: temperature !== undefined ? temperature : config.temperature,
    max_tokens: maxTokens || config.max_tokens,
    stream: true,
  };

  const body = JSON.stringify(payload);
  let res;

  try {
    res = await httpRequest(apiUrl('/v1/chat/completions'), {
      method: 'POST',
      timeout: config.request_timeout_ms,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.api_key}`,
        'Content-Length': Buffer.byteLength(body),
      },
    }, body);
  } catch (e) {
    process.stdout.write(`\n  ${FG_RED}✗ ${e.message}${RST}\n`);
    return '';
  }

  if (res.statusCode !== 200) {
    process.stdout.write(`\n  ${FG_RED}✗ Error: HTTP ${res.statusCode}${RST}\n`);
    res.resume();
    return '';
  }

  return new Promise((resolve) => {
    const startTime = Date.now();
    let fullText = '';
    let reasoningText = '';
    let tokenCount = 0;
    let inReasoning = false;
    const renderer = new StreamRenderer();
    let lineBuffer = '';

    res.setEncoding('utf8');

    res.on('data', (chunk) => {
      lineBuffer += chunk;
      const lines = lineBuffer.split('\n');
      lineBuffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;
        try {
          const obj = JSON.parse(data);
          const delta = ((obj.choices || [])[0] || {}).delta || {};

          const reasoning = delta.reasoning_content || '';
          if (reasoning) {
            if (!inReasoning) {
              inReasoning = true;
              process.stdout.write(`\n  ${FG_DARK}${DIM}⟨thinking⟩${RST}`);
            }
            reasoningText += reasoning;
            tokenCount++;
            if (tokenCount % 20 === 0) process.stdout.write(`${FG_DARK}.${RST}`);
          }

          const content = delta.content || '';
          if (content) {
            if (inReasoning) {
              inReasoning = false;
              process.stdout.write(`${FG_DARK}⟨/thinking⟩${RST}\n`);
            }
            renderer.feed(content);
            fullText += content;
            tokenCount++;
          }
        } catch {}
      }
    });

    res.on('end', () => {
      renderer.flush();
      const elapsed = (Date.now() - startTime) / 1000;
      const estTokens = estimateTokens(fullText + reasoningText);
      const tps = tokenCount / (elapsed || 1);
      const cols = getCols();
      process.stdout.write(`\n  ${FG_DARK}${'─'.repeat(Math.min(cols, 60) - 4)}${RST}\n`);
      let costLine = `${FG_DARK}~${estTokens} tokens · ${elapsed.toFixed(1)}s · ${Math.round(tps)} tok/s${RST}`;
      if (reasoningText) costLine += ` ${FG_DARK}· ${estimateTokens(reasoningText)} thinking${RST}`;
      process.stdout.write(`  ${costLine}\n`);
      resolve(fullText);
    });

    res.on('error', (e) => {
      process.stdout.write(`\n  ${FG_RED}✗ ${e.message}${RST}\n`);
      resolve('');
    });
  });
}

async function chatSync(messages, { model } = {}) {
  const payload = {
    model: model || config.default_model,
    messages,
    temperature: config.temperature,
    max_tokens: config.max_tokens,
    stream: false,
  };

  const body = JSON.stringify(payload);
  let res;

  try {
    res = await httpRequest(apiUrl('/v1/chat/completions'), {
      method: 'POST',
      timeout: config.request_timeout_ms,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.api_key}`,
        'Content-Length': Buffer.byteLength(body),
      },
    }, body);
  } catch (e) {
    console.log(`  ${FG_RED}✗ ${e.message}${RST}`);
    return '';
  }

  return new Promise((resolve) => {
    let data = '';
    res.setEncoding('utf8');
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      if (res.statusCode !== 200) {
        console.log(`  ${FG_RED}✗ Error: HTTP ${res.statusCode} — ${data}${RST}`);
        return resolve('');
      }
      try {
        const parsed = JSON.parse(data);
        const content = parsed.choices[0].message.content;
        console.log(content);
        resolve(content);
      } catch (e) {
        console.log(`  ${FG_RED}✗ Parse error: ${e.message}${RST}`);
        resolve('');
      }
    });
    res.on('error', (e) => {
      console.log(`  ${FG_RED}✗ ${e.message}${RST}`);
      resolve('');
    });
  });
}

// ── Agent loop ────────────────────────────────────────────────────────────────

async function runAgentLoop(messages, model, maxIterations = 10) {
  const cols = getCols();

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    console.log();
    console.log(`  ${FG_DARK}${'─'.repeat(Math.min(cols, 70) - 4)}${RST}`);
    process.stdout.write(`  ${FG_TEAL}${BOLD}◆ Semalt.AI${RST}`);
    if (iteration > 0) process.stdout.write(` ${FG_DARK}(step ${iteration + 1})${RST}`);
    console.log();
    console.log(`  ${FG_DARK}${'─'.repeat(Math.min(cols, 70) - 4)}${RST}`);
    console.log();
    process.stdout.write('  ');

    const reply = await chatStream(messages, { model });
    if (!reply) break;

    messages.push({ role: 'assistant', content: reply });

    const toolCalls = extractToolCalls(reply);
    if (toolCalls.length === 0) break;

    console.log(`\n  ${FG_TEAL}◆${RST} ${FG_GRAY}Found ${toolCalls.length} action(s) to execute${RST}`);

    const results = [];
    let aborted = false;

    for (const call of toolCalls) {
      if (call[0] === 'shell') {
        const result = await agentExecShell(call[1]);
        if (result.stderr === 'Permission denied by user') {
          results.push(`Command \`${call[1]}\`: Permission denied by user.`);
          aborted = true;
        } else {
          let out = result.stdout;
          if (result.stderr) out += '\nSTDERR: ' + result.stderr;
          results.push(`Command \`${call[1]}\`:\nExit code: ${result.exit_code}\n${out}`);
        }
      } else if (call[0] === 'read') {
        const result = await agentExecFile('read', call[1]);
        if (result.error) results.push(`Read ${call[1]}: Error — ${result.error}`);
        else results.push(`File ${call[1]}:\n${result.content}`);
      } else if (call[0] === 'write') {
        const result = await agentExecFile('write', call[1], call[2]);
        if (result.error) results.push(`Write ${call[1]}: Error — ${result.error}`);
        else results.push(`Wrote ${result.bytes} bytes to ${call[1]}`);
      }
    }

    const feedback = results.join('\n\n');
    messages.push({
      role: 'user',
      content: `Tool execution results:\n\n${feedback}\n\nContinue with the task. If everything is done, summarize what was accomplished.`,
    });

    if (aborted) {
      console.log(`\n  ${FG_YELLOW}⚠${RST} ${FG_GRAY}Some actions were denied. Continuing with partial results.${RST}`);
    }
  }

  return messages;
}

// ── Banner / UI ───────────────────────────────────────────────────────────────

function printBanner() {
  const w = Math.min(getCols() - 4, 60);
  console.log();
  console.log(`  ${FG_DARK}${BOX_TL}${BOX_H.repeat(w + 2)}${BOX_TR}${RST}`);
  console.log(boxLine('', w));
  console.log(boxLine(`${FG_TEAL}${BOLD}◆ Semalt.AI${RST}`, w));
  console.log(boxLine(`${FG_GRAY}Self-hosted AI coding assistant${RST}`, w));
  console.log(boxLine('', w));
  console.log(`  ${FG_DARK}${BOX_BL}${BOX_H.repeat(w + 2)}${BOX_BR}${RST}`);
  console.log();
}

function printStatusBar(model, cwd) {
  const left  = `${FG_TEAL}${BOLD}◆${RST} ${FG_GRAY}${model}${RST}`;
  const right = `${FG_DARK}${cwd}${RST}`;
  console.log(`  ${left}  ${FG_DARK}│${RST}  ${right}`);
  hr();
}

function printHelpHints() {
  const hints = [
    [`${FG_BLUE}/help${RST}`, 'commands'],
    [`${FG_BLUE}/model${RST}`, 'switch'],
    [`${FG_BLUE}/file${RST}`, 'context'],
    [`${FG_BLUE}/clear${RST}`, 'reset'],
  ];
  process.stdout.write(`  ${FG_DARK}Tips:${RST}`);
  for (const [cmd, desc] of hints) {
    process.stdout.write(`  ${cmd} ${FG_DARK}${desc}${RST}`);
  }
  console.log();
  console.log();
}

// ── File context ──────────────────────────────────────────────────────────────

function readFileContext(filePaths) {
  let context = '';
  for (const fp of filePaths) {
    if (!fs.existsSync(fp)) {
      console.log(`  ${FG_RED}✗${RST} ${FG_GRAY}Not found: ${fp}${RST}`);
      continue;
    }
    const stat = fs.statSync(fp);
    if (stat.isFile()) {
      try {
        const content = fs.readFileSync(fp, 'utf8');
        context += `\n--- File: ${fp} ---\n${content}\n`;
        console.log(`  ${FG_GREEN}✓${RST} ${FG_GRAY}Loaded ${fp} (${content.length} chars)${RST}`);
      } catch (e) {
        console.log(`  ${FG_RED}✗${RST} ${FG_GRAY}${fp}: ${e.message}${RST}`);
      }
    } else if (stat.isDirectory()) {
      let count = 0;
      function walkDir(dir) {
        if (count >= 50) return;
        let entries;
        try { entries = fs.readdirSync(dir).sort(); } catch { return; }
        for (const entry of entries) {
          if (entry.startsWith('.')) continue;
          const full = path.join(dir, entry);
          let s;
          try { s = fs.statSync(full); } catch { continue; }
          if (s.isFile()) {
            try {
              const content = fs.readFileSync(full, 'utf8').slice(0, 10000);
              context += `\n--- File: ${full} ---\n${content}\n`;
              count++;
            } catch {}
          } else if (s.isDirectory()) {
            walkDir(full);
          }
        }
      }
      walkDir(fp);
      console.log(`  ${FG_GREEN}✓${RST} ${FG_GRAY}Loaded ${count} files from ${fp}${RST}`);
    }
  }
  return context;
}

// ── System prompt ─────────────────────────────────────────────────────────────

function getSystemPrompt() {
  return `You are Semalt.AI, an expert AI coding assistant running in the user's terminal. You have the ability to execute shell commands and file operations.

IMPORTANT: You CAN execute commands on the user's system. When you need to run a command, use this exact format:

To run a shell command:
<exec>command here</exec>

To read a file:
<read_file>/path/to/file</read_file>

To write a file:
<write_file path="/path/to/file">file content here</write_file>

Rules:
- When the user asks you to do something on their system (create files, install packages, check status, etc.), USE the tools above — do NOT just print instructions.
- Each command will be shown to the user for approval before execution.
- After execution, you will receive the output and can continue working.
- You can chain multiple operations in one response.
- Be concise. Provide working solutions.
- Use markdown for code blocks in explanations.
- Current working directory: ${process.cwd()}`;
}

// ── Commands ──────────────────────────────────────────────────────────────────

async function cmdChat(opts) {
  printBanner();
  const cwd = process.cwd();
  let currentModel = opts.model || config.default_model;
  let isRunningAgent = false;

  printStatusBar(currentModel, cwd);
  printHelpHints();

  let messages = [{ role: 'system', content: getSystemPrompt() }];
  const cols = getCols();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  rl.on('close', () => {
    console.log(`\n  ${FG_GRAY}Goodbye!${RST}\n`);
    process.exit(0);
  });

  rl.on('SIGINT', () => {
    if (isRunningAgent) return;
    console.log(`\n  ${FG_YELLOW}Use Ctrl+D or type exit to quit.${RST}`);
    rl.prompt(true);
  });

  async function prompt() {
    rl.setPrompt(`  ${FG_TEAL}${BOLD}>${RST} `);
    rl.question(rl.getPrompt(), async (input) => {
      const text = (input || '').trim();

      if (!text) return prompt();

      if (['exit', 'quit', '/exit', '/quit'].includes(text.toLowerCase())) {
        console.log(`\n  ${FG_GRAY}Goodbye!${RST}\n`);
        rl.close();
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
        return prompt();
      }

      if (text.startsWith('/file ')) {
        const fp = text.slice(6).trim();
        const ctx = readFileContext([fp]);
        if (ctx) messages.push({ role: 'user', content: `Here is the file context:\n${ctx}` });
        return prompt();
      }

      if (text === '/model' || text === '/models') {
        chooseSavedModelProfile(rl, currentModel, cwd, (nextModel) => {
          currentModel = nextModel;
          prompt();
        });
        return;
      }

      if (text.startsWith('/model ')) {
        currentModel = text.slice(7).trim();
        console.log(`  ${FG_GREEN}✓${RST} ${FG_GRAY}Model → ${currentModel}${RST}`);
        printStatusBar(currentModel, cwd);
        return prompt();
      }

      if (text === '/clear') {
        messages = [{ role: 'system', content: getSystemPrompt() }];
        AUTO_APPROVE_SHELL = false;
        AUTO_APPROVE_FILE  = false;
        console.log(`  ${FG_GREEN}✓${RST} ${FG_GRAY}Conversation and approvals cleared${RST}\n`);
        return prompt();
      }

      if (text === '/compact' || text === '/cost') {
        const total = messages.reduce((s, m) => s + estimateTokens(m.content), 0);
        console.log(`  ${FG_GRAY}${messages.length - 1} messages · ~${total} tokens${RST}\n`);
        return prompt();
      }

      if (text === '/config') {
        console.log(`  ${FG_GRAY}${JSON.stringify(config, null, 2)}${RST}\n`);
        return prompt();
      }

      if (text === '/approve') {
        AUTO_APPROVE_SHELL = !AUTO_APPROVE_SHELL;
        AUTO_APPROVE_FILE  = !AUTO_APPROVE_FILE;
        const state = AUTO_APPROVE_SHELL ? 'ON' : 'OFF';
        const color = AUTO_APPROVE_SHELL ? FG_GREEN : FG_RED;
        console.log(`  ${color}●${RST} ${FG_GRAY}Auto-approve: ${state}${RST}\n`);
        return prompt();
      }

      if (text.startsWith('/shell ') || text.startsWith('!')) {
        const cmd = text.startsWith('/shell ') ? text.slice(7).trim() : text.slice(1).trim();
        await agentExecShell(cmd);
        return prompt();
      }

      messages.push({ role: 'user', content: text });
      console.log(`  ${FG_DARK}${'─'.repeat(Math.min(cols, 70) - 4)}${RST}`);

      rl.pause();
      isRunningAgent = true;
      messages = await runAgentLoop(messages, currentModel);
      isRunningAgent = false;
      rl.resume();

      console.log(`  ${FG_DARK}${'━'.repeat(Math.min(cols, 70) - 4)}${RST}`);
      console.log();

      prompt();
    });
  }

  prompt();
}

async function cmdCode(opts, promptArgs) {
  if (!promptArgs.length) {
    console.log(`  ${FG_RED}Usage: semalt-code code <prompt>${RST}`);
    return;
  }
  const userPrompt = promptArgs.join(' ');
  const context = opts.file ? readFileContext(opts.file) : '';
  const fullPrompt = context ? `Context files:\n${context}\n\nTask: ${userPrompt}` : userPrompt;

  let messages = [
    { role: 'system', content: getSystemPrompt() },
    { role: 'user', content: fullPrompt },
  ];
  messages = await runAgentLoop(messages, opts.model || config.default_model);
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
  const cfg = {
    api_base:      opts.apiBase      || 'http://127.0.0.1:8800',
    api_key:       opts.apiKey       || 'any',
    default_model: opts.defaultModel || 'default',
    temperature:   0.7,
    max_tokens:    4096,
    stream:        true,
    models:        config.models,
  };
  saveConfig(cfg);
  config = cfg;
  console.log(`\n  ${FG_GREEN}✓${RST} Config saved to ${CONFIG_PATH}`);
  console.log(`  ${FG_GRAY}${JSON.stringify(cfg, null, 2)}${RST}\n`);
}

// ── CLI arg parser ────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = {};
  const positional = [];
  let i = 0;
  while (i < argv.length) {
    switch (argv[i]) {
      case '-m': case '--model':         opts.model        = argv[++i]; break;
      case '-f': case '--file':          (opts.file = opts.file || []).push(argv[++i]); break;
      case '-a': case '--analyze':       opts.analyze      = true; break;
      case '--dry-run':                  opts.dryRun       = true; break;
      case '--api-base':                 opts.apiBase      = argv[++i]; break;
      case '--api-key':                  opts.apiKey       = argv[++i]; break;
      case '--default-model':            opts.defaultModel = argv[++i]; break;
      default: positional.push(argv[i]);
    }
    i++;
  }
  return { opts, positional };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const rawArgs = process.argv.slice(2);

  if (rawArgs.length === 0) {
    await cmdChat({});
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
    await cmdChat(opts);
  } else if (command === 'code') {
    const { opts, positional } = parseArgs(rawArgs.slice(1));
    await cmdCode(opts, positional);
  } else if (command === 'edit') {
    const { opts, positional } = parseArgs(rawArgs.slice(1));
    await cmdEdit(opts, positional[0], positional.slice(1));
  } else if (command === 'shell') {
    const { opts, positional } = parseArgs(rawArgs.slice(1));
    await cmdShell(opts, positional);
  } else if (command === 'models') {
    if (rawArgs[1] === 'add') await cmdModelsAdd();
    else await cmdModels();
  } else if (command === 'init') {
    const { opts } = parseArgs(rawArgs.slice(1));
    cmdInit(opts);
  } else {
    // Unknown command — treat all args as chat mode
    const { opts } = parseArgs(rawArgs);
    await cmdChat(opts);
  }
}

main().catch((e) => {
  process.stderr.write(`\n  ${FG_RED}✗ Fatal: ${e.message}${RST}\n\n`);
  process.exit(1);
});
