import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  // Enable CORS
  app.enableCors();

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Swagger setup
  const config = new DocumentBuilder()
    .setTitle('Instakand API')
    .setDescription(
      `
      ## Instakand - Instagram Scraper Tool
      
      A powerful Instagram scraping API built with NestJS + Playwright.
      
      ### Features
      - 📱 **Profile Scraping** - Scrape user profiles and their posts
      - #️⃣ **Hashtag Scraping** - Scrape posts by hashtag
      - 📷 **Post Scraping** - Scrape individual post details
      - 💬 **Comment Scraping** - Scrape comments from posts
      - 🎬 **Reel Scraping** - Scrape reels from profiles
      - 📍 **Location Scraping** - Scrape posts by location
      
      ### Anti-Detection Features
      - 🔄 Proxy rotation
      - ⏱️ Adaptive rate limiting
      - 🎭 Browser fingerprint randomization
      - 🧠 Human-like behavior simulation
      
      ### Output
      All scraped data is saved to JSON files in the \`output/\` directory.
    `,
    )
    .setVersion('1.0')
    .addTag('Scraper', 'Instakand scraping endpoints')
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document, {
    customSiteTitle: 'Instakand API',
    customCss: `
      .swagger-ui .topbar { display: none }
      .swagger-ui .info { margin: 30px 0 }
      .swagger-ui .info .title { color: #E1306C }
    `,
  });

  const port = process.env.PORT || 3000;
  await app.listen(port);

  logger.log(`🚀 Application is running on: http://localhost:${port}`);
  logger.log(`📚 Swagger docs available at: http://localhost:${port}/api`);
}

bootstrap();
