#!/usr/bin/env node

process.env.PATH = [
  process.env.HOME + '/.npm-global/bin',
  process.env.HOME + '/.local/bin',
  process.env.HOME + '/hermes-venv/bin',
  process.env.PATH || '',
].join(':');

const { readFileSync } = await import('node:fs');
const { dirname, join } = await import('node:path');
const { fileURLToPath } = await import('node:url');

const __dirname = typeof import.meta.dirname !== 'undefined' ? import.meta.dirname : dirname(fileURLToPath(import.meta.url));
const PROJ_DIR = join(__dirname, '..');
const pkg = JSON.parse(readFileSync(join(PROJ_DIR, 'package.json'), 'utf-8'));

const [, , cmd, ...args] = process.argv;

function help() {
  console.log(`
  adclient v${pkg.version} — 远程 AI Agent 客户端

  用法:
    adclient pair [--server <url>]    配对（交互式生成 PIN）
    adclient pair-pin <PIN>            用 PIN 码直接配对
    adclient run <agent> [prompt]      运行 agent (hermes | claude)
    adclient status                    查看状态
    adclient unpair                    清除凭证

  选项:
    --server <url>    服务器地址（默认 http://localhost:8080）
    --cwd <path>      工作目录
    --model <name>    模型名称
    --max-turns <n>   最大轮次

  示例:
    adclient pair --server http://localhost:8080
    adclient run hermes "写一个 Python 脚本"
    adclient status
`);
}

async function main() {
  switch (cmd) {
    case 'pair': {
      const { initiatePair, pairDirect } = await import('../lib/pair.js');
      const serverUrl = parseOpt(args, '--server') || 'http://localhost:8080';
      const pin = parseOpt(args, '--pin') || '';
      if (pin) {
        await pairDirect(serverUrl, pin);
      } else {
        await initiatePair(serverUrl);
      }
      break;
    }
    case 'pair-pin': {
      const { pairDirect } = await import('../lib/pair.js');
      const serverUrl = parseOpt(args, '--server') || 'http://localhost:8080';
      const pin = args[0];
      if (!pin || pin.startsWith('--')) throw new Error('Usage: adclient pair-pin <PIN> [--server <url>]');
      await pairDirect(serverUrl, pin);
      break;
    }
    case 'run': {
      const { runAgent } = await import('../lib/run.js');
      const agentType = args[0] || 'hermes';
      if (agentType.startsWith('--')) throw new Error('Usage: adclient run <agent> [prompt]');
      const prompt = args.slice(1).filter(a => !a.startsWith('--')).join(' ') || '';
      await runAgent(agentType, prompt, {
        cwd: parseOpt(args, '--cwd'),
        model: parseOpt(args, '--model'),
        maxTurns: parseOpt(args, '--max-turns'),
      });
      break;
    }
    case 'status': {
      const { loadCredentials, get } = await import('../lib/util.js');
      const creds = loadCredentials();
      if (!creds) { console.log('  未配对。运行 `adclient pair` 开始配对。'); process.exit(0); }
      const server = creds.serverUrl;
      try {
        const health = await get(`${server}/v1/health`, { token: creds.token });
        console.log(`  Server: ${server}`);
        console.log(`  Protocol: v${health.protocolVersion}`);
        console.log(`  Connected machines: ${health.connectedMachines || 0}`);
        const machines = await get(`${server}/v1/machines`, { token: creds.token });
        if (machines.machines?.length) {
          for (const m of machines.machines) {
            console.log(`  Machine: ${m.hostname || m.id} ${m.active ? '🟢 online' : '🔴 offline'}`);
          }
        }
        console.log(`  Token: ${creds.token.slice(0, 16)}...`);
        console.log(`  Machine ID: ${creds.machineId || 'unknown'}`);
      } catch (e) {
        console.error(`  Error: ${e.message}`);
      }
      break;
    }
    case 'unpair': {
      const { unlinkSync, existsSync } = await import('node:fs');
      const { join } = await import('node:path');
      const credsPath = join(process.env.HOME || '/tmp', '.adclient', 'credentials.json');
      if (existsSync(credsPath)) {
        unlinkSync(credsPath);
        console.log('  凭证已清除');
      } else {
        console.log('  未找到凭证');
      }
      break;
    }
    default:
      help();
  }
}

function parseOpt(args, name) {
  const idx = args.indexOf(name);
  if (idx >= 0 && idx + 1 < args.length) return args[idx + 1];
  return undefined;
}

main().catch(e => {
  console.error(`\n  Error: ${e.message}\n`);
  process.exit(1);
});
