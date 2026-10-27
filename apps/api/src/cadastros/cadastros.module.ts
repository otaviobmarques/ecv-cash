import { Module } from '@nestjs/common';
import { PlanoContasController, PlanoContasService } from './plano-contas';
import { ServicosController, ServicosService } from './servicos';
import { FornecedoresController, FornecedoresService } from './fornecedores';
import { FormasPagamentoController, FormasPagamentoService } from './formas-pagamento';
import { ClientesController, ClientesService } from './clientes';
import { VistoriadoresController, VistoriadoresService } from './vistoriadores';
import { ContasFinanceirasController, ContasFinanceirasService } from './contas-financeiras';

@Module({
  controllers: [PlanoContasController, ServicosController, FornecedoresController, FormasPagamentoController, ClientesController, VistoriadoresController, ContasFinanceirasController],
  providers: [PlanoContasService, ServicosService, FornecedoresService, FormasPagamentoService, ClientesService, VistoriadoresService, ContasFinanceirasService],
})
export class CadastrosModule {}
