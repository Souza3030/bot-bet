# MamoBall Solo Bet Bot (1v1 — dinheiro real via PIX)

Bot de fila **apostada** Solo (1v1): em vez de pontos/patente, os jogadores
apostam dinheiro real via PIX (Mercado Pago) e quem vencer leva o pote.

## ⚠️ Antes de colocar no ar

**Apostas em dinheiro real são reguladas no Brasil** pela Lei 14.790/2023
(Lei das Apostas de Quota Fixa), fiscalizada pela SPA (Secretaria de Prêmios
e Apostas, Ministério da Fazenda). Operar isso sem autorização pode ter
consequências legais sérias. **Fale com um advogado antes de rodar isso com
dinheiro de verdade.** Este projeto é a implementação técnica que você
pediu — não é uma avaliação de que a operação é legal para o seu caso.

**A API de Payout PIX do Mercado Pago** (usada para pagar o vencedor
automaticamente) normalmente **precisa de aprovação comercial prévia** da
Mercado Pago — não costuma estar disponível de cara em contas novas. Por
isso este bot tem um **fallback manual**: se o payout automático falhar, a
Staff recebe um aviso no canal configurado com todos os dados (chave PIX,
valor, CPF) e um botão para marcar como "pago manualmente" depois de fazer
a transferência por fora.

## Como funciona

1. `/apostar` → mostra um select com os valores fixos (R$ 1, 3, 5, 10, 25,
   50, 100 — configurável em `config.bet.tiers`).
2. Ao escolher um valor, abre um modal pedindo **chave PIX**, **tipo da
   chave** (CPF/CNPJ/EMAIL/PHONE/RANDOM) e **CPF/CNPJ do titular** — dados
   necessários pra pagar o prêmio se o jogador vencer.
3. O bot cria uma cobrança PIX no Mercado Pago e responde com o QR Code +
   código "copia e cola" (ephemeral, só o jogador vê).
4. Quando o Mercado Pago confirma o pagamento (via **webhook**), o jogador
   entra na fila (Firestore, coleção `soloBetQueue`) esperando alguém que
   tenha apostado o **mesmo valor**.
5. Ao parear, os 2 jogadores confirmam presença (check-in, 60s por padrão).
   Se só um confirmar, ele volta pra fila (mantendo o dinheiro em jogo) e o
   outro é **reembolsado automaticamente**. Se ninguém confirmar, os dois
   são reembolsados.
6. Com os 2 confirmados, a partida é criada normalmente (canais privados +
   registro de resultado + aprovação da Staff).
7. Ao a Staff **aprovar** o resultado, o vencedor recebe o pote (as duas
   apostas, menos a taxa da casa se configurada) via **PIX automático**. Se
   a Staff **anular** a partida, os dois são reembolsados.

## Webhook do Mercado Pago — infraestrutura necessária

Este bot sobe um pequeno servidor HTTP (Express) pra receber as
notificações de pagamento do Mercado Pago. Isso significa que, diferente
dos outros bots MamoBall, **você precisa de uma URL pública** apontando
pra essa porta:

- Em produção: seu domínio/VPS com HTTPS, redirecionando pro
  `MERCADOPAGO_WEBHOOK_PORT` configurado.
- Em desenvolvimento: um túnel como [ngrok](https://ngrok.com/) ou
  Cloudflare Tunnel (`cloudflared`), ex: `ngrok http 3000`.

Configure a URL pública resultante em `MERCADOPAGO_WEBHOOK_PUBLIC_URL` no
`.env` (sem barra final, sem o caminho — o bot completa com
`/webhooks/mercadopago` sozinho).

## Configuração

1. Copie `.env.example` para `.env` e preencha:
   - Credenciais do Discord (token, client ID, guild ID, canais).
   - `MERCADOPAGO_ACCESS_TOKEN` (Painel de Desenvolvedores do Mercado Pago).
   - `MERCADOPAGO_WEBHOOK_SECRET` (configurado em Painel > Webhooks > Assinatura secreta).
   - `MERCADOPAGO_WEBHOOK_PUBLIC_URL` e `MERCADOPAGO_WEBHOOK_PORT`.
2. Copie `serviceAccountKey.example.json` para `serviceAccountKey.json` com
   as credenciais reais do Firebase.
3. `npm install`, depois `npm run deploy-commands` e `npm run dev`.

## Dados de auditoria

Toda aposta fica registrada na coleção `soloBets` do Firestore com seu
status completo (`aguardando_pagamento` → `na_fila` → `pareada` →
`em_partida` → `paga_vencedor`/`perdida`/`reembolsada`/
`pagamento_manual_pendente`). Use isso pra conferência financeira e
resolução de disputas.

## Limitações conhecidas desta primeira versão (Solo/1v1)

- Sem sistema de pontos/patente — é só dinheiro.
- Sem histórico/estatísticas expostas em `/perfil` (pode ser adicionado).
- O payout automático depende da aprovação da API de Payouts pela Mercado
  Pago; sem ela, todo pagamento cai no fluxo manual da Staff.
- Próximos passos (mesma estrutura, times fixos): duo (2v2), trio (3v3) e
  squad (4v4) apostados — cada um exigirá um valor de aposta **por
  jogador**, com o pote dividido entre os membros do time vencedor.
