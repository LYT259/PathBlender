# PathBlender

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文（香港）](README.zh-Hant.md) | [Español](README.es.md) | [Français](README.fr.md) | [Türkçe](README.tr.md) | **Português (Brasil)** | [עברית](README.he.md)

**Visualizador de fusão multi-fonte de trajetórias autônomas para a estratégia de alianças da FRC.**

Funde, em um mesmo campo, os arquivos de trajetórias autônomas exportados por diferentes cadeias de ferramentas: reprodução em uma linha do tempo unificada e verificação de colisões, feito para os **grupos de estratégia da aliança** — não só para a equipe de programação. É um **visualizador**: analise os autônomos que você tem, encontre os conflitos, corrija na ferramenta que é dona da trajetória, reimporte e confira de novo.

![Vista 3D do campo](docs/screenshots/field3d.png)

## Por quê

Nos jogos de classificação e playoff da FRC, os três robôs de uma aliança executam seus programas autônomos no mesmo campo, ao mesmo tempo. Cada equipe planeja trajetórias em ferramentas diferentes (Choreo, PathPlanner) e ninguém consegue ver se os autônomos resultantes vão colidir — até colidirem de verdade, no meio do jogo.

O PathBlender preenche essa lacuna:

- **Importação multi-ferramenta** — Choreo `.traj`, `.ghostauto` do fork Collaborative da equipe 103 e `.path` / `.auto` nativos do PathPlanner (a geração de trajetória foi portada para TypeScript — nenhuma outra ferramenta web faz isso);
- **Reprodução em linha do tempo unificada** — todos os robôs em um único relógio de autônomo (15 s; 20 s na temporada 2026), reproduzir / pausar / arrastar / controle de velocidade (0,25×–1×);
- **Verificação de colisões e interferências** — sobreposição de retângulos de para-choques (OBB) ao longo de toda a linha do tempo, com relatório de conflitos (quem, quando, onde) e marcações de fora do campo;
- **Vista 3D do campo** — modelos oficiais dos campos da FRC 2022–2026 (construções soldada e AndyMark quando diferem), órbita livre e enquadramento em um clique; campos personalizados importados ficam em 2D. A vista 2D oferece um estilo esquemático e um renderizado por temporada, com a disposição oficial de AprilTags sobreposta;
- **Biblioteca de rotas** — importe a pasta deploy inteira de uma equipe: arquivos alheios são ignorados e cada rota entra numa biblioteca; um seletor ao lado de cada robô troca o autônomo ativo em tempo real. Os `settings.json` do PathPlanner aplicam as dimensões reais dos para-choques;

- **Zero instalação, zero envio (web)** — um web app puramente estático: os arquivos são analisados localmente no seu navegador, e a build web **não faz nenhuma requisição de rede**;
- **Também um aplicativo de desktop** — a mesma interface num envoltório Tauri leve para macOS, Windows e Linux, que acrescenta salvar/abrir sessões, repetição em GIF e exportação de pacote de solução, além de atualizações dentro do app (canal estável ou beta). Sua única atividade de rede é a verificação de atualizações que você disparar, que contata o GitHub Releases.

## Início rápido

1. Obtenha o aplicativo (veja abaixo) — ou, sem arquivos à mão, aperte **Experimentar um exemplo** na tela de boas-vindas para carregar uma sessão multi-robô embutida e ver na hora a reprodução e a verificação de colisões.
2. Importe os arquivos de trajetórias de cada parceiro da aliança — `.traj`, `.ghostauto`, `.path`, `.auto`, misturados livremente (um arquivo ou uma pasta inteira, na web e no desktop; cada `.path` referenciado por um `.auto` deve chegar no mesmo lote). Arquivos quebrados são relatados um a um sem parar os demais.
3. Aperte **reproduzir**. Os conflitos aparecem como anéis vermelhos no campo, trechos vermelhos na linha do tempo e entradas no painel de conflitos (quem, quando, onde) — clique numa para pular o relógio direto para aquele instante.
4. Investigue: troque a rota de um robô pela biblioteca, alterne a visão da aliança ou avance o relógio. Quando souber o que precisa mudar, faça a mudança na ferramenta da equipe dona, reexporte e solte o arquivo novo — a sessão se atualiza no lugar.
5. **Compartilhe** o resultado: salve um arquivo de sessão ou exporte um GIF da vista 2D — junto com um pacote de solução com tudo de que o parceiro precisa — para o chat da aliança (aplicativo de desktop).

