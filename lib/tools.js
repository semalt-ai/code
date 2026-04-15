'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function createToolExecutor(permissionManager, ui) {
  const { FG_DARK, FG_GRAY, FG_GREEN, FG_RED, RST } = ui;

  async function agentExecShell(command) {
    const approved = await permissionManager.askPermission('shell', command);
    if (!approved) {
      return { exit_code: -1, stdout: '', stderr: 'Permission denied by user' };
    }

    console.log(`  ${FG_DARK}$ ${command}${RST}`);
    try {
      const result = spawnSync(command, { shell: true, encoding: 'utf8', timeout: 60000 });
      const stdout = result.stdout || '';
      const stderr = result.stderr || '';
      const combined = stdout + (stderr ? `\n${stderr}` : '');
      const lines = combined.trim().split('\n').filter((line) => line !== '');

      if (lines.length > 20) {
        lines.slice(0, 15).forEach((line) => console.log(`  ${FG_GRAY}${line}${RST}`));
        console.log(`  ${FG_DARK}... (${lines.length - 15} more lines)${RST}`);
      } else {
        lines.forEach((line) => console.log(`  ${FG_GRAY}${line}${RST}`));
      }
      console.log();

      return { exit_code: result.status ?? 0, stdout, stderr };
    } catch (error) {
      console.log(`  ${FG_RED}✗ ${error.message}${RST}`);
      return { exit_code: -1, stdout: '', stderr: error.message };
    }
  }

  async function agentExecFile(action, filePath, content = null) {
    if (action === 'read') {
      const approved = await permissionManager.askPermission('file', `Read ${filePath}`);
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
      } catch (error) {
        console.log(`  ${FG_RED}✗ ${error.message}${RST}`);
        return { error: error.message };
      }
    }

    if (action === 'write' || action === 'append') {
      let desc = `${action === 'write' ? 'Write' : 'Append to'} ${filePath}`;
      if (content) desc += ` (${content.length} chars)`;
      const approved = await permissionManager.askPermission('file', desc);
      if (!approved) return { error: 'Permission denied' };

      try {
        const dir = path.dirname(filePath);
        if (dir && dir !== '.') fs.mkdirSync(dir, { recursive: true });
        if (action === 'write') fs.writeFileSync(filePath, content || '');
        else fs.appendFileSync(filePath, content || '');
        const verb = action === 'write' ? 'Wrote' : 'Appended to';
        console.log(`  ${FG_GREEN}✓${RST} ${FG_GRAY}${verb} ${filePath}${RST}`);
        return { status: 'ok', path: filePath, bytes: (content || '').length };
      } catch (error) {
        console.log(`  ${FG_RED}✗ ${error.message}${RST}`);
        return { error: error.message };
      }
    }

    return { error: `Unknown action: ${action}` };
  }

  return {
    agentExecFile,
    agentExecShell,
  };
}

function extractToolCalls(text) {
  const calls = [];

  for (const match of text.matchAll(/```(?:shell|bash|sh)\n([\s\S]*?)```/g)) {
    for (const line of match[1].trim().split('\n')) {
      const cmd = line.trim();
      if (cmd && !cmd.startsWith('#')) calls.push(['shell', cmd]);
    }
  }

  for (const match of text.matchAll(/<shell>([\s\S]*?)<\/shell>/g)) {
    calls.push(['shell', match[1].trim()]);
  }

  for (const match of text.matchAll(/<exec>([\s\S]*?)<\/exec>/g)) {
    calls.push(['shell', match[1].trim()]);
  }

  for (const match of text.matchAll(/<read_file>([\s\S]*?)<\/read_file>/g)) {
    calls.push(['read', match[1].trim()]);
  }

  for (const match of text.matchAll(/<write_file\s+path="([^"]+)">([\s\S]*?)<\/write_file>/g)) {
    calls.push(['write', match[1], match[2]]);
  }

  return calls;
}

module.exports = {
  createToolExecutor,
  extractToolCalls,
};
