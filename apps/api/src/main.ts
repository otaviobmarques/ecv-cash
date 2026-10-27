import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { carregarEnv } from './config/env';
import { configurar } from './configurar';

async function iniciar() {
  const env = carregarEnv();
  const app = await NestFactory.create(AppModule);
  configurar(app, env);
  app.enableShutdownHooks();
  await app.listen(env.PORT);
}
iniciar();
