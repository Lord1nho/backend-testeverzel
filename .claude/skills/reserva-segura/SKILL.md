---
name: reserva-segura
description: Use SEMPRE que for criar, editar ou revisar codigo dos modulos reservations, payments, tickets ou gate -- ou qualquer logica de reserva de assento, pagamento simulado, emissao/compartilhamento de ticket ou validacao na portaria -- mesmo que o usuario nao diga "reserva segura" explicitamente. Garante que as regras criticas do dominio (venda unica de assento, transacao, aprovacao de pagamento gerando ticket, liberacao de assento em recusa, bloqueio de reuso de ticket na portaria) nao sejam quebradas.
---

# Reserva Segura

## Objetivo

Garantir que alteracoes no fluxo de reserva nao quebrem:

- venda unica de assento;
- pagamento aprovado gerando ticket;
- pagamento recusado liberando assento;
- validacao de ticket no backend;
- bloqueio de segundo uso na portaria.

## Checklist Antes De Editar

1. Localize o service/use-case responsavel pela reserva.
2. Localize o modelo Prisma de `EventSeat`, `TicketReservation`, `SimulatedPayment` e `Ticket`.
3. Confirme se a operacao usa transacao.
4. Confirme quais status sao usados para assento, reserva, pagamento e ticket.

## Regras Obrigatorias

- Nunca confiar na disponibilidade enviada pelo frontend.
- Sempre buscar o assento no banco dentro da transacao.
- Se o assento nao estiver disponivel, falhar com erro claro.
- Se pagamento for aprovado, criar ticket e marcar assento como vendido.
- Se pagamento for recusado, nao criar ticket e liberar assento -- **excecao deliberada**: a reserva aceita ate 3 tentativas de pagamento (`payments.repository.ts`, `MAX_PAYMENT_ATTEMPTS`); nas tentativas 1 e 2 o assento continua reservado (o cliente tenta de novo na mesma reserva), so a 3a recusa libera o assento de fato.
- Nunca validar ticket apenas pelo frontend.

## Testes Esperados

Ao terminar qualquer mudanca, testar:

- cliente compra assento disponivel;
- outro cliente nao compra o mesmo assento;
- pagamento recusado na tentativa final (3a) libera assento; tentativas 1 e 2 mantem o assento reservado;
- ticket aprovado aparece em meus ingressos;
- ticket usado nao pode ser usado novamente.
