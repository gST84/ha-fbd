import type { Runtime, ScanResult } from './runtime.js';

/** Runs Runtime.scan() every `periodMs` with drift correction and overrun counting. */
export class CyclicScheduler {
  overruns = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private next = 0;

  constructor(
    private readonly runtime: Runtime,
    private readonly periodMs = 100,
    private readonly onScan?: (r: ScanResult) => void,
    private readonly onError?: (e: unknown) => void,
  ) {}

  get isRunning() { return this.running; }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.next = performance.now();
    this.tick();
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private tick = (): void => {
    if (!this.running) return;
    try { this.onScan?.(this.runtime.scan()); } catch (e) { this.onError?.(e); }
    this.next += this.periodMs;
    const now = performance.now();
    if (this.next < now) {                        // scan (or event loop) took longer than the period
      this.overruns++;
      this.next = now + this.periodMs - ((now - this.next) % this.periodMs);
    }
    this.timer = setTimeout(this.tick, Math.max(0, this.next - now));
  };
}
