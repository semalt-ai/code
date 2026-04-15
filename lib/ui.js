'use strict';

const readline = require('readline');

function getCols() {
  return process.stdout.columns || 80;
}

const RST = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

const FG_GRAY = '\x1b[38;5;245m';
const FG_DARK = '\x1b[38;5;240m';
const FG_BLUE = '\x1b[38;5;75m';
const FG_CYAN = '\x1b[38;5;116m';
const FG_GREEN = '\x1b[38;5;114m';
const FG_YELLOW = '\x1b[38;5;222m';
const FG_RED = '\x1b[38;5;203m';
const FG_TEAL = '\x1b[38;5;73m';

const BOX_H = '─';
const BOX_V = '│';
const BOX_TL = '╭';
const BOX_TR = '╮';
const BOX_BL = '╰';
const BOX_BR = '╯';

const FG_CODE_BG = '\x1b[48;5;236m';
const FG_CODE_BORDER = '\x1b[38;5;240m';
const FG_CODE_LANG = '\x1b[38;5;75m';
const FG_INLINE_CODE = '\x1b[38;5;215m';
const FG_HEADING = '\x1b[38;5;75m';
const FG_BULLET = '\x1b[38;5;114m';
const FG_BOLD_TEXT = '\x1b[38;5;255m';
const FG_DIFF_ADD = '\x1b[38;5;114m';
const FG_DIFF_DEL = '\x1b[38;5;203m';
const FG_DIFF_HDR = '\x1b[38;5;75m';
const FG_FILEPATH = '\x1b[38;5;222m';
const FG_TAG = '\x1b[38;5;176m';

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

function insertCharAt(text, index, value) {
  const chars = Array.from(text || '');
  chars.splice(index, 0, value);
  return chars.join('');
}

function removeCharAt(text, index) {
  const chars = Array.from(text || '');
  chars.splice(index, 1);
  return chars.join('');
}

function isPrintableKey(str, key = {}) {
  if (!str || key.ctrl || key.meta) return false;
  if (key.name === 'return' || key.name === 'enter' || key.name === 'tab') return false;
  if (key.name && ['up', 'down', 'left', 'right', 'home', 'end', 'pageup', 'pagedown', 'escape', 'delete', 'backspace'].includes(key.name)) {
    return false;
  }
  return !/[\x00-\x1f\x7f]/.test(str);
}

