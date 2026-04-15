'use strict';

function createAgentRunner({ chatStream, extractToolCalls, agentExecShell, agentExecFile, ui }) {
  const { BOLD, FG_DARK, FG_GRAY, FG_TEAL, FG_YELLOW, RST, getCols } = ui;

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
            if (result.stderr) out += `\nSTDERR: ${result.stderr}`;
            results.push(`Command \`${call[1]}\`:\nExit code: ${result.exit_code}\n${out}`);
          }
          continue;
        }

        if (call[0] === 'read') {
          const result = await agentExecFile('read', call[1]);
          if (result.error) results.push(`Read ${call[1]}: Error — ${result.error}`);
          else results.push(`File ${call[1]}:\n${result.content}`);
          continue;
        }

        if (call[0] === 'write') {
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

  return {
    runAgentLoop,
  };
}

module.exports = {
  createAgentRunner,
};
