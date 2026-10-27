import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DbModule } from './db/db.module';
import { MailModule } from './mail/mail.module';
import { AuthService } from './auth/auth.service';
import { AuthController } from './auth/auth.controller';
import { AcessoGuard } from './auth/acesso.guard';
import { EmpresasController } from './empresas/empresas.controller';
import { EmpresasService } from './empresas/empresas.service';
import { UsuariosController } from './usuarios/usuarios.controller';
import { UsuariosService } from './usuarios/usuarios.service';
import { TemaController } from './tema/tema.controller';
import { TemaService } from './tema/tema.service';
import { AuditoriaController } from './auditoria/auditoria.controller';
import { HealthController } from './health/health.controller';

@Module({
  imports: [DbModule, MailModule],
  controllers: [AuthController, EmpresasController, UsuariosController, TemaController, AuditoriaController, HealthController],
  providers: [AuthService, EmpresasService, UsuariosService, TemaService, { provide: APP_GUARD, useClass: AcessoGuard }],
})
export class AppModule {}
