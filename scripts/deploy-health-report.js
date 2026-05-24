#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const process = require('process');

const DEFAULT_TIMEOUT_MS = 12000;
const COLOR = {
    SUCCESS: 3066993,
    PARTIAL_FAILURE: 16766720,
    DEGRADED: 16744192,
    CRITICAL_FAILURE: 15548997,
    ROLLBACK: 3447003
};

function getEnv(name, fallback = undefined) {
    const value = process.env[name];
    return value !== undefined && value !== '' ? value : fallback;
}

function shortSha(sha) {
    return sha ? sha.substring(0, 7) : 'unknown';
}

function makeUrl(url) {
    if (!url) return null;
    return String(url).replace(/\/+$/, '');
}

function getGitHubRunUrl() {
    const server = getEnv('GITHUB_SERVER_URL', 'https://github.com');
    const repo = getEnv('GITHUB_REPOSITORY');
    const runId = getEnv('GITHUB_RUN_ID');
    if (server && repo && runId) {
        return `${makeUrl(server)}/${repo}/actions/runs/${runId}`;
    }
    return getEnv('GITHUB_RUN_URL');
}

function parseArgs() {
    const args = process.argv.slice(2);
    const options = {};
    args.forEach((arg) => {
        if (arg.startsWith('--health-json=')) {
            options.healthJson = arg.split('=', 2)[1];
        }
        if (arg === '--collect') {
            options.collect = true;
        }
        if (arg === '--notify') {
            options.notify = true;
        }
    });
    return options;
}

async function fetchWithTimeout(url, opts = {}, timeout = DEFAULT_TIMEOUT_MS) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(url, { ...opts, signal: controller.signal });
        return response;
    } finally {
        clearTimeout(id);
    }
}

function normalizeStatus(status) {
    if (!status) return 'unknown';
    const raw = String(status).toLowerCase();
    if (raw === 'ok' || raw === 'healthy') return 'healthy';
    if (raw === 'degraded') return 'degraded';
    if (raw === 'unhealthy' || raw === 'failed' || raw === 'down') return 'failed';
    return raw;
}

function createBaseReport() {
    return {
        metadata: {
            commitSha: getEnv('GITHUB_SHA', 'unknown'),
            commitMessage: getEnv('COMMIT_MESSAGE', '').trim() || 'No commit message available',
            commitAuthor: getEnv('COMMIT_AUTHOR', getEnv('GITHUB_ACTOR', 'unknown')),
            branch: getEnv('GITHUB_REF_NAME', getEnv('GITHUB_REF', 'unknown')).replace('refs/heads/', ''),
            runUrl: getGitHubRunUrl(),
            repository: getEnv('GITHUB_REPOSITORY', 'unknown'),
            environment: getEnv('ENV', 'production'),
            timestamp: new Date().toISOString()
        },
        deployment: {
            vercel: getEnv('DEPLOY_VERCEL', 'unknown'),
            worker: getEnv('DEPLOY_WORKER', 'unknown'),
            vercelUrl: makeUrl(getEnv('VERCEL_DEPLOYMENT_URL') || getEnv('APP_URL')),
            rawVercelOutput: getEnv('VERCEL_DEPLOY_OUTPUT', '')
        },
        runtime: {
            appUrl: makeUrl(getEnv('APP_URL')),
            healthEndpoint: getEnv('HEALTH_ENDPOINT'),
            workerHealthUrl: getEnv('WORKER_HEALTH_URL'),
            monitoringUrl: getEnv('MONITORING_DASHBOARD_URL'),
            observabilityUrl: getEnv('OBSERVABILITY_URL'),
            incidentTrackerUrl: getEnv('INCIDENT_TRACKER_URL')
        },
        checks: {},
        classification: {
            level: 'unknown',
            severity: 'unknown',
            emoji: '❔',
            message: 'No status computed yet',
            actions: []
        }
    };
}

