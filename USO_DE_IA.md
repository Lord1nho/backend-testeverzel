# Uso de IA neste projeto

Ferramenta usada: **Claude Code** (Anthropic), desde antes do primeiro commit (ideação e casos de uso) até a reta final (módulo `gate`, seed, deploy e esta documentação).

## 1. Ideação e casos de uso, antes de qualquer código

O projeto não começou pelo código — começou pela pasta `planning-back-end/`, produzida com a IA antes da primeira linha de implementação: `teste-verzel-casos-de-uso-textual-v1.md` (os UCs e regras que o backend precisava garantir), o DER (`DER.md` e o `.dbml`) e o plano de integração com o TMDB (`teste-verzel-integracao-tmdb-v1.md`). Esses artefatos ficaram versionados no repositório, não descartados depois de usados — é o registro de como as decisões de modelagem foram tomadas antes de virar `schema.prisma` ou endpoint.

Só depois dessa etapa de ideação é que a implementação começou, módulo por módulo, seguindo a ordem dos casos de uso já definidos.

### Por que essa arquitetura em camadas

A divisão modular por domínio (`src/modules/auth`, `events`, `reservations`, `payments`, `tickets`, `gate`, cada um com `route -> controller -> service -> repository -> Prisma`) não foi uma sugestão da IA aceita sem questionar — foi uma escolha minha, guiada por dois fatores: o contexto do próprio projeto (um domínio com várias regras de negócio sensíveis — reserva, pagamento, ticket, portaria — que se beneficiam de fronteiras claras entre "regra de negócio" e "acesso a dado", especialmente para não deixar a IA misturar validação de entrada com lógica transacional) e experiência prévia com esse padrão em projetos anteriores, onde separar service de repository facilita tanto testar a regra de negócio isolada quanto trocar a camada de dados sem reescrever a lógica. Defini essa arquitetura já na etapa de fundação do projeto (antes até do primeiro módulo de caso de uso), e ela foi o contrato que toda implementação seguinte, feita pela IA, precisou respeitar — não uma estrutura que emergiu módulo a módulo.

## 2. A IA como escritora de código, sempre coordenada ao planejamento

Na implementação, a IA funcionou como "mão no teclado", mas nunca de forma solta: cada módulo seguiu o caso de uso e a regra de negócio já definidos na etapa 1, dentro da arquitetura em camadas combinada (`route -> controller -> service -> repository -> Prisma`), e passou por revisão de diff e testes antes de eu considerar a etapa concluída.

Ordem seguida (um grupo de casos de uso por vez, não o backend inteiro de uma tacada):

1. Fundação do projeto (estrutura de pastas, Docker Postgres, Prisma) — sem casos de uso ainda.
2. `auth` (UC1).
3. `catalog` (UC3 — integração de leitura com o TMDB, já desenhada na etapa 1).
4. `events` (UC2, UC4-UC7, UC9 — criação, configuração, publicação e navegação pública de evento).
5. `reservations` (UC10, UC11 — reserva de assento).
6. `payments` + `tickets` (UC12-UC15 — pagamento simulado, Meus Ingressos, QR, compartilhamento, e o cancelamento de reserva como bônus).
7. `gate` (UC16-UC20 — validação na portaria), seed de dados e preparação de deploy.

Esse ritmo incremental (implementar e testar uma fatia vertical do domínio por vez) foi o que manteve a suíte de testes sempre coerente entre módulos — quebra de uma regra em `payments` teria estourado teste de `reservations` ou `tickets` na mesma hora, então nunca ficou sem verificação por muito tempo.

Uma decisão de processo que reforça essa coordenação: criei a skill `reserva-segura` (`.claude/skills/reserva-segura/SKILL.md`) depois de perceber que `reservations`, `payments`, `tickets` e `gate` compartilham as mesmas regras críticas (venda única de assento, transação, aprovação de pagamento gerando ticket, liberação de assento em recusa, bloqueio de reuso de ticket na portaria). Ela funciona como checklist obrigatório que a IA consulta antes de editar qualquer um desses módulos — a IA não decide sozinha o que é crítico, ela segue o que já foi definido como crítico.

