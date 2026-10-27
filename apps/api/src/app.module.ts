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
import { CommonModule } from './common/common.module';
import { CadastrosModule } from './cadastros/cadastros.module';
import { BoAuthController } from './backoffice/bo-auth.controller';
import { BoController } from './backoffice/bo.controller';
import { BoAuthService } from './backoffice/bo-auth.service';
import { BoService } from './backoffice/bo.service';
import { BoGuard } from './backoffice/bo.guard';

@Module({
  imports: [DbModule, CommonModule, MailModule, CadastrosModule],
  controllers: [BoAuthController, BoController, AuthController, EmpresasController, UsuariosController, TemaController, AuditoriaController, HealthController],
  providers: [BoAuthService, BoService, BoGuard, AuthService, EmpresasService, UsuariosService, TemaService, { provide: APP_GUARD, useClass: AcessoGuard }],
})
export class AppModule {}
