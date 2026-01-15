import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './common/config/configuration';
import { BrowserModule } from './core/browser/browser.module';
import { ProxyModule } from './core/proxy/proxy.module';
import { RateLimiterModule } from './core/rate-limiter/rate-limiter.module';
import { AuthModule } from './core/auth/auth.module';
import { DataModule } from './data/data.module';
import { ScraperModule } from './scraper/scraper.module';

@Module({
  imports: [
    // Configuration
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),

    // Core modules
    BrowserModule,
    ProxyModule,
    RateLimiterModule,
    AuthModule,
    DataModule,

    // Feature modules
    ScraperModule,
  ],
})
export class AppModule { }

