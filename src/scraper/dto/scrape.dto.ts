import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsOptional, IsNumber, Min, Max, IsBoolean, IsArray } from 'class-validator';
import { Type } from 'class-transformer';

export class ScrapeProfileDto {
    @ApiProperty({ description: 'Instagram username to scrape', example: 'cristiano' })
    @IsString()
    username: string;

    @ApiPropertyOptional({ description: 'Include posts from profile', default: true })
    @IsOptional()
    @IsBoolean()
    includePosts?: boolean = true;

    @ApiPropertyOptional({ description: 'Number of posts to scrape', default: 12, minimum: 1, maximum: 1000 })
    @IsOptional()
    @IsNumber()
    @Type(() => Number)
    @Min(1)
    @Max(1000)
    postsLimit?: number = 12;
}

export class ScrapeHashtagDto {
    @ApiProperty({ description: 'Hashtag to scrape (without #)', example: 'travel' })
    @IsString()
    hashtag: string;

    @ApiPropertyOptional({ description: 'Number of posts to scrape', default: 50, minimum: 1, maximum: 1000 })
    @IsOptional()
    @IsNumber()
    @Type(() => Number)
    @Min(1)
    @Max(1000)
    limit?: number = 50;

    @ApiPropertyOptional({ description: 'Page number for pagination', default: 1, minimum: 1 })
    @IsOptional()
    @IsNumber()
    @Type(() => Number)
    @Min(1)
    page?: number = 1;
}

export class ScrapePostDto {
    @ApiProperty({ description: 'Post URL or shortcode', example: 'CxYz123ABC' })
    @IsString()
    postUrl: string;

    @ApiPropertyOptional({ description: 'Include comments', default: false })
    @IsOptional()
    @IsBoolean()
    includeComments?: boolean = false;

    @ApiPropertyOptional({ description: 'Number of comments to scrape', default: 20, minimum: 1, maximum: 500 })
    @IsOptional()
    @IsNumber()
    @Type(() => Number)
    @Min(1)
    @Max(500)
    commentsLimit?: number = 20;
}

export class ScrapeCommentsDto {
    @ApiProperty({ description: 'Post URL or shortcode', example: 'CxYz123ABC' })
    @IsString()
    postUrl: string;

    @ApiPropertyOptional({ description: 'Number of comments to scrape', default: 50, minimum: 1, maximum: 500 })
    @IsOptional()
    @IsNumber()
    @Type(() => Number)
    @Min(1)
    @Max(500)
    limit?: number = 50;
}

export class ScrapeReelsDto {
    @ApiProperty({ description: 'Instagram username', example: 'cristiano' })
    @IsString()
    username: string;

    @ApiPropertyOptional({ description: 'Number of reels to scrape', default: 12, minimum: 1, maximum: 100 })
    @IsOptional()
    @IsNumber()
    @Type(() => Number)
    @Min(1)
    @Max(100)
    limit?: number = 12;

    @ApiPropertyOptional({ description: 'Scrape detailed info for each reel', default: false })
    @IsOptional()
    @IsBoolean()
    includeDetails?: boolean = false;
}


export class SearchPostsDto {
    @ApiProperty({ description: 'Search keyword to find in captions (use # for hashtag search)', example: 'travel' })
    @IsString()
    keyword: string;

    @ApiPropertyOptional({ description: 'Number of posts to search through', default: 100, minimum: 1, maximum: 500 })
    @IsOptional()
    @IsNumber()
    @Type(() => Number)
    @Min(1)
    @Max(500)
    searchLimit?: number = 100;

    @ApiPropertyOptional({ description: 'Maximum posts to return', default: 50, minimum: 1, maximum: 200 })
    @IsOptional()
    @IsNumber()
    @Type(() => Number)
    @Min(1)
    @Max(200)
    resultLimit?: number = 50;
}

export class ScrapeDirectUrlsDto {
    @ApiProperty({
        description: 'Array of Instagram URLs to scrape (profiles, posts, reels)',
        example: ['https://www.instagram.com/natgeo/', 'https://www.instagram.com/p/ABC123/']
    })
    @IsArray()
    @IsString({ each: true })
    urls: string[];

    @ApiPropertyOptional({ description: 'Posts limit per profile', default: 12, minimum: 1, maximum: 100 })
    @IsOptional()
    @IsNumber()
    @Type(() => Number)
    @Min(1)
    @Max(100)
    postsLimit?: number = 12;

    @ApiPropertyOptional({ description: 'Include comments for posts', default: false })
    @IsOptional()
    @IsBoolean()
    includeComments?: boolean = false;
}

