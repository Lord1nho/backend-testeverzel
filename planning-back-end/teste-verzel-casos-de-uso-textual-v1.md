# Teste Verzel - Casos de Uso Textuais - Versao 1

Este artefato detalha os casos de uso da Plataforma de Eventos e Ingressos com base no documento do desafio tecnico e no diagrama `teste-verzel-casos-de-uso-v1.md`.

O objetivo e orientar a implementacao e manter uma documentacao clara das decisoes de escopo do MVP.

## Visao Geral

A plataforma permite que:

- o Organizador crie e gerencie eventos a partir de um catalogo externo de shows ou filmes;
- o Cliente consulte eventos, reserve ingressos, realize pagamento simulado e acesse seus ingressos;
- a Portaria valide ingressos na entrada do evento, usando QR Code ou codigo manual.

## Atores

### Organizador

Usuario responsavel por criar e gerenciar eventos publicados na plataforma.

Principais responsabilidades:

- selecionar um show ou filme de uma API externa;
- configurar data, local, capacidade e preco;
- publicar eventos;
- gerenciar eventos criados.

### Cliente

Usuario responsavel por consultar eventos, reservar ingressos, pagar de forma simulada e acessar seus ingressos.

Principais responsabilidades:

- consultar eventos publicados;
- buscar e filtrar eventos;
- visualizar detalhes do evento;
- reservar ingresso;
- acessar ingresso emitido;
- compartilhar ingresso por link.

### Portaria

Usuario responsavel por validar ingressos na entrada do evento.

Principais responsabilidades:

- validar ingresso por QR Code;
- validar ingresso por codigo manual;
- visualizar o resultado da validacao;
- registrar a entrada quando o ingresso for valido.

## Regras Gerais

- A autenticacao deve distinguir tres papeis: Organizador, Cliente e Portaria.
- O sistema deve armazenar eventos, reservas e ingressos.
- O mesmo assento ou lugar nao pode ser vendido duas vezes.
- O pagamento e simulado e deve permitir resultado aprovado e recusado.
- O ingresso deve conter QR Code ou codigo seguro que nao possa ser forjado.
- O cliente deve conseguir compartilhar o ingresso por um link gerado pela aplicacao.
- A portaria deve impedir que o mesmo ingresso seja utilizado duas vezes.
- A validacao da portaria deve retornar claramente: valido, invalido, ja utilizado ou evento errado.
- O projeto deve incluir dados semeados para avaliacao: um organizador, dois clientes, um usuario de portaria e ao menos um evento publicado com ingressos disponiveis.

## UC1 - Autenticar-se

### Ator Primario

Organizador, Cliente ou Portaria.

### Objetivo

Permitir que um usuario acesse a plataforma com o papel correto.

### Pre-condicoes

- O usuario existe no sistema.
- O usuario possui um papel associado: Organizador, Cliente ou Portaria.

### Fluxo Principal

1. O usuario informa suas credenciais.
2. O sistema valida as credenciais.
3. O sistema identifica o papel do usuario.
4. O sistema direciona o usuario para a area correspondente ao seu papel.

### Fluxos Alternativos

- Credenciais invalidas: o sistema informa erro e nao autentica o usuario.
- Usuario sem permissao para a area acessada: o sistema bloqueia o acesso.

### Regras de Negocio

- Um usuario autenticado como Cliente nao deve acessar funcoes de Organizador ou Portaria.
- Um usuario autenticado como Portaria nao deve criar ou gerenciar eventos.
- Um usuario autenticado como Organizador nao deve validar ingressos como portaria, salvo se tambem possuir esse papel explicitamente.

## UC2 - Criar Evento

### Ator Primario

Organizador.

### Objetivo

Criar um evento a partir de um item vindo de catalogo externo, definindo as informacoes necessarias para venda de ingressos.

### Relacionamentos

- Inclui UC3 - Selecionar item do catalogo externo.
- Inclui UC4 - Configurar evento.
- Inclui UC5 - Publicar evento.

### Pre-condicoes

- O Organizador esta autenticado.
- A API externa escolhida esta configurada ou existe fallback de dados para desenvolvimento.

### Fluxo Principal

1. O Organizador inicia a criacao de evento.
2. O sistema permite selecionar um show ou filme do catalogo externo.
3. O Organizador configura data, local, capacidade e preco.
4. O Organizador revisa as informacoes.
5. O Organizador publica o evento.
6. O sistema disponibiliza o evento para consulta pelos clientes.

### Fluxos Alternativos

