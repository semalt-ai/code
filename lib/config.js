'use strict';

const fs = require('fs');
const path = require('path');

const { CONFIG_PATH, DEFAULT_CONFIG } = require('./constants');

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

module.exports = {
  loadConfig,
  normalizeConfig,
  saveConfig,
};
