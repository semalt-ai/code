'use strict';

function createPermissionManager(ui) {
  const { BOLD, FG_CYAN, FG_DARK, FG_GRAY, FG_GREEN, FG_RED, FG_YELLOW, RST, readInteractiveInput } = ui;
  const state = {
    autoApproveShell: false,
    autoApproveFile: false,
  };

  function askPermissionLine(actionType) {
    return actionType === 'shell'
      ? '  1. Yes  2. Yes, always for shell  3. No'
      : '  1. Yes  2. Yes, always for files  3. No';
  }

  function readPermissionChoice() {
    return readInteractiveInput(`  ${FG_YELLOW}?${RST} `, {
      allowed: ['1', '2', '3'],
      immediate: true,
      trim: true,
    });
  }

  function askPermission(actionType, description) {
    return new Promise((resolve) => {
      if (actionType === 'shell' && state.autoApproveShell) {
        console.log(`  ${FG_GREEN}✓${RST} ${FG_DARK}Auto-approved: ${description}${RST}`);
        resolve(true);
        return;
      }

      if (actionType === 'file' && state.autoApproveFile) {
        console.log(`  ${FG_GREEN}✓${RST} ${FG_DARK}Auto-approved: ${description}${RST}`);
        resolve(true);
        return;
      }

      console.log();
      console.log(`  ${FG_YELLOW}${BOLD}⚠ Permission required${RST}`);
      console.log(`  ${FG_GRAY}${actionType}: ${description}${RST}`);
      console.log();
      console.log(`  ${FG_CYAN}${askPermissionLine(actionType)}${RST}`);
      console.log();

      readPermissionChoice().then((result) => {
        if (result.type === 'sigint' || result.type === 'eof') {
          console.log(`  ${FG_RED}✗${RST} ${FG_DARK}Denied${RST}`);
          resolve(false);
          return;
        }

        const choice = (result.value || '').trim().toLowerCase();
        if (choice === '1' || choice === 'y' || choice === 'yes') {
          resolve(true);
          return;
        }

        if (choice === '2' || choice === 'a' || choice === 'always') {
          if (actionType === 'shell') state.autoApproveShell = true;
          else state.autoApproveFile = true;
          console.log(`  ${FG_GREEN}✓${RST} ${FG_DARK}Auto-approve enabled for ${actionType} operations${RST}`);
          resolve(true);
          return;
        }

        console.log(`  ${FG_RED}✗${RST} ${FG_DARK}Denied${RST}`);
        resolve(false);
      });
    });
  }

  function clear() {
    state.autoApproveShell = false;
    state.autoApproveFile = false;
  }

  function toggleAll() {
    state.autoApproveShell = !state.autoApproveShell;
    state.autoApproveFile = !state.autoApproveFile;
    return state.autoApproveShell;
  }

  return {
    askPermission,
    clear,
    state,
    toggleAll,
  };
}

module.exports = {
  createPermissionManager,
};