function readInteractiveInput(promptText, options = {}) {
  const {
    allowed = null,
    immediate = false,
    trim = false,
    allowCursorNavigation = false,
  } = options;

  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question(promptText, (answer) => {
        rl.close();
        resolve({ type: 'submit', value: trim ? (answer || '').trim() : (answer || '') });
      });
      return;
    }

    const wasRaw = typeof process.stdin.isRaw === 'boolean' ? process.stdin.isRaw : false;
    let buffer = '';
    let cursor = 0;
    let done = false;

    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();

    const render = () => {
      readline.cursorTo(process.stdout, 0);
      readline.clearLine(process.stdout, 0);
      process.stdout.write(`${promptText}${buffer}`);
      const promptWidth = stripAnsi(promptText).length;
      readline.cursorTo(process.stdout, promptWidth + cursor);
    };

    const finish = (result, addNewline = true) => {
      if (done) return;
      done = true;
      process.stdin.setRawMode(wasRaw);
      process.stdin.removeListener('keypress', onKeypress);
      if (addNewline) process.stdout.write('\n');
      resolve(result);
    };

    const onKeypress = (str, key = {}) => {
      if (key.ctrl && key.name === 'c') {
        if (buffer) {
          buffer = '';
          cursor = 0;
          render();
          return;
        }
        finish({ type: 'sigint' }, false);
        return;
      }

      if (key.ctrl && key.name === 'd') {
        if (!buffer) finish({ type: 'eof' }, false);
        return;
      }

      if (key.name === 'return' || key.name === 'enter') {
        finish({ type: 'submit', value: trim ? buffer.trim() : buffer });
        return;
      }

      if (key.name === 'backspace' || key.name === 'delete') {
        if (key.name === 'backspace' && cursor > 0) {
          buffer = removeCharAt(buffer, cursor - 1);
          cursor--;
          render();
        } else if (key.name === 'delete' && cursor < Array.from(buffer).length) {
          buffer = removeCharAt(buffer, cursor);
          render();
        }
        return;
      }

      if (allowCursorNavigation && key.name === 'left') {
        if (cursor > 0) {
          cursor--;
          render();
        }
        return;
      }

      if (allowCursorNavigation && key.name === 'right') {
        if (cursor < Array.from(buffer).length) {
          cursor++;
          render();
        }
        return;
      }

      if (allowCursorNavigation && key.name === 'home') {
        cursor = 0;
        render();
        return;
      }

      if (allowCursorNavigation && key.name === 'end') {
        cursor = Array.from(buffer).length;
        render();
        return;
      }

      if (key.name && ['up', 'down', 'left', 'right', 'home', 'end', 'pageup', 'pagedown', 'escape', 'tab'].includes(key.name)) {
        return;
      }

      if (!isPrintableKey(str, key)) return;
      if (allowed && !allowed.includes(str)) return;

      if (immediate) {
        buffer = str;
        cursor = Array.from(buffer).length;
        render();
        finish({ type: 'submit', value: str });
        return;
      }

      buffer = insertCharAt(buffer, cursor, str);
      cursor++;
      render();
    };

    process.stdin.on('keypress', onKeypress);
    render();
  });
}

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

    if (line.trim() === '```' && this.inCodeBlock) {
      process.stdout.write(`  ${FG_CODE_BORDER}╰${'─'.repeat(50)}${RST}\n`);
      this.inCodeBlock = false;
      return;
    }

    if (this.inCodeBlock) {
      process.stdout.write(`  ${FG_CODE_BORDER}│${RST} ${FG_CODE_BG}${this._colorizeCode(line)}${RST}\n`);
      return;
    }

    if (/^\+(?!\+\+)/.test(line)) {
      process.stdout.write(`  ${FG_DIFF_ADD}${line}${RST}\n`);
      return;
    }
    if (/^-(?!--)/.test(line)) {
      process.stdout.write(`  ${FG_DIFF_DEL}${line}${RST}\n`);
      return;
    }
    if (line.startsWith('@@')) {
      process.stdout.write(`  ${FG_DIFF_HDR}${line}${RST}\n`);
      return;
    }
    if (/^<(exec|shell|read_file|write_file)/.test(line)) {
      process.stdout.write(`  ${FG_TAG}${line}${RST}\n`);
      return;
    }
    if (/^<\/(exec|shell|read_file|write_file)/.test(line)) {
      process.stdout.write(`  ${FG_TAG}${line}${RST}\n`);
      return;
    }

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

    const bm = line.match(/^(\s*)([-*•])\s+(.*)/);
    if (bm) {
      process.stdout.write(`  ${bm[1]}${FG_BULLET}•${RST} ${this._inlineFormat(bm[3])}\n`);
      return;
    }

    const nm = line.match(/^(\s*)(\d+\.)\s+(.*)/);
    if (nm) {
      process.stdout.write(`  ${nm[1]}${FG_CYAN}${nm[2]}${RST} ${this._inlineFormat(nm[3])}\n`);
      return;
    }

    process.stdout.write(`  ${this._inlineFormat(line)}\n`);
  }

  _inlineFormat(text) {
    text = text.replace(/\*\*(.+?)\*\*/g, `${FG_BOLD_TEXT}${BOLD}$1${RST}`);
    text = text.replace(/`([^`]+)`/g, `${FG_INLINE_CODE}$1${RST}`);
    text = text.replace(/(?<!\w)((?:\/[\w\-.]+)+(?:\.\w+)?)/g, `${FG_FILEPATH}$1${RST}`);
    return text;
  }

  _colorizeCode(line) {
    const C_KW = '\x1b[38;5;176m';
    const C_STR = '\x1b[38;5;114m';
    const C_CMT = '\x1b[38;5;242m';
    const C_NUM = '\x1b[38;5;215m';
    const C_RST = `${RST}${FG_CODE_BG}`;

    let result = '';
    let i = 0;

    while (i < line.length) {
      if (line[i] === '#' || (line[i] === '/' && line[i + 1] === '/')) {
        result += `${C_CMT}${line.slice(i)}${C_RST}`;
        break;
      }

      if (line[i] === '"' || line[i] === "'") {
        const quote = line[i];
        let j = i + 1;
        while (j < line.length && line[j] !== quote) {
          if (line[j] === '\\') j++;
          j++;
        }
        j = Math.min(j + 1, line.length);
        result += `${C_STR}${line.slice(i, j)}${C_RST}`;
        i = j;
        continue;
      }

      if (/[a-zA-Z_]/.test(line[i])) {
        let j = i;
        while (j < line.length && /\w/.test(line[j])) j++;
        const word = line.slice(i, j);
        result += KEYWORDS.has(word) ? `${C_KW}${word}${C_RST}` : word;
        i = j;
        continue;
      }

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
  const left = `${FG_TEAL}${BOLD}◆${RST} ${FG_GRAY}${model}${RST}`;
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

module.exports = {
  BOLD,
  DIM,
  FG_BLUE,
  FG_CYAN,
  FG_DARK,
  FG_GRAY,
  FG_GREEN,
  FG_RED,
  FG_TEAL,
  FG_YELLOW,
  RST,
  StreamRenderer,
  getCols,
  hr,
  printBanner,
  printHelpHints,
  printStatusBar,
  readInteractiveInput,
  stripAnsi,
};
