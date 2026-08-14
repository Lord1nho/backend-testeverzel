# Limitações do Projeto

Durante o desenvolvimento e validação do projeto, foram identificadas algumas limitações e pontos que podem ser aprimorados em versões futuras.

>  **Aplicação em produção:** https://vzel-cinema.vercel.app/

> ⚠️ **Observação:** o backend está hospedado no Render e pode entrar em modo *sleep* após um período de inatividade. Por isso, a primeira requisição após esse período pode demorar um pouco mais para responder. Após a inicialização do backend, as requisições seguintes tendem a responder normalmente.

## 1. Persistência de Cookies em Produção

Em ambiente de produção (deploy), foram observadas limitações relacionadas à persistência de cookies em determinados contextos de navegação privada e em navegadores iOS.

Essa limitação pode afetar a persistência da sessão e, consequentemente, o fluxo de autenticação do usuário.

## 2. Fallback para Bearer Token

Como melhoria futura, pode ser implementado um mecanismo de **fallback utilizando Bearer Token**, permitindo maior compatibilidade em ambientes nos quais o armazenamento ou envio de cookies apresente restrições.

Essa abordagem pode ser considerada principalmente para cenários como navegadores com políticas mais restritivas de cookies e determinados ambientes mobile.

## 3. Rate Limiting no Backend

Atualmente, o backend pode receber múltiplas requisições consecutivas sem uma política específica de **rate limiting** para determinados endpoints.

Como melhoria, recomenda-se implementar limitação de requisições principalmente em operações sensíveis ou sujeitas a abuso, como:

* **Login** — prevenção contra tentativas excessivas de autenticação;
* **Pagamentos** — prevenção contra múltiplas solicitações indevidas;
* **Reservas** — redução de requisições excessivas e possíveis abusos do fluxo de reserva.

A implementação de rate limiting contribuiria para aumentar a segurança, estabilidade e resiliência da API.

## 4. Checkout em Sessões Simultâneas

Em cenários onde a mesma conta é utilizada em **dois logins ou sessões simultâneas**, o segundo login não é redirecionado automaticamente para um checkout que tenha sido iniciado anteriormente pela mesma conta.

Caso o usuário realize uma nova reserva nessa segunda sessão, será necessário selecionar **outros assentos disponíveis**, mesmo que as duas sessões estejam vinculadas à mesma conta.

Essa limitação está relacionada ao gerenciamento de estado do checkout entre múltiplas sessões simultâneas e pode ser aprimorada futuramente para permitir a recuperação e sincronização de um checkout já iniciado.
