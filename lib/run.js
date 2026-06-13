import { spawn } from 'node:child_process';

/**
 * Run an agent locally by spawning a child process.
 * No daemon needed — just fork + exec.
 */
export async function runAgent(agentType, prompt, opts = {}) {
  const cwd = opts.cwd || process.cwd();

  if (agentType === 'hermes') {
    await runHermes(prompt, { cwd, model: opts.model, maxTurns: opts.maxTurns });
  } else if (agentType === 'claude') {
    await runClaude(prompt, { cwd });
  } else {
    console.error(`未知 agent 类型: ${agentType} (支持: hermes, claude)`);
    process.exit(1);
  }
}

async function runHermes(prompt, opts) {
  const home = process.env.HOME || '/home';
  const venv = `${home}/hermes-venv`;
  const acpBin = `${venv}/bin/acp`;

  // Check acp exists
  try {
    await import('node:fs').then(fs => fs.accessSync(acpBin, fs.constants.X_OK));
  } catch {
    throw new Error(`ACP 未找到: ${acpBin}\n请确保 hermes-venv 已安装 acp`);
  }

  const args = [];
  if (prompt) args.push('--prompt', prompt);
  args.push('--cwd', opts.cwd);

  console.log(`\n  启动 Hermes ACP...\n`);

  const child = spawn(acpBin, args, {
    cwd: opts.cwd,
    stdio: 'inherit',
    env: {
      ...process.env,
      PATH: `${venv}/bin:${process.env.PATH || ''}`,
    },
  });

  child.on('exit', (code) => {
    process.exit(code || 0);
  });
}

async function runClaude(prompt, opts) {
  const args = [];
  if (prompt) args.push('-p', prompt);
  console.log(`\n  启动 Claude Code...\n`);
  const child = spawn('claude', args, {
    cwd: opts.cwd,
    stdio: 'inherit',
  });
  child.on('exit', (code) => {
    process.exit(code || 0);
  });
}
