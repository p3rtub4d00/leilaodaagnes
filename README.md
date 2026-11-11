# 🎁 Leilão Surpresa da Agnes

Aplicação de festa com **créditos fictícios**. Não processa dinheiro, apostas ou pagamentos reais.

## Endereços

- `/` — Convidados: cadastro apenas com nome, 1.000 créditos fictícios, lances, histórico e ranking.
- `/telao` — Telão para TV/monitor, com atualização instantânea, cronômetro, maior lance e animação de arremate.
- `/admin` — Painel protegido por senha para cadastrar, editar e excluir pacotes; iniciar, pausar, continuar ou encerrar o leilão; consultar participantes; reiniciar dados de teste.

Os pacotes são **surpresa**: o administrador pode registrar o conteúdo real em `O que há dentro?`, mas essa informação **não aparece para os convidados**. Fotos são opcionais; sem elas aparece uma caixa misteriosa ilustrada. Os lances só descontam créditos do **vencedor quando a rodada termina**. Apostas cobertas não consomem créditos.

## Publicar no Render

1. No Render, **New → Web Service** e conecte o repositório `p3rtub4d00/leilaodaagnes`.
2. Configure **Runtime: Node**, **Build Command: `npm install`**, **Start Command: `npm start`**.
3. Em **Environment**, crie:
   - `MONGODB_URI` — conexão do MongoDB Atlas, banco `leilaodaagnes`.
   - `ADMIN_PASSWORD` — senha longa e privada escolhida por você, para o painel `/admin`.
   - `SESSION_SECRET` — texto aleatório e longo, preferencialmente 32+ caracteres.
   - `NODE_ENV=production`.
4. No MongoDB Atlas, crie um usuário de banco, autorize as conexões do Render em **Network Access**, copie a string URI e substitua usuário, senha e nome do banco. Senhas com caracteres especiais devem estar codificadas para URL.
5. Faça o deploy. Não salve os dados de acesso no GitHub.

Também existe um arquivo `render.yaml` para criar o serviço por Blueprint (nesse caso preencha as variáveis marcadas como secretas).

### Demonstração sem MongoDB

Sem `MONGODB_URI`, o sistema ainda abre em **modo temporário**, com banco em memória. Todos os dados **desaparecem quando o servidor reinicia** — não utilize esse modo durante a festa. O painel exibe um aviso.

Sem `ADMIN_PASSWORD` e `SESSION_SECRET`, o login administrativo é bloqueado.

## Como organizar a festa

1. Acesse `/admin` e cadastre os pacotes. Fotografe cada um **embrulhado** e registre o conteúdo secreto apenas no painel.
2. Abra `/telao` no navegador da TV, clique em **Tela cheia** e ative **Som** se desejar. É possível conectar notebook por HDMI ou transmitir a aba.
3. Compartilhe o endereço principal com os convidados. Cada pessoa se identifica apenas pelo nome e recebe 1.000 créditos.
4. Na lista de pacotes, clique em **Leiloar** para escolher qual entra no telão. O timer inicia e os convidados podem oferecer lances.
5. O timer é **controlado pelo servidor**. Se um novo lance chegar nos últimos 10 segundos, a rodada é estendida até garantir mais 10 segundos.
6. Ao final, o sistema anuncia o vencedor e debita somente os créditos utilizados no lance vencedor. O pacote não pode ser leiloado novamente, a menos que seja removido/recriado.
7. Revele o presente somente **depois** do arremate. A tela permanece no resultado até você iniciar o próximo pacote.

## Regras

- Cada navegador recebe uma sessão de convidado. A opção **Trocar participante** permite outro convidado usar o mesmo celular; a conta anterior não é apagada.
- Um convidado não pode aumentar o próprio lance enquanto está liderando.
- O próximo lance mínimo segue o incremento definido no pacote; o convidado pode escolher um dos três valores oferecidos.
- Sem lances ao final, o pacote volta a ficar disponível para outra rodada.
- Lances simultâneos são controlados por atualização atômica do documento do leilão. A aplicação foi projetada para uma instância Node/Render durante a festa.
- A administração usa cookie de sessão assinado, `HttpOnly`, com duração de 12 horas.
- **Zerar tudo** apaga permanentemente todos os dados do leilão. Exige digitar `ZERAR TUDO`.

## Tecnologias

Node.js 20+, Express, Socket.IO, MongoDB/Mongoose, HTML/CSS/JavaScript responsivo. Sem build de frontend. As ilustrações SVG estão em `public/assets/`.

`npm install` e depois `npm start` para execução local. Em produção, a porta é definida pelo Render via `PORT`.

**Nota:** o projeto usa exclusivamente créditos de brincadeira, sem depósitos, Pix, saques, compras ou conversão em dinheiro.

## Lance livre (atualização)

Além dos três botões de valores sugeridos, o convidado pode digitar **um lance personalizado em créditos inteiros**, por exemplo 125, 327 ou 600. O servidor aceita qualquer valor inteiro **igual ou maior** que o lance atual + incremento mínimo do pacote (ou lance inicial na primeira oferta), respeitando os créditos do convidado. Os valores sugeridos continuam disponíveis para facilitar o uso no celular.

## Proteção contra múltiplas contas

- Por padrão, há **uma conta por navegador/aparelho**. Um cookie seguro `agnes_device` (HttpOnly, 180 dias) identifica o dispositivo, é vinculado à conta na base de dados e permite reabrir a conta mesmo se o usuário limpar o localStorage.
- Uma conta já vinculada não consegue se cadastrar novamente no mesmo navegador. O botão **Trocar participante** foi removido.
- No **Admin → Controle de cadastros**, o organizador pode **fechar ou reabrir novos cadastros** a qualquer momento.
- Para proteção mais forte, ative **Exigir código individual**: o administrador gera códigos aleatórios `AG-XXXXXXXX`, copia os disponíveis e distribui **um por convidado**. Cada código é **utilizável apenas uma vez**, inclusive se alguém mudar de navegador ou usar uma aba anônima.
- O painel permite **bloquear/desbloquear convidados**, impedindo lances de contas suspeitas.
- Códigos e bloqueios persistem no MongoDB Atlas; o comando **Zerar tudo** também limpa os códigos e configurações.
- **Limitação importante:** navegadores não conseguem identificar fisicamente um celular de forma infalível. Remover cookies, usar aba anônima ou outro navegador pode contornar a restrição simples de aparelho. Os códigos individuais são a proteção recomendada para a festa. Um convidado que obtiver códigos extras de outras pessoas ainda poderá criar contas extras; distribua um código por pessoa e feche cadastros após todos entrarem.

