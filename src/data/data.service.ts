import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { ScrapeJob, ScrapeResult, PostData, ProfileData, CommentData, ReelData } from '../common/interfaces';

@Injectable()
export class DataService {
    private readonly logger = new Logger(DataService.name);

    // In-memory store for active jobs
    private jobs: Map<string, ScrapeJob> = new Map();

    constructor(private readonly configService: ConfigService) { }

    /**
     * Create a new scrape job
     */
    createJob(job: ScrapeJob): ScrapeJob {
        this.jobs.set(job.id, job);
        this.logger.log(`Created job ${job.id} (${job.type})`);
        return job;
    }

    /**
     * Update job status
     */
    updateJob(jobId: string, updates: Partial<ScrapeJob>): ScrapeJob | null {
        const job = this.jobs.get(jobId);
        if (!job) {
            return null;
        }

        Object.assign(job, updates);
        this.jobs.set(jobId, job);
        return job;
    }

    /**
     * Get a job by ID
     */
    getJob(jobId: string): ScrapeJob | null {
        return this.jobs.get(jobId) || null;
    }

    /**
     * Get all jobs
     */
    getAllJobs(): ScrapeJob[] {
        return Array.from(this.jobs.values());
    }


    /**
     * Deduplicate posts by ID
     */
    deduplicatePosts(posts: PostData[]): PostData[] {
        const seen = new Set<string>();
        return posts.filter((post) => {
            if (seen.has(post.id)) {
                return false;
            }
            seen.add(post.id);
            return true;
        });
    }

    /**
     * Deduplicate comments by ID
     */
    deduplicateComments(comments: CommentData[]): CommentData[] {
        const seen = new Set<string>();
        return comments.filter((comment) => {
            if (seen.has(comment.id)) {
                return false;
            }
            seen.add(comment.id);
            return true;
        });
    }

    /**
     * Get job statistics
     */
    getJobStats(): {
        total: number;
        pending: number;
        processing: number;
        completed: number;
        failed: number;
    } {
        const jobs = Array.from(this.jobs.values());
        return {
            total: jobs.length,
            pending: jobs.filter((j) => j.status === 'pending').length,
            processing: jobs.filter((j) => j.status === 'processing').length,
            completed: jobs.filter((j) => j.status === 'completed').length,
            failed: jobs.filter((j) => j.status === 'failed').length,
        };
    }

    /**
     * Clean up old jobs (older than 24 hours)
     */
    cleanupOldJobs(): number {
        const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
        let cleaned = 0;

        for (const [jobId, job] of this.jobs) {
            if (job.createdAt.getTime() < oneDayAgo && job.status !== 'processing') {
                this.jobs.delete(jobId);
                cleaned++;
            }
        }

        if (cleaned > 0) {
            this.logger.log(`Cleaned up ${cleaned} old jobs`);
        }

        return cleaned;
    }
}
