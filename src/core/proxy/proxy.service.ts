import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProxyConfig } from '../../common/interfaces';

@Injectable()
export class ProxyService implements OnModuleInit {
    private readonly logger = new Logger(ProxyService.name);
    private proxies: ProxyConfig[] = [];
    private currentIndex: number = 0;
    private requestCounts: Map<string, number> = new Map();
    private requestsPerProxy: number;

    constructor(private readonly configService: ConfigService) {
        this.requestsPerProxy = this.configService.get<number>('proxy.requestsPerProxy') || 50;
    }

    onModuleInit() {
        this.loadProxies();
    }

    /**
     * Load proxies from environment configuration
     */
    private loadProxies(): void {
        const proxyList: string[] = this.configService.get<string[]>('proxy.list') || [];

        this.proxies = proxyList
            .map((proxyStr) => this.parseProxyString(proxyStr))
            .filter((proxy): proxy is ProxyConfig => proxy !== null);

        this.logger.log(`Loaded ${this.proxies.length} proxies`);

        if (this.proxies.length === 0) {
            this.logger.warn('No proxies configured - running without proxy rotation');
        }
    }

    /**
     * Parse proxy string (format: protocol://user:pass@host:port)
     */
    private parseProxyString(proxyStr: string): ProxyConfig | null {
        try {
            const url = new URL(proxyStr);
            return {
                protocol: url.protocol.replace(':', '') as 'http' | 'https' | 'socks5',
                host: url.hostname,
                port: parseInt(url.port, 10),
                username: url.username || undefined,
                password: url.password || undefined,
                isActive: true,
                failCount: 0,
            };
        } catch (error) {
            this.logger.warn(`Invalid proxy string: ${proxyStr}`);
            return null;
        }
    }

    /**
     * Get next available proxy (round-robin)
     */
    getNextProxy(): ProxyConfig | null {
        const activeProxies = this.proxies.filter((p) => p.isActive);

        if (activeProxies.length === 0) {
            return null;
        }

        // Find a proxy that hasn't exceeded request limit
        for (let i = 0; i < activeProxies.length; i++) {
            const index = (this.currentIndex + i) % activeProxies.length;
            const proxy = activeProxies[index];
            const proxyKey = `${proxy.host}:${proxy.port}`;
            const requestCount = this.requestCounts.get(proxyKey) || 0;

            if (requestCount < this.requestsPerProxy) {
                this.currentIndex = (index + 1) % activeProxies.length;
                this.requestCounts.set(proxyKey, requestCount + 1);
                proxy.lastUsed = new Date();
                return proxy;
            }
        }

        // All proxies at limit - reset counts and return first
        this.logger.debug('All proxies at request limit, resetting counts');
        this.requestCounts.clear();

        const proxy = activeProxies[0];
        const proxyKey = `${proxy.host}:${proxy.port}`;
        this.requestCounts.set(proxyKey, 1);
        this.currentIndex = 1 % activeProxies.length;
        proxy.lastUsed = new Date();

        return proxy;
    }

    /**
     * Mark a proxy as failed
     */
    markProxyFailed(proxy: ProxyConfig): void {
        const found = this.proxies.find(
            (p) => p.host === proxy.host && p.port === proxy.port,
        );

        if (found) {
            found.failCount++;
            this.logger.warn(`Proxy ${proxy.host}:${proxy.port} failed (count: ${found.failCount})`);

            // Disable proxy after 3 failures
            if (found.failCount >= 3) {
                found.isActive = false;
                this.logger.error(`Proxy ${proxy.host}:${proxy.port} disabled after 3 failures`);
            }
        }
    }

    /**
     * Mark a proxy as successful (reset fail count)
     */
    markProxySuccess(proxy: ProxyConfig): void {
        const found = this.proxies.find(
            (p) => p.host === proxy.host && p.port === proxy.port,
        );

        if (found) {
            found.failCount = 0;
        }
    }

    /**
     * Reset a specific proxy
     */
    resetProxy(host: string, port: number): void {
        const found = this.proxies.find((p) => p.host === host && p.port === port);

        if (found) {
            found.isActive = true;
            found.failCount = 0;
            this.logger.log(`Proxy ${host}:${port} reset and reactivated`);
        }
    }

    /**
     * Get proxy statistics
     */
    getStats(): {
        total: number;
        active: number;
        disabled: number;
        requestCounts: Record<string, number>;
    } {
        const active = this.proxies.filter((p) => p.isActive).length;
        return {
            total: this.proxies.length,
            active,
            disabled: this.proxies.length - active,
            requestCounts: Object.fromEntries(this.requestCounts),
        };
    }

    /**
     * Check if proxies are available
     */
    hasProxies(): boolean {
        return this.proxies.some((p) => p.isActive);
    }

    /**
     * Add a new proxy dynamically
     */
    addProxy(proxyStr: string): boolean {
        const proxy = this.parseProxyString(proxyStr);
        if (proxy) {
            this.proxies.push(proxy);
            this.logger.log(`Added new proxy: ${proxy.host}:${proxy.port}`);
            return true;
        }
        return false;
    }
}