- API externa indisponivel: o sistema informa falha e pode usar dados mockados, se previsto para o MVP.
- Dados obrigatorios ausentes: o sistema impede a publicacao e indica os campos pendentes.
- Capacidade ou preco invalido: o sistema impede a publicacao.

### Regras de Negocio

- Todo evento publicado deve possuir data, local, capacidade e preco.
- O evento deve estar associado ao Organizador que o criou.
- A capacidade definida sera usada para controlar disponibilidade de ingressos.

## UC3 - Selecionar Item do Catalogo Externo

### Ator Primario

Organizador.

### Objetivo

Escolher um show ou filme vindo de uma API externa para servir como base do evento.

### Pre-condicoes

- O Organizador esta no fluxo de criacao de evento.

### Fluxo Principal

1. O sistema consulta a API externa configurada.
2. O sistema exibe itens disponiveis.
3. O Organizador seleciona um item.
4. O sistema associa o item selecionado ao evento em criacao.

### Regras de Negocio

- O MVP pode usar Ticketmaster Discovery ou TMDb.
- O item externo deve fornecer informacoes suficientes para identificar o evento, como titulo/nome e imagem ou descricao quando disponivel.

## UC4 - Configurar Evento

### Ator Primario

Organizador.

### Objetivo

Definir os dados de realizacao e venda do evento.

### Pre-condicoes

- Um item do catalogo externo foi selecionado.

### Fluxo Principal

1. O Organizador informa a data do evento.
2. O Organizador informa o local do evento.
3. O Organizador informa a capacidade.
4. O Organizador informa o preco.
5. O sistema valida os dados informados.

### Regras de Negocio

- Data, local, capacidade e preco sao obrigatorios.
- Capacidade deve ser maior que zero.
- Preco deve ser zero ou positivo, conforme decisao de produto. Para o desafio, recomenda-se preco maior que zero.

## UC5 - Publicar Evento

### Ator Primario

Organizador.

### Objetivo

Disponibilizar um evento configurado para que clientes possam consultar e reservar ingressos.

### Pre-condicoes

- O evento possui item externo selecionado.
- O evento possui data, local, capacidade e preco validos.

### Fluxo Principal

1. O Organizador confirma a publicacao.
2. O sistema altera o status do evento para publicado.
3. O evento passa a aparecer na consulta dos clientes.

### Fluxos Alternativos

- Evento incompleto: o sistema impede a publicacao.

## UC6 - Gerenciar Eventos

### Ator Primario

Organizador.

### Objetivo

Permitir que o Organizador visualize, edite ou exclua os eventos criados por ele.

### Pre-condicoes

- O Organizador esta autenticado.

### Fluxo Principal

1. O Organizador acessa sua lista de eventos.
2. O sistema exibe os eventos criados pelo Organizador.
3. O Organizador seleciona um evento.
4. O sistema exibe os detalhes do evento.
5. O Organizador escolhe uma acao: visualizar, editar ou excluir.
6. O sistema executa a acao solicitada, respeitando as regras de negocio.

### Fluxos Alternativos

- Editar evento: o Organizador altera dados permitidos, como data, local, capacidade ou preco, e o sistema salva as alteracoes.
- Excluir evento: o Organizador solicita a exclusao, o sistema pede confirmacao e remove o evento se permitido.
- Evento com data/horario ja passado: o sistema bloqueia edicao e exclusao.

### Regras de Negocio

- O Organizador so deve gerenciar eventos criados por ele, salvo decisao explicita de administracao.
- Para o MVP, o gerenciamento deve permitir visualizar, editar e excluir eventos.
- Eventos cuja data/horario ja tenha passado nao podem ser editados.
- Eventos cuja data/horario ja tenha passado nao podem ser excluidos.
- Caso o evento possua reservas ou ingressos vendidos, a exclusao deve ser tratada com cuidado. Para o MVP, recomenda-se bloquear a exclusao de eventos com reservas confirmadas.

## UC7 - Consultar Eventos Publicados

### Ator Primario

Cliente.

### Objetivo

Permitir que o Cliente navegue pelos eventos disponiveis para reserva.

### Pre-condicoes

- Existem eventos publicados no sistema.

### Fluxo Principal

1. O Cliente acessa a area de eventos.
2. O sistema lista eventos publicados.
3. O sistema apresenta informacoes essenciais: nome, data, local e preco.

### Regras de Negocio

