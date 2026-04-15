'use strict';

function parseArgs(argv) {
  const opts = {};
  const positional = [];
  let i = 0;

  while (i < argv.length) {
    switch (argv[i]) {
      case '-m':
      case '--model':
        opts.model = argv[++i];
        break;
      case '-f':
      case '--file':
        (opts.file = opts.file || []).push(argv[++i]);
        break;
      case '-a':
      case '--analyze':
        opts.analyze = true;
        break;
      case '--dry-run':
        opts.dryRun = true;
        break;
      case '--api-base':
        opts.apiBase = argv[++i];
        break;
      case '--api-key':
        opts.apiKey = argv[++i];
        break;
      case '--default-model':
        opts.defaultModel = argv[++i];
        break;
      default:
        positional.push(argv[i]);
    }
    i++;
  }

  return { opts, positional };
}

module.exports = {
  parseArgs,
};
