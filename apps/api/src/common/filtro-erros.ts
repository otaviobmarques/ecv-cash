import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';

@Catch()
export class FiltroDeErros implements ExceptionFilter {
  private readonly log = new Logger('Erro');

  catch(e: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    if (e instanceof HttpException) {
      const corpo = e.getResponse();
      const obj: Record<string, unknown> = typeof corpo === 'string' ? { mensagem: corpo } : { ...(corpo as Record<string, unknown>) };
      if (obj.mensagem === undefined) obj.mensagem = typeof obj.message === 'string' ? obj.message : Array.isArray(obj.message) ? obj.message.join(' ') : e.message;
      delete obj.message; delete obj.error; delete obj.statusCode;
      return res.status(e.getStatus()).json(obj);
    }
    // violação de isolamento no banco (RLS) ou de privilégio: nunca deve vazar detalhe
    const code = (e as { code?: string })?.code;
    if (code === '42501') {
      this.log.warn(`Acesso negado pelo banco: ${(e as Error).message}`);
      return res.status(403).json({ mensagem: 'Você não tem permissão para esta ação.' });
    }
    this.log.error(e instanceof Error ? e.stack ?? e.message : String(e));
    return res.status(500).json({ mensagem: 'Algo deu errado. Tente de novo em instantes.' });
  }
}