- Apenas eventos publicados devem aparecer para o Cliente.
- Eventos sem disponibilidade podem aparecer sinalizados como indisponiveis ou ser omitidos, conforme decisao de produto.

## UC8 - Buscar e Filtrar Eventos

### Ator Primario

Cliente.

### Objetivo

Refinar a consulta de eventos publicados.

### Relacionamentos

- Estende UC7 - Consultar eventos publicados.

### Pre-condicoes

- O Cliente esta consultando eventos publicados.

### Fluxo Principal

1. O Cliente informa termo de busca ou filtro.
2. O sistema aplica os criterios.
3. O sistema atualiza a lista de eventos.

### Regras de Negocio

- Busca e filtro aparecem como opcionais no documento, mas sao citados no front-end como navegacao e busca. Para o MVP, recomenda-se implementar ao menos busca por nome/titulo.

## UC9 - Visualizar Detalhes do Evento

### Ator Primario

Cliente.

### Objetivo

Permitir que o Cliente confira as informacoes do evento antes da reserva.

### Pre-condicoes

- O evento existe e esta publicado.

### Fluxo Principal

1. O Cliente seleciona um evento.
2. O sistema exibe detalhes do evento.
3. O sistema apresenta data, local, preco, disponibilidade e informacoes do item externo.

### Regras de Negocio

- Este caso de uso e obrigatorio dentro de UC10 - Reservar ingresso, pois o Cliente deve conferir os detalhes antes de concluir a reserva.

## UC10 - Reservar Ingresso

### Ator Primario

Cliente.

### Objetivo

Reservar ingresso para um evento publicado.

### Relacionamentos

- Inclui UC9 - Visualizar detalhes do evento.
- Inclui UC11 - Selecionar assento ou quantidade.
- Inclui UC12 - Realizar pagamento simulado.

### Pre-condicoes

- O Cliente esta autenticado.
- O evento esta publicado.
- O evento possui ingressos disponiveis.

### Fluxo Principal

1. O Cliente inicia a reserva.
2. O sistema apresenta os detalhes do evento para conferencia.
3. O Cliente seleciona assento ou quantidade.
4. O sistema verifica disponibilidade.
5. O Cliente realiza o pagamento em ambiente simulado ou sandbox.
6. Se o pagamento for aprovado, o sistema confirma a reserva e emite o ingresso.
7. O ingresso passa a aparecer em Meus ingressos.

### Fluxos Alternativos

- Assento ou quantidade indisponivel: o sistema informa indisponibilidade e impede a reserva.
- Pagamento recusado: o sistema nao emite ingresso e libera a disponibilidade reservada, se houver bloqueio temporario.
- Evento esgotado: o sistema impede a reserva.

### Regras de Negocio

- O mesmo assento/lugar nao pode ser vendido duas vezes.
- A reserva so deve gerar ingresso apos pagamento aprovado.
- Para o MVP, pode ser implementado mapa de assentos ou selecao de quantidade. Recomenda-se escolher apenas um para manter o escopo controlado.
- O pagamento deve ser tratado por uma camada de servico/provedor, permitindo usar simulacao interna no MVP ou sandbox de gateway real sem alterar a regra principal de reserva.

## UC11 - Selecionar Assento ou Quantidade

### Ator Primario

Cliente.

### Objetivo

Escolher o lugar ou a quantidade de ingressos desejada.

### Pre-condicoes

- O Cliente esta reservando ingresso para um evento publicado.

### Fluxo Principal

1. O sistema apresenta mapa de assentos ou seletor de quantidade.
2. O Cliente faz sua escolha.
3. O sistema valida disponibilidade.

### Regras de Negocio

- Se for usado mapa de assentos, cada assento so pode ser vendido uma vez.
- Se for usada quantidade, o sistema deve controlar estoque disponivel.

## UC12 - Realizar Pagamento Simulado

### Ator Primario

Cliente.

### Objetivo

Processar a cobranca da reserva em modo simulado ou sandbox, sem transacao financeira real.

### Pre-condicoes

- O Cliente selecionou assento ou quantidade.
- Existe disponibilidade.

### Fluxo Principal

1. O Cliente informa os dados solicitados no checkout.
2. O sistema envia a tentativa de pagamento para o provedor configurado.
3. O sistema retorna pagamento aprovado ou recusado.

### Fluxos Alternativos

- Pagamento aprovado: o sistema confirma reserva e emite ingresso.
- Pagamento recusado: o sistema informa recusa e nao emite ingresso.

### Regras de Negocio

