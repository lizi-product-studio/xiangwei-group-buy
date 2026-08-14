import { describe, expect, it } from 'vitest';
import { ensureCampaignCloseScheduled, type CampaignCloseQueue } from './campaign-scheduler.js';

describe('ensureCampaignCloseScheduled', () => {
  it('replaces an exhausted failed close task so periodic reconciliation can retry it', async () => {
    let removed = false;
    const added: Array<{ name: string; data: { campaignId: string; version: number }; options: Record<string, unknown> }> = [];
    const queue: CampaignCloseQueue = {
      getJob: async () => ({
        data: { campaignId: 'campaign-1', version: 7 },
        getState: async () => 'failed',
        remove: async () => { removed = true; },
      }),
      add: async (name, data, options) => { added.push({ name, data, options }); },
      getJobs: async () => [],
    };

    await ensureCampaignCloseScheduled(queue, 'campaign-1', '2030-01-01T00:00:00.000Z', 7, Date.parse('2029-12-31T23:00:00.000Z'));

    expect(removed).toBe(true);
    expect(added).toEqual([expect.objectContaining({
      name: 'close-campaign',
      data: { campaignId: 'campaign-1', version: 7 },
      options: expect.objectContaining({ jobId: 'close-campaign-1', delay: 3_600_000, attempts: 8 }),
    })]);
  });

  it('keeps a same-version delayed task instead of creating duplicate close work', async () => {
    let added = 0;
    const queue: CampaignCloseQueue = {
      getJob: async () => ({
        data: { campaignId: 'campaign-1', version: 7 },
        getState: async () => 'delayed',
        remove: async () => { throw new Error('should not remove a valid delayed job'); },
      }),
      add: async () => { added += 1; },
      getJobs: async () => [],
    };

    await ensureCampaignCloseScheduled(queue, 'campaign-1', '2030-01-01T00:00:00.000Z', 7);

    expect(added).toBe(0);
  });
});