async function fetchEndpointJson(url, name) {
    const normalized = makeUrl(url);
    if (!normalized) {
        return {
            name,
            status: 'unknown',
            error: 'missing endpoint URL',
            latency: null,
            httpStatus: null
        };
    }

    const start = Date.now();
    try {
        const response = await fetchWithTimeout(normalized, { method: 'GET', headers: { Accept: 'application/json' } });
        const latency = Date.now() - start;
        const json = await response.json().catch(() => null);
        return {
            name,
            status: response.ok ? 'healthy' : 'degraded',
            httpStatus: response.status,
            latency,
            payload: json,
            error: response.ok ? undefined : `HTTP ${response.status}`
        };
    } catch (error) {
        return {
            name,
            status: 'failed',
            latency: Date.now() - start,
            error: error.name === 'AbortError' ? `timeout after ${DEFAULT_TIMEOUT_MS}ms` : error.message
        };
    }
}

function summarizeHealthPayload(healthPayload) {
    const summary = {
        api: null,
        database: null,
        cache: null,
        queue: null,
        external: [],
        raw: healthPayload
    };

    if (!healthPayload || typeof healthPayload !== 'object') {
        return summary;
    }

    if (healthPayload.status) {
        summary.api = normalizeStatus(healthPayload.status);
    }
    if (healthPayload.database) {
        summary.database = normalizeStatus(healthPayload.database);
    }
    if (healthPayload.cache) {
        summary.cache = normalizeStatus(healthPayload.cache);
    }
    if (healthPayload.dependencies) {
        const dependencies = healthPayload.dependencies;
        if (dependencies.mongodb) summary.database = normalizeStatus(dependencies.mongodb.status);
        if (dependencies.redis) summary.cache = normalizeStatus(dependencies.redis.status);
        if (dependencies.queue) summary.queue = normalizeStatus(dependencies.queue.status);
        if (dependencies.external && typeof dependencies.external === 'object') {
            for (const [key, dep] of Object.entries(dependencies.external)) {
                summary.external.push({ name: key, status: normalizeStatus(dep.status), details: dep.error || dep.httpStatus || '' });
            }
        }
    }
    return summary;
}

