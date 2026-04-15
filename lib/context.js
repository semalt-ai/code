'use strict';

const fs = require('fs');
const path = require('path');

function readFileContext(filePaths, ui) {
  const { FG_GRAY, FG_GREEN, FG_RED, RST } = ui;
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
      } catch (error) {
        console.log(`  ${FG_RED}✗${RST} ${FG_GRAY}${fp}: ${error.message}${RST}`);
      }
      continue;
    }

    if (stat.isDirectory()) {
      let count = 0;
      function walkDir(dir) {
        if (count >= 50) return;
        let entries;
        try {
          entries = fs.readdirSync(dir).sort();
        } catch {
          return;
        }

        for (const entry of entries) {
          if (entry.startsWith('.')) continue;
          const full = path.join(dir, entry);
          let childStat;
          try {
            childStat = fs.statSync(full);
          } catch {
            continue;
          }

          if (childStat.isFile()) {
            try {
              const content = fs.readFileSync(full, 'utf8').slice(0, 10000);
              context += `\n--- File: ${full} ---\n${content}\n`;
              count++;
            } catch {}
          } else if (childStat.isDirectory()) {
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

module.exports = {
  readFileContext,
};
