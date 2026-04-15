'use strict';

const os = require('os');
const path = require('path');

const PACKAGE_JSON = require('../package.json');

const DEFAULT_API_TIMEOUT_MS = 15 * 60 * 1000;

const DEFAULT_CONFIG = {
  api_base: 'http://127.0.0.1:8800',
  api_key: 'any',
  default_model: 'default',
  temperature: 0.7,
  request_timeout_ms: DEFAULT_API_TIMEOUT_MS,
  stream: true,
  models: [],
};

const CONFIG_PATH = path.join(os.homedir(), '.semalt-ai', 'config.json');

module.exports = {
  CONFIG_PATH,
  DEFAULT_API_TIMEOUT_MS,
  DEFAULT_CONFIG,
  PACKAGE_JSON,
};