function classifyReport(report) {
    const { deployment, checks } = report;
    const deployVercelSuccess = String(deployment.vercel).toLowerCase() === 'success';
    const deployWorkerSuccess = String(deployment.worker).toLowerCase() === 'success';

    const apiCheck = checks.api || {};
    const workerCheck = checks.worker || {};
    const healthSummary = checks.healthSummary || {};

    const unhealthyDependencies = [];
    if (healthSummary.database && healthSummary.database !== 'healthy') unhealthyDependencies.push('database');
    if (healthSummary.cache && healthSummary.cache !== 'healthy') unhealthyDependencies.push('redis');
    if (healthSummary.queue && healthSummary.queue !== 'healthy') unhealthyDependencies.push('queue');
    if (workerCheck.status && workerCheck.status !== 'healthy') unhealthyDependencies.push('worker');
    if (checks.external && Array.isArray(checks.external)) {
        checks.external.forEach((dep) => {
            if (dep.status !== 'healthy') unhealthyDependencies.push(dep.name || 'external');
        });
    }

    let level = 'SUCCESS';
    let message = 'Platform appears operational.';
    const actions = [];

    if (!deployVercelSuccess || !deployWorkerSuccess) {
        level = 'CRITICAL_FAILURE';
        const problems = [];
        if (!deployVercelSuccess) problems.push('Vercel deployment failed');
        if (!deployWorkerSuccess) problems.push('Worker deployment failed');
        message = `${problems.join(' and ')}.`;
        actions.push('Review deployment logs for the failing target(s).');
    } else if (apiCheck.status === 'failed') {
        level = 'CRITICAL_FAILURE';
        message = 'Platform API is unreachable or returning an error.';
        actions.push('Inspect serverless runtime logs and health endpoint failures.');
    } else if (healthSummary.queue === 'failed' || workerCheck.status === 'failed') {
        level = 'DEGRADED';
        message = 'Background worker processing is unavailable, but the API may still be reachable.';
        actions.push('Check queue and worker logs for crash reports or connectivity issues.');
    } else if (healthSummary.queue === 'degraded' || workerCheck.status === 'degraded') {
        level = 'DEGRADED';
        message = 'Worker or queue processing is slowing down; background jobs may be delayed.';
        actions.push('Review queue backlog and worker health metrics.');
    } else if (healthSummary.database === 'failed' || healthSummary.cache === 'failed') {
        level = 'CRITICAL_FAILURE';
        message = 'Core infrastructure dependency failure detected.';
        actions.push('Validate database and cache connectivity and credentials.');
    } else if (healthSummary.database === 'degraded' || healthSummary.cache === 'degraded') {
        level = 'PARTIAL_FAILURE';
        message = 'A dependency is degraded; the platform may still respond but with reduced reliability.';
        actions.push('Investigate degraded dependency latency or throttle issues.');
    } else if (checks.external && checks.external.some((dep) => dep.status !== 'healthy')) {
        level = 'PARTIAL_FAILURE';
        message = 'External dependency instability detected; feature availability may be affected.';
        actions.push('Confirm external API keys, rate limits, and service status pages.');
    }

    if (String(getEnv('ROLLBACK')).toLowerCase() === 'true') {
        level = 'ROLLBACK';
        message = 'A rollback was triggered during the deployment process.';
        actions.push('Review rollback cause and recovery actions in deployment history.');
    }

    const severityText = {
        SUCCESS: 'Operational',
        PARTIAL_FAILURE: 'Partial Failure',
        DEGRADED: 'Degraded',
        CRITICAL_FAILURE: 'Critical Failure',
        ROLLBACK: 'Rollback'
    };

    return {
        level,
        severity: severityText[level],
        emoji: level === 'SUCCESS' ? '✅' : level === 'PARTIAL_FAILURE' ? '⚠️' : level === 'DEGRADED' ? '🟠' : level === 'CRITICAL_FAILURE' ? '🚨' : '🔄',
        color: COLOR[level],
        message,
        actions: actions.length > 0 ? actions : ['Validate the failing service by reviewing the attached health data.']
    };
}

function buildDiscordEmbed(report) {
    const summary = report.classification;
    const healthSummary = report.checks.healthSummary || {};
    const appUrl = report.runtime.appUrl || report.deployment.vercelUrl || 'Unknown';
    const commitSha = shortSha(report.metadata.commitSha);

    const serviceFields = [];
    serviceFields.push({
        name: 'Deployment status', value: `Vercel: ${report.deployment.vercel}
Worker: ${report.deployment.worker}`, inline: true
    });
    serviceFields.push({ name: 'Platform URL', value: appUrl || 'Unknown', inline: true });
    serviceFields.push({ name: 'API status', value: `${report.checks.api?.status || 'unknown'}`, inline: true });

    if (healthSummary.database) {
        serviceFields.push({ name: 'Database', value: healthSummary.database, inline: true });
    }
    if (healthSummary.cache) {
        serviceFields.push({ name: 'Redis / Cache', value: healthSummary.cache, inline: true });
    }
    if (healthSummary.queue) {
        serviceFields.push({ name: 'Queue', value: healthSummary.queue, inline: true });
    }
    if (report.checks.worker) {
        serviceFields.push({ name: 'Worker', value: report.checks.worker.status, inline: true });
    }

    if (report.checks.external && report.checks.external.length > 0) {
        const externalValues = report.checks.external.map((dep) => `${dep.name}: ${dep.status}`).join('\n');
        serviceFields.push({ name: 'External dependencies', value: externalValues, inline: false });
    }

    const actionable = report.classification.actions.join('\n');
    const links = [];
    if (report.runtime.observabilityUrl) links.push(`[Observability](${report.runtime.observabilityUrl})`);
    if (report.runtime.monitoringUrl) links.push(`[Monitoring](${report.runtime.monitoringUrl})`);
    if (report.runtime.incidentTrackerUrl) links.push(`[Incident tracker](${report.runtime.incidentTrackerUrl})`);
    if (report.metadata.runUrl) links.push(`[GitHub Actions](${report.metadata.runUrl})`);
    if (report.deployment.vercelUrl) links.push(`[Vercel deployment](${report.deployment.vercelUrl})`);

    const embed = {
        title: `Nook Observability Report — ${summary.emoji} ${summary.severity}`,
        description: `${summary.message}`,
        color: summary.color,
        fields: [
            { name: 'Commit', value: `${commitSha} • ${report.metadata.branch} • ${report.metadata.commitAuthor}`, inline: false },
            ...serviceFields,
            { name: 'Actionable guidance', value: actionable, inline: false },
            { name: 'Links', value: links.length ? links.join(' · ') : 'No operational links configured', inline: false }
        ],
        footer: {
            text: `Commit message: ${report.metadata.commitMessage}`
        },
        timestamp: report.metadata.timestamp
    };

    return { embeds: [embed] };
}

