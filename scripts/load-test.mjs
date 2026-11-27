#!/usr/bin/env node
/**
 * ChatterRoom WebSocket relay load test (issue #31).
 *
 * Spawns a fresh relay server per tier, opens N WebSocket clients spread
 * across R rooms, has every client send encrypted-sized chat payloads at a
 * human-like rate, and measures:
 *   - fan-out latency (sender -> every other room member), p50/p95/p99/max
 *   - delivery ratio (received / expected)
 *   - server CPU % and RSS, plus load-generator CPU and RSS
 *
 * Realism: every simulated client connects from its own loopback address
 * (127.1.x.y), so the server's per-IP rate limiter treats each one as a
 * separate user. Nothing in the server is bypassed.
 *
 * Safety (Linux OOM): the server runs with a capped V8 heap, inside a
 * systemd user scope with MemoryMax when available, and with
 * oom_score_adj=1000 so the kernel would pick it before anything else.
 * A watchdog aborts the run if host MemAvailable drops below a floor or
 * either process grows past its cap.
 *
 * Usage:
 *   pnpm --filter server build
 *   node scripts/load-test.mjs [--tiers 50,100,500] [--rooms 20] [--duration 30]
 *   node scripts/load-test.mjs --help
 */

import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SERVER_DIR = path.join(ROOT, 'server');
// `ws` is a direct dependency of the server package; reuse it.
const WebSocket = createRequire(path.join(SERVER_DIR, 'package.json'))('ws');

// ---------------------------------------------------------------- options --

const DEFAULTS = {
  tiers: '50,100,500',
  rooms: 20,
  duration: 30, // seconds of measurement per tier
  warmup: 5, // seconds of traffic before measuring
  interval: 2000, // mean ms between messages per client (jittered 0.5x-1.5x)
  payload: 256, // plaintext-equivalent bytes of ciphertext per message
  port: 3901,
  url: '', // benchmark an already-running server instead of spawning one
  'server-heap': 512, // MB, V8 --max-old-space-size for the server
  'server-mem-cap': 768, // MB, server RSS cap (cgroup MemoryMax + watchdog)
  'loadgen-mem-cap': 1024, // MB, load generator RSS cap (watchdog)
  'min-free': 1024, // MB, abort if host MemAvailable falls below this
  'ramp-batch': 25, // connections opened concurrently while ramping
  'no-cgroup': false,
  out: 'bench-results',
};

const HELP = `Usage: node scripts/load-test.mjs [options]
${Object.entries(DEFAULTS)
  .map(([k, v]) => `  --${k.padEnd(16)} default: ${v === '' ? '(spawn server)' : v}`)
  .join('\n')}`;

const parseArgs = (argv) => {
  const opts = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') {
      console.log(HELP);
      process.exit(0);
    }
    if (!a.startsWith('--')) throw new Error(`Unexpected argument: ${a}`);
    const [key, inline] = a.slice(2).split('=');
    if (!(key in DEFAULTS)) throw new Error(`Unknown option --${key}\n${HELP}`);
    if (typeof DEFAULTS[key] === 'boolean') {
      opts[key] = true;
      continue;
    }
    const val = inline ?? argv[++i];
    opts[key] = typeof DEFAULTS[key] === 'number' ? Number(val) : val;
  }
  opts.tiers = String(opts.tiers).split(',').map(Number).filter(Boolean);
  return opts;
};

