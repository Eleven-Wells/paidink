const { connectDB, closeDB } = require('../src/db');
const { connectRedis, disconnectRedis } = require('../src/config/redis');
const cronJobs = require('../src/cron');

const JOB_ALIASES = {
    'tools-update': 'toolsUpdate',
    'content-ingestion': 'contentIngestion',
    'feed-update': 'feedUpdate',
    'seo-update': 'seoUpdate',
    'content-cleanup': 'contentCleanup',
    'reader-pool-sweep': 'readerPoolSweep',
    'unfunded-reads-sweep': 'unfundedReadsSweep'
};

module.exports = async (req, res) => {
    const cronSecret = process.env.CRON_SECRET;
    const auth = req.headers['authorization'] || '';

    if (cronSecret && auth !== `Bearer ${cronSecret}`) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
    }

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const rawJob = url.searchParams.get('job');
    const jobName = JOB_ALIASES[rawJob] || rawJob;

    if (!jobName || typeof cronJobs[jobName] !== 'function') {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            error: `Unknown cron job: ${rawJob || '(not provided)'}`,
            valid: Object.keys(JOB_ALIASES)
        }));
        return;
    }

    console.log(`[Cron:Vercel] Starting job "${rawJob}" (${jobName}) at ${new Date().toISOString()}`);

    try {
        await connectDB();
        await connectRedis();
        await cronJobs[jobName]();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true, job: rawJob }));
        console.log(`[Cron:Vercel] Job "${rawJob}" completed`);
    } catch (err) {
        console.error(`[Cron:Vercel] Job "${rawJob}" failed:`, err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, job: rawJob, error: err.message }));
    } finally {
        await closeDB().catch(e => console.error('[Cron:Vercel] DB close error:', e.message));
        await disconnectRedis().catch(e => console.error('[Cron:Vercel] Redis close error:', e.message));
    }
};