## 3. Decisões-chave planejadas antes de implementar

As decisões de domínio mais sensíveis não nasceram no meio do código — foram definidas antes, e só depois pedidas para implementar. O exemplo mais claro é o **fluxo de pagamento/checkout** (`payments`):

Antes de qualquer linha do módulo `payments` existir, a regra já estava decidida: a política padrão do projeto (skill `reserva-segura`) é "pagamento recusado libera o assento imediatamente" — mas para o checkout eu defini uma exceção deliberada e restrita, documentada como tal na própria skill: **a reserva aceita até 3 tentativas de pagamento** (`MAX_PAYMENT_ATTEMPTS`); nas tentativas 1 e 2 o assento continua `RESERVED` (o cliente tenta de novo na mesma reserva, sem perder o lugar), e só a 3ª recusa fecha a reserva (`PAYMENT_DECLINED`) e libera o assento de volta a `AVAILABLE`. Essa decisão — quantas tentativas, o que acontece com o assento em cada uma, quando a reserva realmente "morre" — foi definida antes da implementação, exatamente para não deixar a IA improvisar uma regra de negócio sensível a partir do enunciado genérico do desafio.

Outras decisões de domínio tomadas da mesma forma (planejadas, não geradas):

- **Mapa de assentos, não venda por quantidade.** O Cliente escolhe assentos específicos (`EventSeat`), decisão já na fundação do projeto, documentada no schema (`EventSeat.code`, convenção `A1..A10`).
- **Convenção do cartão de teste.** Aprova qualquer número, exceto terminado em `0000` (sempre recusado) — convenção parecida com sandbox de gateway real (Stripe Test Mode), para testar os dois fluxos do checkout de forma determinística.
- **Formato do QR.** `"<code>.<hmac>"`, HMAC assinado deterministicamente sobre `ticket.id` (não um segredo revelado uma única vez) — decidido para o Cliente poder reabrir o ingresso e ver o mesmo QR de novo (UC14).
- **Entrada automática na portaria (UC20).** Entre as duas opções aceitáveis do caso de uso, escolhi validar e marcar `USED` no mesmo request — mais simples de operar, um único endpoint, um único scan.
- **Escopo consciente do que ficou de fora**, dado o prazo: UC8 (busca/filtro de eventos), mapa de assentos em tempo real e Docker Compose full-stack. Documentado nos READMEs correspondentes em vez de deixado implícito.

## 4. Documentação também gerada por IA, mas embasada no que existe de fato

A IA também escreveu boa parte da documentação — mas sempre a partir de uma fonte verificável, nunca inventada:

- **Manuais** (README raiz, passo a passo de setup, variáveis de ambiente): embasados no próprio repositório — comandos testados de verdade contra o projeto rodando localmente, não descritos de memória. Quando um passo do setup mudava (ex: correção de um erro real de build/deploy), o README era atualizado a partir do que de fato resolveu o problema, não a partir do que "deveria" funcionar.
- **Documentação de fluxo** (README de cada módulo em `src/modules/*/README.md`, os guias de integração frontend por papel): escritos a partir do planejamento da etapa 1 **e** da codificação realmente feita — cada endpoint, regra e mensagem de erro documentados foi conferido contra o código do módulo (schema, service, controller), não contra o que foi pedido originalmente. Isso inclusive gerou revisões: ao comparar a documentação existente com o código atual do projeto, encontramos e corrigimos descrições desatualizadas (um módulo citado como "futuro" que já existia, um atributo de cookie documentado como fixo quando na verdade é condicional, uma contagem de passos que ficou para trás depois de uma regra nova).

## Verificação

Toda entrega passou por `npx tsc --noEmit`, `npm run lint` e `npm test` (suíte de integração completa, contra Postgres real, não mocks — decisão consciente para pegar divergências entre a lógica e o schema real do banco) antes de considerar a etapa concluída. Além disso, houve rodadas de revisão de código (`/code-review`) sobre o diff acumulado, com os achados aplicados e reconferidos, e testes manuais end-to-end via requisições HTTP reais contra o banco antes do deploy.