const opts = parseArgs(process.argv.slice(2));
const MB = 1024 * 1024;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[${new Date().toISOString().slice(11, 19)}]`, ...a);

// ------------------------------------------------------- /proc sampling --

const IS_LINUX = process.platform === 'linux';
const CLK_TCK = (() => {
  try {
    return Number(execFileSync('getconf', ['CLK_TCK']).toString().trim()) || 100;
  } catch {
    return 100;
  }
})();

const memAvailableMB = () => {
  if (!IS_LINUX) return os.freemem() / MB;
  const m = readFileSync('/proc/meminfo', 'utf8').match(/MemAvailable:\s+(\d+)/);
  return m ? Number(m[1]) / 1024 : os.freemem() / MB;
};

/** CPU seconds (user+sys) and RSS (MB) of a process, from /proc. */
const procStats = (pid) => {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const cpuSec = (Number(fields[11]) + Number(fields[12])) / CLK_TCK; // utime + stime
    const rss = readFileSync(`/proc/${pid}/status`, 'utf8').match(/VmRSS:\s+(\d+)/);
    return { cpuSec, rssMB: rss ? Number(rss[1]) / 1024 : 0 };
  } catch {
    return null; // process gone
  }
};

const fdSoftLimit = () => {
  try {
    const m = readFileSync('/proc/self/limits', 'utf8').match(/Max open files\s+(\d+)/);
    return m ? Number(m[1]) : Infinity;
  } catch {
    return Infinity;
  }
};

// Volunteer this process to the OOM killer before anything else on the box.
const raiseOomScore = (pid = 'self') => {
  try {
    writeFileSync(`/proc/${pid}/oom_score_adj`, '1000');
    return true;
  } catch {
    return false;
  }
};

// ------------------------------------------------------------- server --

let cgroupOk = null;
const canUseCgroup = () => {
  if (cgroupOk !== null) return cgroupOk;
  cgroupOk = false;
  if (!IS_LINUX || opts['no-cgroup']) return cgroupOk;
  try {
    execFileSync('systemd-run', ['--user', '--scope', '--quiet', '-p', 'MemoryMax=64M', 'true'], {
      stdio: 'ignore',
      timeout: 5000,
    });
    cgroupOk = true;
  } catch {
    /* no user systemd (container, WSL, macOS) */
  }
  return cgroupOk;
};

const startServer = async () => {
  const entry = path.join(SERVER_DIR, 'dist', 'index.js');
  if (!existsSync(entry)) {
    throw new Error(`Server build not found at ${entry}. Run: pnpm --filter server build`);
  }
  // sh wrapper: raise fd limit and oom_score_adj, then exec node (same pid).
  const inner = [
    'ulimit -n "$(ulimit -Hn)" 2>/dev/null',
    'echo 1000 > /proc/self/oom_score_adj 2>/dev/null',
    `exec "${process.execPath}" --max-old-space-size=${opts['server-heap']} "${entry}"`,
  ].join('; ');
  let cmd = 'sh';
  let args = ['-c', inner];
  const cgroup = canUseCgroup();
  if (cgroup) {
    args = [
      '--user', '--scope', '--quiet',
      '-p', `MemoryMax=${opts['server-mem-cap']}M`,
      '-p', 'MemorySwapMax=0',
      'sh', '-c', inner,
    ];
    cmd = 'systemd-run';
  }
  const child = spawn(cmd, args, {
    env: { ...process.env, PORT: String(opts.port), LOG_LEVEL: 'warn', NODE_ENV: 'production' },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (d) => (stderr += d));
  const url = `http://127.0.0.1:${opts.port}`;
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`Server exited early:\n${stderr}`);
    try {
      if ((await fetch(`${url}/health`)).ok) break;
    } catch {
      /* not up yet */
    }
    await sleep(100);
    if (i === 99) throw new Error('Server did not become healthy within 10s');
  }
  return { child, pid: child.pid, cgroup, wsUrl: `ws://127.0.0.1:${opts.port}/ws`, stderr: () => stderr };
};

const stopServer = async (srv) => {
  if (!srv || srv.child.exitCode !== null) return;
  srv.child.kill('SIGTERM');
  for (let i = 0; i < 30 && srv.child.exitCode === null; i++) await sleep(100);
  if (srv.child.exitCode === null) srv.child.kill('SIGKILL');
};

// ------------------------------------------------------------ helpers --

/** Unique loopback source address per client: 127.1.0.1, 127.1.0.2, ... */
const clientIp = (i) => `127.1.${Math.floor(i / 254)}.${(i % 254) + 1}`;

const percentile = (sorted, p) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] : NaN;

const round = (n, d = 2) => (Number.isFinite(n) ? Number(n.toFixed(d)) : null);

// --------------------------------------------------------------- tier --

