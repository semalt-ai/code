'use strict';

const http = require('http');
const https = require('https');
const { URL } = require('url');

function createApiClient({ getConfig, saveConfig, ui }) {
  const {
    BOLD,
    DIM,
    FG_DARK,
    FG_GRAY,
    FG_GREEN,
    FG_RED,
    FG_TEAL,
    RST,
    StreamRenderer,
    getCols,
    printStatusBar,
  } = ui;

  function apiUrl(urlPath) {
    const config = getConfig();
    const base = (config.api_base || '').replace(/\/$/, '');
    const normalizedBase = /\/v1$/i.test(base) ? base : `${base}/v1`;
    const normalizedPath = urlPath.startsWith('/v1/') ? urlPath.slice(3) : urlPath;
    return `${normalizedBase}${normalizedPath}`;
  }

  function describeModelProfile(profile) {
    return `${profile.model} @ ${profile.api_base}`;
  }

  function setActiveModelProfile(profile) {
    const config = getConfig();
    config.api_base = profile.api_base;
    config.api_key = profile.api_key;
    config.default_model = profile.model;
    saveConfig(config);
  }

  function chooseSavedModelProfile(rl, currentModel, cwd, onDone) {
    const config = getConfig();
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
      console.log(`  ${marker} ${ui.FG_CYAN}${index + 1}.${RST} ${describeModelProfile(profile)}`);
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

      const req = lib.request(reqOpts, (res) => resolve(res));
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
    const config = getConfig();
    const payload = {
      model: model || config.default_model,
      messages,
      temperature: temperature !== undefined ? temperature : config.temperature,
      stream: true,
    };

    if (maxTokens !== undefined) payload.max_tokens = maxTokens;

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
    } catch (error) {
      process.stdout.write(`\n  ${FG_RED}✗ ${error.message}${RST}\n`);
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

      res.on('error', (error) => {
        process.stdout.write(`\n  ${FG_RED}✗ ${error.message}${RST}\n`);
        resolve('');
      });
    });
  }

  async function chatSync(messages, { model } = {}) {
    const config = getConfig();
    const payload = {
      model: model || config.default_model,
      messages,
      temperature: config.temperature,
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
    } catch (error) {
      console.log(`  ${FG_RED}✗ ${error.message}${RST}`);
      return '';
    }

    return new Promise((resolve) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          console.log(`  ${FG_RED}✗ Error: HTTP ${res.statusCode} — ${data}${RST}`);
          resolve('');
          return;
        }

        try {
          const parsed = JSON.parse(data);
          const content = parsed.choices[0].message.content;
          console.log(content);
          resolve(content);
        } catch (error) {
          console.log(`  ${FG_RED}✗ Parse error: ${error.message}${RST}`);
          resolve('');
        }
      });
      res.on('error', (error) => {
        console.log(`  ${FG_RED}✗ ${error.message}${RST}`);
        resolve('');
      });
    });
  }

  return {
    chatStream,
    chatSync,
    chooseSavedModelProfile,
    describeModelProfile,
    estimateTokens,
    setActiveModelProfile,
  };
}

module.exports = {
  createApiClient,
};
