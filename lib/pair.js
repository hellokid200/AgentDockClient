import { get, post, generateKeyPair, generateMasterKey, boxEncrypt, signChallenge } from './util.js';
import { saveCredentials } from './util.js';
import nacl from 'tweetnacl';

const DEFAULT_SERVER = 'http://localhost:8080';
const POLL_INTERVAL = 1500;
const MAX_ATTEMPTS = 200;

/**
 * 发起配对（CLI 端）。
 *
 * 流程:
 *   1. POST /v1/pairing/request → 显示 PIN
 *   2. 轮询 GET /v1/pairing/status/{pubKey} 直到 state=authorized
 *   3. 用私钥解密 encryptedPayload 得到 masterSecret
 *   4. POST /v1/auth/challenge → POST /v1/auth/verify → 长期 token
 *   5. 保存凭据
 */
export async function initiatePair(serverUrl) {
  const server = (serverUrl || DEFAULT_SERVER).replace(/\/+$/, '');

  // 1. 生成密钥对
  const keyPair = nacl.box.keyPair();
  const pkRaw = keyPair.publicKey;
  const skRaw = keyPair.secretKey;
  const pkB64 = Buffer.from(pkRaw).toString('base64url');

  // 2. 创建配对请求
  const req = await post(`${server}/v1/pairing/request`, { publicKey: pkB64 });
  const pin = req.pin;

  console.log(`\n  ┌──────────────────────────────┐`);
  console.log(`  │  配对码: ${pin.padEnd(24)}  │`);
  console.log(`  └──────────────────────────────┘\n`);
  console.log(`  在 Web 控制台中输入此配对码`);
  console.log(`  Web 控制台: ${server.replace(/:8080/, ':8084')}/app\n`);

  // 3. 轮询等待 Web 端响应
  console.log('  等待 Web 端确认...');
  let attempts = 0;

  while (attempts < MAX_ATTEMPTS) {
    await sleep(POLL_INTERVAL);
    attempts++;

    try {
      const status = await get(`${server}/v1/pairing/status/${pkB64}`);

      if (status.state === 'authorized') {
        // Web 端已响应 — decryptedPayload 是 Web 用 CLI 公钥加密的 masterSecret
        const encPayloadB64 = status.encryptedPayload;
        const token = status.token;
        if (!encPayloadB64) throw new Error('服务端未返回 encryptedPayload');

        const masterKey = await decryptFromWeb(encPayloadB64, skRaw);

        // 4. Auth challenge → 长期 token
        const authResult = await performAuth(server, masterKey);

        // 5. 保存
        saveCredentials({
          serverUrl: server,
          token: authResult.token,
          masterKey,
          machineId: authResult.machineId || '',
          publicKey: pkB64,
        });

        console.log(`  ✓ 配对成功！令牌: ${authResult.token.slice(0, 16)}...`);
        return authResult;
      }

      if (status.state === 'expired') {
        throw new Error('配对请求已过期，请重新开始');
      }

      // still pending or exchange — keep waiting
      if (attempts % 40 === 0) {
        process.stderr.write(`  [${Math.round(attempts * POLL_INTERVAL / 1000)}s] 等待中...\n`);
      }

    } catch (e) {
      if (e.message.includes('expired')) throw e;
      // Network errors — keep trying
    }
  }

  throw new Error('配对超时（Web 端未在预期时间内响应）');
}

/**
 * 用 CLI 私钥解密 Web 端发来的 encryptedPayload。
 * NaCl box 格式: ephemeral_pk(32) + nonce(24) + ciphertext
 */
async function decryptFromWeb(encPayloadB64, mySecretKey) {
  const raw = Buffer.from(encPayloadB64, 'base64');
  if (raw.length < 56) throw new Error('encryptedPayload 太短');
  const epk = raw.subarray(0, 32);
  const nonce = raw.subarray(32, 56);
  const ct = raw.subarray(56);

  const shared = nacl.box.before(epk, mySecretKey);
  const opened = nacl.secretbox.open(ct, nonce, shared);
  if (!opened) throw new Error('解密失败 — 密钥不匹配');

  return Buffer.from(opened).toString('base64');
}

/**
 * Auth challenge → 获取长期令牌。
 */
async function performAuth(server, masterKeyB64) {
  const challenge = await post(`${server}/v1/auth/challenge`, {});
  const signed = signChallenge(challenge.nonce, masterKeyB64);
  const verify = await post(`${server}/v1/auth/verify`, {
    publicKey: signed.publicKey,
    nonce: challenge.nonce,
    signature: signed.signature,
  });
  return verify;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
