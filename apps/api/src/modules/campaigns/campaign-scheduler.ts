import { Queue, Worker, type JobType } from 'bullmq';
import { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import type { Campaign } from '../core/types.js';

type CloseJobData = { campaignId: string; version: number };

/** The small queue surface used by scheduling, kept injectable for recovery tests. */
export interface CampaignCloseQueue {
  getJob(jobId: string): Promise<{
    data: CloseJobData;
    getState(): Promise<string>;
    remove(): Promise<void>;
  } | undefined>;
  add(name: string, data: CloseJobData, options: {
    jobId: string;
    delay: number;
    attempts: number;
    backoff: { type: 'exponential'; delay: number };
    removeOnComplete: number;
    removeOnFail: number;
  }): Promise<unknown>;
  getJobs(
    states: JobType[],
    start: number,
    end: number,
  ): Promise<Array<{
    name: string;
    data: CloseJobData;
    remove(): Promise<void>;
  }>>;
}

/**
 * Keep a close task for every open campaign. A BullMQ job whose configured
 * retries are exhausted remains in `failed`; it must be replaced, rather than
 * treated as a healthy existing schedule, on the next reconciliation pass.
 */
export async function ensureCampaignCloseScheduled(
  queue: CampaignCloseQueue,
  campaignId: string,
  cutoffAt: string,
  version: number,
  now = Date.now(),
): Promise<void> {
  const jobId = `close-${campaignId}`;
  const existing = await queue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    const sameVersion = Number(existing.data.version) === version;

    // A currently executing close is fenced by campaign version in the service.
    // Do not race its lock; reconciliation will replace a stale job once it ends.
    if (state === 'active') return;
    if (sameVersion && ['delayed', 'waiting', 'paused', 'waiting-children', 'prioritized'].includes(state)) return;

    // This intentionally resets BullMQ's exhausted attempts counter. If removal
    // fails we surface the error so the periodic reconciler tries again instead
    // of pretending an unrecoverable failed task is scheduled.
    await existing.remove();
  }

  await queue.add('close-campaign', { campaignId, version }, {
    jobId,
    delay: Math.max(0, Date.parse(cutoffAt) - now),
    attempts: 8,
    backoff: { type: 'exponential', delay: 2_000 },
    removeOnComplete: 1_000,
    removeOnFail: 5_000,
  });
}

async function within<T>(work: Promise<T>, milliseconds: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), milliseconds); timer.unref(); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface CampaignScheduler {
  scheduleClose(campaignId: string, cutoffAt: string, version: number): Promise<void>;
  cancelClose(campaignId: string): Promise<void>;
  reconcile(campaigns: Campaign[]): Promise<void>;
  health(): Promise<'ok'>;
  runReconciliation(work: (assertOwned: () => Promise<void>) => Promise<void>): Promise<boolean>;
  close(): Promise<void>;
}

export class NoopCampaignScheduler implements CampaignScheduler {
  public async scheduleClose(): Promise<void> {}
  public async cancelClose(): Promise<void> {}
  public async reconcile(): Promise<void> {}
  public async health(): Promise<'ok'> { return 'ok'; }
  public async runReconciliation(work: (assertOwned: () => Promise<void>) => Promise<void>): Promise<boolean> {
    await work(async () => undefined);
    return true;
  }
  public async close(): Promise<void> {}
}

export class RedisCampaignScheduler implements CampaignScheduler {
  private readonly connection: Redis;
  private readonly queue: Queue;
  private readonly worker: Worker;
  public constructor(redisUrl: string, closeCampaign: (campaignId: string, version: number) => Promise<void>) {
    this.connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    this.queue = new Queue('campaign-lifecycle', { connection: this.connection });
    this.worker = new Worker('campaign-lifecycle', async (job) => {
      if (job.name === 'close-campaign') await closeCampaign(String(job.data.campaignId), Number(job.data.version));
    }, { connection: this.connection, concurrency: 5 });
  }
  public async scheduleClose(campaignId: string, cutoffAt: string, version: number): Promise<void> {
    await ensureCampaignCloseScheduled(this.queue, campaignId, cutoffAt, version);
  }
  public async cancelClose(campaignId: string): Promise<void> {
    const job = await this.queue.getJob(`close-${campaignId}`);
    if (job) await job.remove().catch(() => undefined);
  }
  public async reconcile(campaigns: Campaign[]): Promise<void> {
    const openCampaigns = campaigns.filter((campaign) => campaign.status === 'OPEN');
    const openIds = new Set(openCampaigns.map((campaign) => campaign.id));
    await Promise.all(openCampaigns.map((campaign) => this.scheduleClose(campaign.id, campaign.cutoffAt, campaign.version)));
    const pendingJobs = await this.queue.getJobs(['delayed', 'waiting', 'paused', 'failed', 'completed'], 0, 10_000);
    await Promise.all(pendingJobs
      .filter((job) => job.name === 'close-campaign' && !openIds.has(String(job.data.campaignId)))
      .map((job) => job.remove().catch(() => undefined)));
  }
  public async health(): Promise<'ok'> {
    await within(this.connection.ping(), 2_000, 'Redis ping');
    await within(this.queue.waitUntilReady(), 2_000, 'BullMQ queue readiness');
    await within(this.worker.waitUntilReady(), 2_000, 'BullMQ worker readiness');
    if (!this.worker.isRunning()) throw new Error('campaign lifecycle worker is not running');
    return 'ok';
  }
  public async runReconciliation(work: (assertOwned: () => Promise<void>) => Promise<void>): Promise<boolean> {
    const key = 'hometown:reconciliation:lease';
    const token = randomUUID();
    const acquired = await this.connection.set(key, token, 'PX', 120_000, 'NX');
    if (acquired !== 'OK') return false;
    let renewalError: Error | null = null;
    const assertOwned = async (): Promise<void> => {
      if (renewalError) throw renewalError;
      if (await this.connection.get(key) !== token)
        throw new Error('reconciliation lease ownership was lost');
    };
    const renewal = setInterval(() => {
      void this.connection.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end",
        1,
        key,
        token,
        120_000,
      ).then((result) => {
        if (Number(result) !== 1)
          renewalError = new Error('reconciliation lease renewal lost ownership');
      }).catch((error: unknown) => {
        renewalError = error instanceof Error ? error : new Error('reconciliation lease renewal failed');
      });
    }, 30_000);
    renewal.unref();
    try {
      await work(assertOwned);
      await assertOwned();
      return true;
    } finally {
      clearInterval(renewal);
      await this.connection.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        1,
        key,
        token,
      ).catch(() => undefined);
    }
  }
  public async close(): Promise<void> { await this.worker.close(); await this.queue.close(); await this.connection.quit(); }
}