const runTier = async (n, wsUrl, serverPid) => {
  const rooms = Array.from({ length: opts.rooms }, (_, r) => `bench-room-${r}`);
  const roomSize = new Map(rooms.map((r) => [r, 0]));
  const clients = [];
  const latencies = [];
  const connectMs = [];
  const counters = { sent: 0, expected: 0, received: 0, rateLimited: 0, connectFailed: 0, closedEarly: 0 };
  let measuring = false;
  let stopping = false;
  let abortReason = null;

  // Ciphertext-shaped filler, base64 like the real client sends.
  const ct = randomBytes(opts.payload + 16).toString('base64'); // +16 GCM tag
  const iv = randomBytes(12).toString('base64');

  // --- ramp up
  log(`tier ${n}: connecting ${n} clients across ${opts.rooms} rooms ...`);
  const rampStart = performance.now();
  const open = (i) =>
    new Promise((resolve) => {
      const room = rooms[i % rooms.length];
      const t0 = performance.now();
      const ws = new WebSocket(`${wsUrl}?room=${room}`, { localAddress: wsUrl.includes('127.0.0.1') ? clientIp(i) : undefined });
      const c = { i, ws, room, seq: 0, timer: null, open: false };
      ws.on('open', () => {
        c.open = true;
        connectMs.push(performance.now() - t0);
        roomSize.set(room, roomSize.get(room) + 1);
        clients.push(c);
        resolve();
      });
      ws.on('message', (raw) => {
        const s = raw.toString();
        if (s.charCodeAt(9) !== 99 /* 'c' of "chat" */) {
          if (s.includes('Rate limit')) counters.rateLimited++;
          return;
        }
        const msg = JSON.parse(s);
        if (msg.data?.m !== 1) return; // only count messages sent while measuring
        counters.received++;
        latencies.push(performance.now() - msg.data.t);
      });
      ws.on('error', () => {
        if (!c.open) {
          counters.connectFailed++;
          resolve();
        }
      });
      ws.on('close', () => {
        if (c.open && !stopping) counters.closedEarly++;
        c.open = false;
      });
    });
  for (let i = 0; i < n; i += opts['ramp-batch']) {
    const batch = [];
    for (let j = i; j < Math.min(n, i + opts['ramp-batch']); j++) batch.push(open(j));
    await Promise.all(batch);
  }
  const rampMs = performance.now() - rampStart;
  log(`tier ${n}: ${clients.length}/${n} connected in ${rampMs.toFixed(0)} ms`);

  // --- traffic
  const send = (c) => {
    if (stopping) return;
    if (c.open && c.ws.bufferedAmount < MB) {
      const m = measuring ? 1 : 0;
      c.ws.send(JSON.stringify({ type: 'chat', data: { iv, ct, s: c.i, n: c.seq++, t: performance.now(), m } }));
      if (m) {
        counters.sent++;
        counters.expected += roomSize.get(c.room) - 1;
      }
    }
    c.timer = setTimeout(send, opts.interval * (0.5 + Math.random()), c);
  };
  for (const c of clients) c.timer = setTimeout(send, Math.random() * opts.interval, c);

  // --- sampling + watchdog
  const samples = [];
  let prevServer = procStats(serverPid);
  let prevSelf = process.cpuUsage();
  let prevT = performance.now();
  const sample = () => {
    const now = performance.now();
    const dt = (now - prevT) / 1000;
    const srv = serverPid ? procStats(serverPid) : null;
    const selfCpu = process.cpuUsage();
    const s = {
      t: round((now - rampStart) / 1000, 1),
      measuring,
      serverCpuPct: srv && prevServer ? round(((srv.cpuSec - prevServer.cpuSec) / dt) * 100, 1) : null,
      serverRssMB: srv ? round(srv.rssMB, 1) : null,
      loadgenCpuPct: round(((selfCpu.user - prevSelf.user + selfCpu.system - prevSelf.system) / 1e6 / dt) * 100, 1),
      loadgenRssMB: round(process.memoryUsage.rss() / MB, 1),
      hostMemAvailMB: round(memAvailableMB(), 0),
    };
    samples.push(s);
    prevServer = srv;
    prevSelf = selfCpu;
    prevT = now;
    if (serverPid && !srv) abortReason = 'server process died';
    else if (s.hostMemAvailMB < opts['min-free']) abortReason = `host MemAvailable ${s.hostMemAvailMB} MB < --min-free ${opts['min-free']} MB`;
    else if (s.serverRssMB > opts['server-mem-cap']) abortReason = `server RSS ${s.serverRssMB} MB > cap ${opts['server-mem-cap']} MB`;
    else if (s.loadgenRssMB > opts['loadgen-mem-cap']) abortReason = `load generator RSS ${s.loadgenRssMB} MB > cap ${opts['loadgen-mem-cap']} MB`;
  };
  const sampler = setInterval(sample, 1000);

  const waitPhase = async (sec) => {
    const end = performance.now() + sec * 1000;
    while (performance.now() < end && !abortReason) await sleep(100);
  };
  await waitPhase(opts.warmup);
  measuring = true;
  const measureStart = performance.now();
  await waitPhase(opts.duration);
  measuring = false;
  const measuredSec = (performance.now() - measureStart) / 1000;
  await waitPhase(1); // let in-flight measured messages land

  // --- teardown
  stopping = true;
  clearInterval(sampler);
  for (const c of clients) {
    clearTimeout(c.timer);
    c.ws.terminate();
  }
  await sleep(500);

  const sorted = latencies.sort((a, b) => a - b);
  const m = samples.filter((s) => s.measuring);
  const avg = (k) => round(m.reduce((a, s) => a + (s[k] ?? 0), 0) / (m.length || 1), 1);
  const max = (k, from = m) => round(Math.max(0, ...from.map((s) => s[k] ?? 0)), 1);
  const sortedConnect = connectMs.sort((a, b) => a - b);

  return {
    clients: n,
    connected: clients.length,
    rooms: opts.rooms,
    clientsPerRoom: round(n / opts.rooms, 1),
    abortReason,
    rampMs: round(rampMs, 0),
    connectMs: { p50: round(percentile(sortedConnect, 50)), p95: round(percentile(sortedConnect, 95)), max: round(sortedConnect.at(-1)) },
    measuredSec: round(measuredSec, 1),
    messagesSent: counters.sent,
    msgsPerSec: round(counters.sent / measuredSec, 1),
    deliveriesPerSec: round(counters.received / measuredSec, 1),
    deliveryRatio: counters.expected ? round(counters.received / counters.expected, 4) : null,
    rateLimited: counters.rateLimited,
    connectFailed: counters.connectFailed,
    closedEarly: counters.closedEarly,
    latencyMs: {
      samples: sorted.length,
      p50: round(percentile(sorted, 50)),
      p95: round(percentile(sorted, 95)),
      p99: round(percentile(sorted, 99)),
      max: round(sorted.at(-1)),
      mean: round(sorted.reduce((a, b) => a + b, 0) / (sorted.length || 1)),
    },
    server: { cpuPctAvg: avg('serverCpuPct'), cpuPctMax: max('serverCpuPct'), rssMBAvg: avg('serverRssMB'), rssMBMax: max('serverRssMB', samples) },
    loadgen: { cpuPctAvg: avg('loadgenCpuPct'), cpuPctMax: max('loadgenCpuPct'), rssMBMax: max('loadgenRssMB', samples) },
    hostMemAvailMBMin: round(Math.min(...samples.map((s) => s.hostMemAvailMB)), 0),
    samples,
  };
};