- Nao deve haver transacao financeira real.
- O fluxo precisa contemplar confirmacao e recusa.
- Para o MVP, o sistema pode usar um provedor interno simulado.
- Caso haja tempo, o provedor interno pode ser substituido por sandbox de gateway real, como Stripe Test Mode ou Mercado Pago em ambiente de teste.
- A regra de negocio da reserva nao deve depender diretamente de um gateway especifico. O sistema deve tratar apenas o resultado normalizado do pagamento: aprovado ou recusado.
- Pagamento aprovado confirma a reserva e permite emissao do ingresso.
- Pagamento recusado nao emite ingresso e deve liberar a disponibilidade previamente bloqueada, se houver bloqueio temporario.

### Decisao de Escopo

A implementacao recomendada e criar uma abstracao de pagamento, por exemplo `PaymentProvider`, com uma primeira versao simulada para garantir o fluxo completo do MVP. Essa escolha preserva a possibilidade de integrar Stripe Test Mode, Mercado Pago Sandbox ou outro gateway posteriormente, sem reescrever o caso de uso de reserva.

## UC13 - Visualizar Meus Ingressos

### Ator Primario

Cliente.

### Objetivo

Listar os ingressos emitidos para o Cliente.

### Relacionamentos

- Inclui UC14 - Visualizar ingresso.

### Pre-condicoes

- O Cliente esta autenticado.

### Fluxo Principal

1. O Cliente acessa a area Meus ingressos.
2. O sistema lista ingressos do Cliente.
3. O Cliente seleciona um ingresso para visualizar.

### Regras de Negocio

- O Cliente so deve visualizar seus proprios ingressos.

## UC14 - Visualizar Ingresso

### Ator Primario

Cliente.

### Objetivo

Exibir o ingresso emitido e seu QR Code.

### Pre-condicoes

- O ingresso foi emitido apos pagamento aprovado.

### Fluxo Principal

1. O Cliente abre um ingresso.
2. O sistema exibe dados do evento.
3. O sistema exibe QR Code ou codigo seguro do ingresso.

### Regras de Negocio

- O QR Code deve representar um codigo seguro, nao facilmente forjavel.
- O QR Code deve permitir que o sistema encontre o ingresso e valide seu status.

## UC15 - Compartilhar Ingresso por Link

### Ator Primario

Cliente.

### Objetivo

Permitir que o Cliente compartilhe um ingresso emitido por meio de um link gerado pela aplicacao.

### Relacionamentos

- Estende UC14 - Visualizar ingresso.

### Pre-condicoes

- O Cliente esta visualizando um ingresso emitido.

### Fluxo Principal

1. O Cliente solicita o compartilhamento do ingresso.
2. O sistema disponibiliza um link compartilhavel.
3. O Cliente copia ou compartilha o link.

### Regras de Negocio

- O link deve apontar para uma visualizacao segura do ingresso.
- O compartilhamento nao deve permitir adulterar dados do ingresso.
- Para o MVP, compartilhar nao significa transferir titularidade.

## UC16 - Validar Ingresso

### Ator Primario

Portaria.

### Objetivo

Validar um ingresso na entrada do evento.

### Relacionamentos

- E estendido por UC17 - Ler QR Code pela camera.
- E estendido por UC18 - Informar codigo manualmente.
- Inclui UC19 - Visualizar resultado da validacao.

### Pre-condicoes

- A Portaria esta autenticada.
- O ingresso possui QR Code ou codigo manual.

### Fluxo Principal

1. A Portaria informa o ingresso por QR Code ou codigo manual.
2. O sistema consulta o ingresso.
3. O sistema identifica o evento relacionado ao ingresso.
4. O sistema verifica autenticidade do codigo.
5. O sistema verifica se o ingresso ja foi utilizado.
6. O sistema verifica se o ingresso pertence ao evento correto.
7. O sistema exibe o resultado da validacao.

### Fluxos Alternativos

- Codigo inexistente ou adulterado: resultado invalido.
- Ingresso ja utilizado: resultado ja utilizado.
- Ingresso pertence a outro evento: resultado evento errado.
- Ingresso valido: resultado valido e liberacao para registrar entrada.

### Regras de Negocio

- O mesmo ingresso nao pode ser validado duas vezes.
- A validacao deve ser feita no back-end.
- A tela deve apresentar retorno claro para a Portaria.

## UC17 - Ler QR Code pela Camera

### Ator Primario

Portaria.

### Objetivo

Permitir que a Portaria leia o codigo do ingresso usando a camera.

### Relacionamentos

