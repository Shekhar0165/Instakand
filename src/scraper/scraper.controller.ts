import { Controller, Post, Get, Body, Param, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { ScraperService } from './scraper.service';
import {
    ScrapeProfileDto,
    ScrapeHashtagDto,
    ScrapePostDto,
    ScrapeCommentsDto,
    ScrapeReelsDto,
    SearchPostsDto,
    ScrapeDirectUrlsDto,
} from './dto';

@ApiTags('Scraper')
@Controller('scraper')
export class ScraperController {
    constructor(private readonly scraperService: ScraperService) { }

    @Post('profile')
    @ApiOperation({ summary: 'Scrape an Instagram profile' })
    @ApiResponse({ status: HttpStatus.OK, description: 'Profile scraped successfully' })
    @ApiResponse({ status: HttpStatus.BAD_REQUEST, description: 'Invalid username' })
    async scrapeProfile(@Body() dto: ScrapeProfileDto) {
        const result = await this.scraperService.scrapeProfile(
            dto.username,
            dto.includePosts ?? true,
            dto.postsLimit ?? 12,
        );
        return {
            success: result.job.status === 'completed',
            job: result.job,
            data: {
                profile: result.profile,
                posts: result.posts,
            },
        };
    }

    @Post('hashtag')
    @ApiOperation({ summary: 'Scrape posts from a hashtag' })
    @ApiResponse({ status: HttpStatus.OK, description: 'Hashtag scraped successfully' })
    async scrapeHashtag(@Body() dto: ScrapeHashtagDto) {
        const result = await this.scraperService.scrapeHashtag(
            dto.hashtag,
            dto.limit ?? 50,
            dto.page ?? 1,
        );
        return {
            success: result.job.status === 'completed',
            job: result.job,
            data: {
                hashtag: result.hashtagData,
                posts: result.posts,
                count: result.posts.length,
            },
        };
    }

    @Post('post')
    @ApiOperation({ summary: 'Scrape a single Instagram post' })
    @ApiResponse({ status: HttpStatus.OK, description: 'Post scraped successfully' })
    async scrapePost(@Body() dto: ScrapePostDto) {
        const result = await this.scraperService.scrapePost(
            dto.postUrl,
            dto.includeComments ?? false,
            dto.commentsLimit ?? 20,
        );
        return {
            success: result.job.status === 'completed',
            job: result.job,
            data: {
                post: result.post,
                comments: result.comments,
                commentsCount: result.comments.length,
            },
        };
    }

    @Post('comments')
    @ApiOperation({ summary: 'Scrape comments from a post' })
    @ApiResponse({ status: HttpStatus.OK, description: 'Comments scraped successfully' })
    async scrapeComments(@Body() dto: ScrapeCommentsDto) {
        const result = await this.scraperService.scrapeComments(
            dto.postUrl,
            dto.limit ?? 50,
        );
        return {
            success: result.job.status === 'completed',
            job: result.job,
            data: {
                comments: result.comments,
                count: result.comments.length,
            },
        };
    }

    @Post('reels')
    @ApiOperation({ summary: 'Scrape reels from a profile' })
    @ApiResponse({ status: HttpStatus.OK, description: 'Reels scraped successfully' })
    async scrapeReels(@Body() dto: ScrapeReelsDto) {
        const result = await this.scraperService.scrapeReels(
            dto.username,
            dto.limit ?? 12,
            dto.includeDetails ?? false,
        );
        return {
            success: result.job.status === 'completed',
            job: result.job,
            data: {
                reels: result.reels,
                count: result.reels.length,
            },
        };
    }


    @Post('search')
    @ApiOperation({ summary: 'Search posts and reels globally across Instagram by keyword' })
    @ApiResponse({ status: HttpStatus.OK, description: 'Search completed successfully' })
    async searchPosts(@Body() dto: SearchPostsDto) {
        const result = await this.scraperService.searchPostsByCaption(
            dto.keyword,
            dto.searchLimit ?? 100,
            dto.resultLimit ?? 50,
        );
        return {
            success: result.job.status === 'completed',
            job: result.job,
            data: {
                keyword: dto.keyword,
                posts: result.posts,
                count: result.posts.length,
            },
        };
    }

    @Post('direct-urls')
    @ApiOperation({ summary: 'Scrape multiple Instagram URLs (profiles, posts, reels)' })
    @ApiResponse({ status: HttpStatus.OK, description: 'URLs scraped successfully' })
    async scrapeDirectUrls(@Body() dto: ScrapeDirectUrlsDto) {
        const result = await this.scraperService.scrapeDirectUrls(
            dto.urls,
            dto.postsLimit ?? 12,
            dto.includeComments ?? false,
        );
        return {
            success: result.job.status === 'completed',
            job: result.job,
            data: {
                results: result.results,
                count: result.results.length,
            },
        };
    }


    @Get('system-status')
    @ApiOperation({ summary: 'Get system status (rate limiter, proxies, etc.)' })
    @ApiResponse({ status: HttpStatus.OK, description: 'System status retrieved' })
    getSystemStatus() {
        return {
            success: true,
            ...this.scraperService.getSystemStatus(),
        };
    }
}