![Relatório de colisões](docs/screenshots/collision-report.png)

## Formatos suportados

| Formato | Origem | Observações |
|---|---|---|
| `.traj` | Choreo (SleipnirGroup, BSD-3) | Todas as versões de esquema conhecidas; estados amostrados no tempo |
| `.ghostauto` | Fork Collaborative do PathPlanner (FRC 103, MIT) | Inclui geometria dos para-choques e nome da equipe |
| `.path` | PathPlanner (MIT) | Trajetória gerada localmente — algoritmo do PathPlannerLib portado |
| `.auto` | PathPlanner (MIT) | Sequências de trajetórias com semântica de esperas e comandos |
| `settings.json` | PathPlanner (MIT) | Dimensões dos para-choques dos robôs do projeto |
| `.pb` | Este projeto | Arquivo de sessão: todos os robôs + configurações + campo (o `.ghpb.json` de antes da renomeação também abre) |

Campos: FRC 2022–2026 embutidos, além da importação de campos personalizados com calibração e um JSON de disposição de AprilTags do WPILib/PhotonVision (serve para qualquer outra temporada ou um campo de treino).

## Onde obter

- **macOS** (macOS 13+; um único download Universal para Apple Silicon e Intel) — `PathBlender_<versão>_universal.dmg` do [GitHub Releases](https://github.com/LYT259/pathblender/releases): abra e arraste o PathBlender para os Aplicativos.
- **Windows** (x86_64) — o instalador `*_x64-setup.exe` da mesma página.
- **Linux** (x86_64) — pacotes DEB, AppImage e RPM da mesma página. As atualizações dentro do app usam o AppImage; usuários de DEB/RPM atualizam instalando o pacote novo por cima do antigo.
- Atualizações: menu **PathBlender → Buscar atualizações…** (em betas: antes ative o canal beta em **Preferências → Atualizações**). Os demais arquivos da página de releases (`.tar.gz`, `.sig`, `.json`) são internos do atualizador — você não precisa deles.
- **Web app** (build visualizador: as mesmas importações do aplicativo — arquivos e pastas inteiras — mais reprodução e verificação; sem salvar sessão nem exportar GIF ou pacote de solução) — [pathblender.pages.dev](https://pathblender.pages.dev).

## Privacidade

Os arquivos de trajetórias são analisados **inteiramente na sua máquina**. Não há backend, contas, telemetria nem analytics. A build web não faz nenhuma chamada de rede; o aplicativo de desktop contata a rede apenas na verificação de atualizações que você disparar (GitHub Releases) — arquivos de trajetórias nunca saem do aplicativo.

Também inclui: visão de aliança vermelha/azul por sessão, anotações de número de equipe por robô, os campos de temporada acima com AprilTags oficiais sobrepostos e uma interface em **43 idiomas** — lista completa no menu de idioma — nos temas claro e escuro (segue o sistema).

Guia completo por ferramenta e FAQ (em inglês e chinês):
[English](docs/user-guide.en.md) ·
[简体中文](docs/user-guide.zh.md).

## Feedback

Bugs, relatos de deriva de formato e problemas de campos de temporada são exatamente o feedback de que precisamos. Abra uma issue em
[github.com/LYT259/pathblender/issues](https://github.com/LYT259/pathblender/issues) —
o [modelo de feedback](docs/community/feedback-template.md) mostra o que incluir (nunca vai ser pedido que você publique seus arquivos de trajetórias). A discussão da comunidade fica no thread de anúncio do projeto no Chief Delphi.

## Situação

O escopo de visualizador descrito acima está implementado e coberto por testes de regressão. As builds de desktop são publicadas no [GitHub Releases](https://github.com/LYT259/pathblender/releases).

## Licença e atribuição

**Apache-2.0** — veja [LICENSE](./LICENSE) e [NOTICE.md](./NOTICE.md).
PathPlanner (MIT), Choreo (BSD-3), os recursos do AdvantageScope (BSD-3) e o WPILib (BSD-3) permanecem sob as próprias licenças e são creditados no NOTICE.

As artes dos campos e os nomes dos jogos pertencem à FIRST e são usados para fins não comerciais de estratégia de equipes conforme a política de marcas e materiais protegidos da FIRST, verificada novamente antes de cada lançamento público:

> FIRST®, FIRST® Robotics Competition e FIRST® Tech Challenge são marcas registradas da FIRST® (www.firstinspires.org), que não supervisiona, não participa e não é responsável por esta atividade, produto ou serviço.
