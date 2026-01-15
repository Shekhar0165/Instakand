import { Module } from '@nestjs/common';
import { ScraperController } from './scraper.controller';
import { ScraperService } from './scraper.service';
import { AuthService } from './auth.service';
import { RateLimiterService } from './rate-limiter.service';
import { ProfileStrategy } from './strategies/profile.strategy';
import { HashtagStrategy } from './strategies/hashtag.strategy';
import { PostStrategy } from './strategies/post.strategy';
import { CommentStrategy } from './strategies/comment.strategy';
import { ReelStrategy } from './strategies/reel.strategy';
import { AuthModule } from '../core/auth/auth.module';

@Module({
    imports: [AuthModule],
    controllers: [ScraperController],
    providers: [
        ScraperService,
        AuthService,
        RateLimiterService,
        ProfileStrategy,
        HashtagStrategy,
        PostStrategy,
        CommentStrategy,
        ReelStrategy,
    ],
    exports: [ScraperService, AuthService, RateLimiterService],
})
export class ScraperModule { }