async function collectHealthSnapshot() {
    const report = createBaseReport();
    report.runtime.healthEndpoint = getEnv('HEALTH_ENDPOINT') || `${report.runtime.appUrl || report.deployment.vercelUrl}/api/health?detailed=true`;

    report.checks.api = await fetchEndpointJson(report.runtime.healthEndpoint, 'API Health');

    if (getEnv('WORKER_HEALTH_URL')) {
        report.checks.worker = await fetchEndpointJson(getEnv('WORKER_HEALTH_URL'), 'Worker Health');
    }

    if (report.checks.api.payload && report.checks.api.payload.dependencies) {
        report.checks.healthSummary = summarizeHealthPayload(report.checks.api.payload);
    } else {
        report.checks.healthSummary = {
            database: report.checks.api.payload?.database ? normalizeStatus(report.checks.api.payload.database) : undefined,
            cache: report.checks.api.payload?.cache ? normalizeStatus(report.checks.api.payload.cache) : undefined,
            queue: report.checks.api.payload?.dependencies?.queue ? normalizeStatus(report.checks.api.payload.dependencies.queue.status) : undefined
        };
    }

    if (report.checks.api.payload?.dependencies?.external) {
        report.checks.external = Object.entries(report.checks.api.payload.dependencies.external).map(([name, dep]) => ({
            name,
            status: normalizeStatus(dep.status),
            error: dep.error || null
        }));
    }

    report.classification = classifyReport(report);
    return report;
}

async function sendDiscordWebhook(payload) {
    const webhookUrl = getEnv('DISCORD_WEBHOOK_URL');
    if (!webhookUrl) {
        throw new Error('DISCORD_WEBHOOK_URL is required to send Discord notifications');
    }

    const response = await fetchWithTimeout(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    }, DEFAULT_TIMEOUT_MS);

    const text = await response.text();
    if (!response.ok) {
        throw new Error(`Discord webhook failed with ${response.status}: ${text}`);
    }
    return response.status;
}

async function main() {
    const options = parseArgs();
    let report;

    if (options.healthJson) {
        const filePath = path.resolve(process.cwd(), options.healthJson);
        report = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } else {
        report = await collectHealthSnapshot();
    }

    if (options.collect) {
        process.stdout.write(JSON.stringify(report, null, 2));
        return;
    }

    if (!options.notify) {
        console.error('Usage: deploy-health-report.js --collect | --notify [--health-json=path]');
        process.exit(1);
    }

    const payload = buildDiscordEmbed(report);
    await sendDiscordWebhook(payload);
    console.log('Discord operational health report sent.');
}

main().catch((error) => {
    console.error('Deployment health report failed:', error.message);
    process.exit(1);
});
