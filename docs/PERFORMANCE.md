# Performance: WebSocket Relay Load Benchmark

Benchmarks for the ChatterRoom relay server (`server/`) under concurrent WebSocket load, from issue #31.

**Summary:** On a 2-core Celeron home server, the relay handled **500 concurrent connections across 20 rooms** (25 per room, about 6,000 message deliveries per second). It delivered **100% of messages** with **1.8 ms median and 5.6 ms p99** fan-out latency, at **25% of one core** and **under 100 MB RSS**. Memory grows by roughly **28 KB per connection**.

## Results

Run on 2026-11-25. Each tier starts a fresh server, then runs a 5 s warmup and a 30 s measurement window.

> These numbers predate the heartbeat (#42) and `RoomManager` (#43) changes on `main`. A short smoke run on current `main` (20 clients) still delivered 100% at 1.1 ms p50. A full re-run on the same hardware is pending.

| Clients | Per room | Msgs/s sent | Deliveries/s | Delivered | p50 ms | p95 ms | p99 ms | Max ms | Server CPU avg / max | Server RSS max | Load-gen CPU avg | Rate-limited |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 50 | 2.5 | 25.0 | 39.9 | 100.00% | 1.28 | 1.78 | 2.81 | 7.08 | 2.8% / 11% | 86.9 MB | 3.6% | 0 |
| 100 | 5 | 49.8 | 199.1 | 100.00% | 1.17 | 1.67 | 2.36 | 6.32 | 5.2% / 15% | 90.8 MB | 5.2% | 0 |
| 500 | 25 | 248.0 | 5,952.9 | 100.00% | 1.81 | 4.02 | 5.64 | 17.51 | 24.8% / 28% | 99.5 MB | 38.6% | 0 |

Additional figures:

| Clients | Ramp-up (all connected) | Connect p50 / p95 | Latency samples | Server idle RSS | Connect failures / early closes |
|---:|---:|---:|---:|---:|---:|
| 50 | 125 ms | 46 / 57 ms | 1,199 | 85.6 MB | 0 / 0 |
| 100 | 164 ms | 25 / 39 ms | 5,980 | 86.7 MB | 0 / 0 |
| 500 | 835 ms | 22 / 42 ms | 179,160 | 85.6 MB | 0 / 0 |

CPU percentages are of a single core (100% = one core fully busy).

### Test machine

| | |
|---|---|
| Host | Home server ("homelab"), dedicated, no desktop workload |
| CPU | Intel Celeron 2950M @ 2.00 GHz, 2 cores |
| RAM | 5.8 GB (at least 3.7 GB available throughout the run, no swap used) |
| OS | Fedora 45, Linux 7.3.4 |
| Node.js | v22.22.2 |
| Server | `server/dist` built with `tsc`, `LOG_LEVEL=warn`, `NODE_ENV=production` |

## Observations

- **Throughput scales with room size, not connection count.** Each message is fanned out to every other member of its room, so deliveries per second grow with clients × (room size − 1). Going from 100 to 500 clients is 5× the senders but 30× the deliveries (199 to 5,953 per second). Server CPU rose about 5× (5.2% to 24.8%), so per-delivery cost actually fell as rooms filled up.
- **Latency stays low.** p99 went from 2.4 ms to 5.6 ms at 500 clients. That number is pessimistic: the load generator ran on the same 2 cores and used 38.6% CPU at the top tier, so some of the latency is the generator competing with the server.
- **Memory is flat.** RSS rose from 85.6 MB idle to 99.5 MB at 500 connections, about 28 KB per connection. No memory guard came close to firing.
- **The rate limiter isn't hit by normal chat rates.** Each client sends one message every 1 to 3 seconds (about 5 per 10 s against a 30 per 10 s limit). With each client on its own IP, zero messages were limited. A short sanity run in a dev sandbox (50 clients, 5 messages per second each, 12 s window; `--tiers 50 --interval 200 --warmup 1 --duration 12`) did trip the limiter, with 66.5% delivered and 1,015 rate-limit replies. At steady state the expected rejection rate is 40% (20 of every 50 messages per 10 s). The short run rejected less because it crossed a window reset: the second 10 s window was only about 3 s old when measurement ended, so its quota wasn't used up yet.
- **Headroom.** At 500 clients the server used a quarter of one core. A rough extrapolation, not measured, puts this hardware at a few thousand concurrent clients at this room size before CPU becomes the limit. Testing that needs the load generator on a separate machine (see below).

## Methodology

The benchmark is `scripts/load-test.mjs`. It has no dependencies beyond `ws`, which it borrows from `server/`.

1. **Server.** A fresh relay is started per tier from `server/dist/index.js`, so tiers don't share state.
2. **Clients.** N `ws` clients connect to `/ws?room=bench-room-<k>` round-robin over 20 rooms, opened in batches of 25.
3. **Realistic per-user IPs.** Each client binds to its own loopback source address (`127.1.x.y`) via `localAddress`. The server sees a distinct `req.ip` per client, so the real per-IP rate limiter (`server/src/middleware/rate-limiter.ts`) applies unchanged. Nothing in the server is bypassed or patched for the test.
4. **Traffic.** Every client sends `{type:"chat", data:{iv, ct, ...}}` with a base64 12-byte IV and 272 bytes of random "ciphertext" (256 B payload plus 16 B GCM tag). That matches the shape the real client sends after AES-256-GCM encryption. The interval is 2 s ± 50% jitter.
5. **Latency.** The send timestamp travels in the message. Every other room member records `receive − send`, which is the full fan-out path: client to server, JSON parse, broadcast, and server to each receiver. Sender and receivers share one clock (same process), so no clock sync is needed. Only messages sent inside the 30 s window are counted.
6. **Delivery ratio.** Received deliveries divided by expected deliveries (the sum of room size − 1 over messages sent).
7. **CPU and RAM.** Sampled once per second from `/proc/<pid>/stat` and `/proc/<pid>/status` for the server, and `process.cpuUsage()` and RSS for the load generator. Host `MemAvailable` comes from `/proc/meminfo`. The per-second series is saved in the JSON output.

### Linux OOM safety

The benchmark is built so it can't take down the machine it runs on:

- The server runs with `--max-old-space-size=512`.
- When `systemd-run --user` is available, the server runs in a transient scope with `MemoryMax=768M` and `MemorySwapMax=0`. Only that cgroup is killed if it overruns.
- Both the server and the load generator set `oom_score_adj=1000`, so if the kernel OOM killer ever runs it picks the benchmark before anything else.
- A once-per-second watchdog aborts the run and kills the server if host `MemAvailable` drops below 1 GB, if the server goes over 768 MB, or if the load generator goes over 1 GB.
- Preflight refuses to start if the open-file limit is too low or the host has less than 1.25 GB available.

## Reproducing

```bash
pnpm install
ulimit -n 4096          # only needed above ~950 clients; the default 1024 covers 500
pnpm bench              # builds the server, runs tiers 50,100,500
```

Results go to `bench-results/load-test-<timestamp>.json` (full data, including per-second samples) and `.md` (table). The folder is gitignored.

Useful options (`node scripts/load-test.mjs --help` lists them all):

| Option | Default | Meaning |
|---|---|---|
| `--tiers` | `50,100,500` | Client counts to run |
| `--rooms` | `20` | Rooms to spread clients over |
| `--duration` / `--warmup` | `30` / `5` | Seconds of measurement / warmup per tier |
| `--interval` | `2000` | Mean ms between messages per client |
| `--payload` | `256` | Ciphertext bytes per message |
| `--url` | (spawn) | Benchmark an already-running server instead, e.g. `ws://host:3001/ws` |
| `--server-heap` / `--server-mem-cap` | `512` / `768` | Server V8 heap and RSS caps, in MB |
| `--min-free` | `1024` | Abort if host MemAvailable (MB) drops below this |

## Limitations and next steps

- **Linux only for the default mode.** Per-client source addresses rely on Linux routing all of `127.0.0.0/8` to loopback, and CPU/RAM sampling reads `/proc`. On macOS only `127.0.0.1` exists by default, so connections from `127.1.x.y` fail.
- **Load generator on the same host.** On 2 cores, the generator's CPU competes with the server's and inflates latency at 500 clients. For higher tiers, run the server alone and point the script at it with `--url` from a second machine. Per-client IPs then come from that machine's own address, so the rate limiter sees one IP. Either spread clients across several hosts or keep the per-host rate under 30 messages per 10 s.
- **Loopback network.** There is no real network latency, packet loss or TLS. Production latency adds RTT and TLS cost.
- **No crypto on the client side.** Payloads are random bytes of the right size. Real clients also spend time on AES-GCM in the browser, which doesn't affect the server.
- **Single server process.** The relay is single-threaded Node with in-memory rooms. Horizontal scaling would need sticky routing by room, which is out of scope here.

## Notes

On its first run, the benchmark found that `/ws` passed @fastify/websocket v8's `SocketStream` wrapper to the handler instead of the raw `ws` socket, so the relay delivered **no messages** (not even `room_info`). `main` has since fixed this: `buildServer()` in `server/src/index.ts` passes `connection.socket`. All numbers above were measured with the fix.

The script connects with `/ws?room=<id>`. It goes through the same handler as `/ws/:roomId`, so the results apply to both routes.