// --------------------------------------------------------------- main --

const markdownTable = (results) => {
  const rows = [
    '| Clients | Per room | Msgs/s sent | Deliveries/s | Delivered | p50 ms | p95 ms | p99 ms | Max ms | Server CPU avg / max | Server RSS max | Load-gen CPU avg | Rate-limited |',
    '|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
  ];
  for (const r of results) {
    rows.push(
      `| ${r.connected}/${r.clients}${r.abortReason ? ' ⚠' : ''} | ${r.clientsPerRoom} | ${r.msgsPerSec} | ${r.deliveriesPerSec} | ${
        r.deliveryRatio === null ? 'n/a' : (r.deliveryRatio * 100).toFixed(2) + '%'
      } | ${r.latencyMs.p50} | ${r.latencyMs.p95} | ${r.latencyMs.p99} | ${r.latencyMs.max} | ${r.server.cpuPctAvg ?? 'n/a'}% / ${
        r.server.cpuPctMax ?? 'n/a'
      }% | ${r.server.rssMBMax ?? 'n/a'} MB | ${r.loadgen.cpuPctAvg}% | ${r.rateLimited} |`,
    );
  }
  return rows.join('\n');
};

const main = async () => {
  const maxTier = Math.max(...opts.tiers);
  if (!opts.url && maxTier > 254 * 255) throw new Error('Too many clients for unique loopback addresses');
  const fdLimit = fdSoftLimit();
  if (maxTier + 64 > fdLimit) {
    throw new Error(`Open-file limit ${fdLimit} is too low for ${maxTier} clients. Run \`ulimit -n 4096\` first.`);
  }
  if (memAvailableMB() < opts['min-free'] + 256) {
    throw new Error(`Only ${memAvailableMB().toFixed(0)} MB available; need --min-free (${opts['min-free']}) + 256 MB headroom.`);
  }
  const selfOom = IS_LINUX && raiseOomScore();

  const env = {
    date: new Date().toISOString(),
    host: os.hostname(),
    os: `${os.type()} ${os.release()}`,
    cpu: `${os.cpus()[0]?.model.trim()} x${os.cpus().length}`,
    totalMemMB: round(os.totalmem() / MB, 0),
    node: process.version,
    cgroupLimited: !opts.url && canUseCgroup(),
    oomScoreAdj: selfOom,
    options: { ...opts, tiers: opts.tiers.join(',') },
  };
  log(`host: ${env.cpu}, ${env.totalMemMB} MB RAM, ${env.node}`);
  log(`OOM guards: heap ${opts['server-heap']} MB, server cap ${opts['server-mem-cap']} MB (${env.cgroupLimited ? 'cgroup + watchdog' : 'watchdog only'}), host floor ${opts['min-free']} MB`);

  const results = [];
  let srv = null;
  const cleanup = async () => {
    await stopServer(srv);
    process.exit(130);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  for (const n of opts.tiers) {
    srv = opts.url ? null : await startServer();
    const wsUrl = opts.url || srv.wsUrl;
    await sleep(500);
    const idle = srv ? procStats(srv.pid) : null;
    try {
      const r = await runTier(n, wsUrl, srv?.pid);
      r.server.idleRssMB = idle ? round(idle.rssMB, 1) : null;
      results.push(r);
      log(
        `tier ${n}: p50 ${r.latencyMs.p50} ms, p99 ${r.latencyMs.p99} ms, delivered ${((r.deliveryRatio ?? 0) * 100).toFixed(2)}%, server CPU ${r.server.cpuPctAvg}% RSS ${r.server.rssMBMax} MB`,
      );
      if (r.abortReason) {
        log(`ABORTED: ${r.abortReason}. Skipping remaining tiers.`);
        break;
      }
    } finally {
      if (srv?.stderr().trim()) log(`server stderr:\n${srv.stderr().trim()}`);
      await stopServer(srv);
      srv = null;
    }
    await sleep(2000); // let the box settle between tiers
  }

  const outDir = path.resolve(ROOT, opts.out);
  mkdirSync(outDir, { recursive: true });
  const stamp = env.date.replace(/[:.]/g, '-');
  const jsonPath = path.join(outDir, `load-test-${stamp}.json`);
  writeFileSync(jsonPath, JSON.stringify({ env, results }, null, 2));
  const table = markdownTable(results);
  writeFileSync(path.join(outDir, `load-test-${stamp}.md`), `# Load test ${env.date}\n\n${env.cpu}, ${env.totalMemMB} MB RAM, ${env.node}\n\n${table}\n`);
  console.log(`\n${table}\n\nFull results: ${path.relative(ROOT, jsonPath)}`);
  process.exit(results.some((r) => r.abortReason) ? 2 : 0);
};

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