- Estende UC16 - Validar ingresso.

### Pre-condicoes

- O dispositivo possui camera disponivel.
- O navegador tem permissao de camera.

### Fluxo Principal

1. A Portaria abre a tela de leitura.
2. O sistema solicita permissao de camera, se necessario.
3. A Portaria aponta a camera para o QR Code.
4. O sistema captura o codigo e inicia a validacao.

### Fluxos Alternativos

- Camera indisponivel ou sem permissao: a Portaria pode usar UC18 - Informar codigo manualmente.

## UC18 - Informar Codigo Manualmente

### Ator Primario

Portaria.

### Objetivo

Permitir validacao quando a leitura por camera nao for possivel.

### Relacionamentos

- Estende UC16 - Validar ingresso.

### Fluxo Principal

1. A Portaria digita o codigo do ingresso.
2. O sistema inicia a validacao.

### Regras de Negocio

- O codigo manual deve seguir o mesmo processo de validacao do QR Code.

## UC19 - Visualizar Resultado da Validacao

### Ator Primario

Portaria.

### Objetivo

Exibir o resultado da validacao do ingresso de forma clara.

### Pre-condicoes

- Uma tentativa de validacao foi executada.

### Fluxo Principal

1. O sistema exibe o status da validacao.
2. O sistema exibe dados essenciais do ingresso e do evento.
3. O sistema indica se a entrada pode ser registrada.

### Resultados Possiveis

- Valido.
- Invalido.
- Ja utilizado.
- Evento errado.

### Regras de Negocio

- Em caso de evento errado, o sistema deve deixar claro que o ingresso existe, mas nao pertence ao evento em operacao.
- Em caso de ja utilizado, o sistema deve impedir nova entrada.

## UC20 - Registrar Entrada

### Ator Primario

Portaria.

### Objetivo

Confirmar a entrada de um participante usando um ingresso validado.

### Relacionamentos

- Inclui UC16 - Validar ingresso.

### Pre-condicoes

- A Portaria esta autenticada.
- O ingresso foi validado como valido.

### Fluxo Principal

1. A Portaria registra a entrada.
2. O sistema valida o ingresso.
3. O sistema marca o ingresso como utilizado.
4. O sistema informa sucesso.

### Fluxos Alternativos

- Ingresso invalido, ja utilizado ou de evento errado: o sistema nao registra a entrada.

### Decisao de Escopo

Para o MVP, ha duas opcoes aceitaveis:

- entrada automatica: o sistema marca como utilizado assim que o ingresso e validado como valido;
- entrada manual: a Portaria valida, confere os dados e clica em registrar entrada.

A versao atual do diagrama mantem Registrar entrada como caso de uso separado. Se a implementacao optar por entrada automatica, este caso pode ser incorporado ao UC16 - Validar ingresso em uma versao futura do diagrama.

## Rastreabilidade com Requisitos do Desafio

| Requisito do desafio | Casos de uso relacionados |
| --- | --- |
| Navegacao e busca pelos eventos publicados | UC7, UC8, UC9 |
| Criacao e gerenciamento dos eventos pelo organizador | UC2, UC3, UC4, UC5, UC6 |
| Reserva com assento ou quantidade | UC10, UC11 |
| Pagamento simulado com confirmacao e recusa | UC12 |
| Area Meus ingressos com QR Code | UC13, UC14 |
| Tela de portaria para validar ingresso | UC16, UC19, UC20 |
| Leitura de QR pela camera e codigo manual | UC17, UC18 |
| API externa Ticketmaster ou TMDb | UC3 |
| Autenticacao com tres papeis | UC1 |
| Armazenamento de eventos, reservas e ingressos | UC2, UC10, UC14, regras internas |
| Nao vender o mesmo lugar duas vezes | UC10, UC11 |
| QR Code nao forjavel | UC14, UC16 |
| Compartilhar ingresso por link | UC15 |
| Nao validar o mesmo ingresso duas vezes | UC16, UC20 |

## Observacoes para Implementacao

- Priorizar o fluxo completo de ponta a ponta antes de opcionais.
- Manter usuarios seedados para facilitar a avaliacao.
- Registrar no README as decisoes tomadas, especialmente sobre:
  - uso de IA;
  - escolha da API externa;
  - escolha entre mapa de assentos ou quantidade;
  - comportamento do registro de entrada;
  - limites do MVP.
- Recuperacao de senha, revenda, envio de e-mail e aplicativo nativo ficam fora do escopo, conforme o documento do desafio.
