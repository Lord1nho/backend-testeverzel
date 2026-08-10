# Uso de IA neste projeto

Ferramenta usada: **Claude Code** (Anthropic), do primeiro commit ("Add project foundation and local Docker Postgres setup") até a reta final (módulo `gate`, seed, deploy e esta documentação).

## Como o projeto foi conduzido

O desenvolvimento seguiu o histórico de casos de uso do PDF do desafio, um grupo por vez, em vez de gerar o backend inteiro de uma tacada:

1. Fundação do projeto (estrutura de pastas, Docker Postgres, Prisma) — sem casos de uso ainda.
2. `auth` (UC1).
3. `catalog` (UC3 — integração de leitura com o TMDB).
4. `events` (UC2, UC4-UC7, UC9 — criação, configuração, publicação e navegação pública de evento).
5. `reservations` (UC10, UC11 — reserva de assento).
6. `payments` + `tickets` (UC12-UC15 — pagamento simulado, Meus Ingressos, QR, compartilhamento, e o cancelamento de reserva como bônus).
7. `gate` (UC16-UC20 — validação na portaria), seed de dados e preparação de deploy.

Cada etapa: eu descrevia o caso de uso e as regras de negócio envolvidas, a IA implementava seguindo a arquitetura em camadas já estabelecida (`route -> controller -> service -> repository -> Prisma`), eu revisava o diff e os testes antes de seguir para a etapa seguinte. Esse ritmo incremental (implementado e testado uma fatia vertical do domínio por vez, não a stack inteira de uma vez) foi o que manteve a suíte de testes (94 testes antes do módulo `gate`, 104 depois) e as regras críticas de reserva/pagamento sempre coerentes entre si — quebra de uma regra em `payments` teria estourado teste de `reservations` ou `tickets` na mesma hora.

Uma decisão de processo importante: criei a skill `reserva-segura` (`.claude/skills/reserva-segura/SKILL.md`) depois de perceber que os módulos `reservations`, `payments`, `tickets` e `gate` compartilham as mesmas regras críticas (venda única de assento, transação, aprovação de pagamento gerando ticket, liberação de assento em recusa, bloqueio de reuso de ticket na portaria). A skill funciona como checklist obrigatório que a IA consulta antes de editar qualquer um desses módulos — reduz a chance de uma mudança pontual (ex: um campo novo no `Ticket`) esquecer de recheckar uma condição de corrida em outro lugar do fluxo.

## Decisões de domínio que tomei explicitamente

Estas não foram escolhas da IA — foram decisões de produto/arquitetura que eu tomei ao longo do caminho, e pedi para implementar:

- **Mapa de assentos, não venda por quantidade.** O Cliente escolhe assentos específicos (`EventSeat`), não só uma quantidade de ingressos — decisão tomada já na fundação do projeto, documentada no schema (`EventSeat.code`, convenção `A1..A10`).
- **Convenção do cartão de teste.** Pagamento simulado aprova qualquer número de cartão, exceto os terminados em `0000` (sempre recusados) — convenção parecida com sandbox de gateway real (Stripe Test Mode), pra permitir testar os dois fluxos de forma determinística.
- **Formato do QR.** `"<code>.<hmac>"`, com o HMAC assinado deterministicamente sobre `ticket.id` (não um segredo aleatório revelado uma única vez) — decidido especificamente para o Cliente poder reabrir o ingresso e ver o mesmo QR de novo (UC14), sem precisar guardar/reexibir um valor gerado só na emissão.
- **Adicionar `eventSeatId` ao `Ticket`.** O schema inicial ligava `Ticket` só à reserva; percebi durante a implementação de `payments` que a portaria e o "Meus Ingressos" precisavam saber diretamente qual assento cada ticket ocupa (uma reserva pode ter vários assentos/tickets), então pedi a alteração do schema para amarrar `Ticket -> EventSeat` 1:1.
- **Cancelamento explícito de reserva.** Não estava nos casos de uso obrigatórios, mas pedi a rota `POST /api/reservations/:id/cancel` (o Cliente desiste antes de pagar, assento volta a `AVAILABLE`) — é o bônus opcional de devolução ao estoque citado no PDF.
- **Entrada automática na portaria (UC20).** Entre as duas opções aceitáveis do caso de uso (validar e marcar `USED` no mesmo request, ou exigir uma segunda chamada de "confirmar entrada"), escolhi a primeira — mais simples de operar, um único endpoint, um único scan.
- **Escopo consciente do que ficou de fora**, dado o prazo: UC8 (busca/filtro de eventos), mapa de assentos em tempo real (websocket) e Docker Compose full-stack (app+db). Documentado nos READMEs correspondentes em vez de deixado implícito.

## O que foi mecânico vs. decisão minha

**Mecânico** (a IA seguiu padrão já estabelecido nos módulos anteriores, sem eu precisar especificar linha a linha): estrutura de arquivo por módulo (`*.schemas.ts`, `*.repository.ts`, `*.service.ts`, `*.mappers.ts`, `*.controller.ts`, `*.routes.ts`), validação Zod de entrada, mensagens de erro em português, escrita dos testes de integração seguindo o mesmo formato dos módulos anteriores (setup/cleanup de dados de teste, mock do cliente TMDB), e a documentação de cada módulo (`README.md` interno).

**Decisão minha, caso a caso**: todas as regras de negócio listadas acima, o desenho de cada endpoint (o que cada UC realmente precisa expor), quais status HTTP fazem sentido pra cada cenário de erro, e a revisão final de cada diff antes de considerar um caso de uso "pronto" — inclusive pedindo ajustes quando a primeira implementação de uma regra (ex: trava de assento) não cobria a condição de corrida corretamente.

## Verificação

Toda entrega passou por `npx tsc --noEmit`, `npm run lint` e `npm test` (suíte de integração completa, contra Postgres real, não mocks — decisão consciente pra pegar divergências entre a lógica e o schema real do banco) antes de eu considerar a etapa concluída.
