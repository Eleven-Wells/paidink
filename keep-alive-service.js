const https = require('https');
const http = require('http');

class RenderKeepAlive {
    constructor(options = {}) {
        this.targetUrl = options.targetUrl || process.env.TARGET_URL || 'https://nook-app.onrender.com';
        this.pingInterval = options.pingInterval || 5 * 60 * 1000; // 5 minutes default
        this.endpoints = options.endpoints || ['/ping', '/health'];
        this.timeout = options.timeout || 10000; // 10 seconds timeout
        this.maxRetries = options.maxRetries || 3;
        this.isRunning = false;
    }

    // Ping a single endpoint
    pingEndpoint(endpoint) {
        return new Promise((resolve, reject) => {
            const url = new URL(endpoint, this.targetUrl);
            const client = url.protocol === 'https:' ? https : http;

            const options = {
                hostname: url.hostname,
                port: url.port,
                path: url.pathname + url.search,
                method: 'GET',
                timeout: this.timeout,
                headers: {
                    'User-Agent': 'Render-Keep-Alive/1.0',
                    'Accept': 'application/json'
                }
            };

            const req = client.request(options, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', () => {
                    try {
                        const response = data ? JSON.parse(data) : { status: 'ok' };
                        resolve({
                            endpoint,
                            status: res.statusCode,
                            response,
                            timestamp: new Date().toISOString()
                        });
                    } catch (error) {
                        resolve({
                            endpoint,
                            status: res.statusCode,
                            response: data,
                            timestamp: new Date().toISOString()
                        });
                    }
                });
            });

            req.on('error', (error) => {
                reject({
                    endpoint,
                    error: error.message,
                    timestamp: new Date().toISOString()
                });
            });

            req.on('timeout', () => {
                req.destroy();
                reject({
                    endpoint,
                    error: 'Request timeout',
                    timestamp: new Date().toISOString()
                });
            });

            req.end();
        });
    }

    // Ping all endpoints with retry logic
    async pingAllEndpoints() {
        const results = [];

        for (const endpoint of this.endpoints) {
            let success = false;
            let lastError = null;

            for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
                try {
                    const result = await this.pingEndpoint(endpoint);
                    results.push(result);
                    console.log(`✅ Ping successful: ${endpoint} (${result.status})`);
                    success = true;
                    break;
                } catch (error) {
                    lastError = error;
                    console.log(`❌ Ping attempt ${attempt}/${this.maxRetries} failed for ${endpoint}: ${error.error || error.message}`);
                    if (attempt < this.maxRetries) {
                        // Wait 2 seconds before retry
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    }
                }
            }

            if (!success) {
                results.push({
                    endpoint,
                    error: lastError.error || lastError.message,
                    timestamp: new Date().toISOString()
                });
                console.log(`💀 All ping attempts failed for ${endpoint}`);
            }
        }

        return results;
    }

    // Start the keep-alive service
    start() {
        if (this.isRunning) {
            console.log('Keep-alive service is already running');
            return;
        }

        this.isRunning = true;
        console.log(`🚀 Starting Render Keep-Alive service`);
        console.log(`📍 Target URL: ${this.targetUrl}`);
        console.log(`⏰ Ping interval: ${this.pingInterval / 1000} seconds`);
        console.log(`🔗 Endpoints: ${this.endpoints.join(', ')}`);

        // Initial ping
        this.pingAllEndpoints().catch(error => {
            console.error('Initial ping failed:', error);
        });

        // Set up interval
        this.intervalId = setInterval(async () => {
            try {
                await this.pingAllEndpoints();
            } catch (error) {
                console.error('Scheduled ping failed:', error);
            }
        }, this.pingInterval);
    }

    // Stop the keep-alive service
    stop() {
        if (!this.isRunning) {
            console.log('Keep-alive service is not running');
            return;
        }

        this.isRunning = false;
        clearInterval(this.intervalId);
        console.log('🛑 Render Keep-Alive service stopped');
    }

    // Get service status
    getStatus() {
        return {
            isRunning: this.isRunning,
            targetUrl: this.targetUrl,
            pingInterval: this.pingInterval,
            endpoints: this.endpoints,
            nextPing: this.isRunning ? new Date(Date.now() + this.pingInterval).toISOString() : null
        };
    }
}

// CLI interface
if (require.main === module) {
    require('dotenv').config();

    const keepAlive = new RenderKeepAlive({
        targetUrl: process.env.TARGET_URL,
        pingInterval: (process.env.PING_INTERVAL_MINUTES || 5) * 60 * 1000,
        endpoints: (process.env.PING_ENDPOINTS || '/ping,/health').split(',')
    });

    // Handle graceful shutdown
    process.on('SIGINT', () => {
        console.log('\nReceived SIGINT, stopping service...');
        keepAlive.stop();
        process.exit(0);
    });

    process.on('SIGTERM', () => {
        console.log('\nReceived SIGTERM, stopping service...');
        keepAlive.stop();
        process.exit(0);
    });

    // Start the service
    keepAlive.start();

    // Optional: Expose status endpoint if running as server
    if (process.env.PORT) {
        const express = require('express');
        const app = express();

        app.get('/status', (req, res) => {
            res.json(keepAlive.getStatus());
        });

        app.listen(process.env.PORT, () => {
            console.log(`📊 Status server running on port ${process.env.PORT}`);
        });
    }
}

module.exports = RenderKeepAlive;