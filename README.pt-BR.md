# PathBlender

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文（香港）](README.zh-Hant.md) | [Español](README.es.md) | [Français](README.fr.md) | [Türkçe](README.tr.md) | **Português (Brasil)** | [עברית](README.he.md)

**Veja juntos as trajetórias autônomas da sua aliança. Encontre os conflitos antes do jogo.**

[**Experimente no navegador**](https://pathblender.pages.dev) ·
[Baixe o aplicativo de desktop](https://github.com/LYT259/pathblender/releases) ·
[Primeira checagem de trajetórias](docs/user-guide.en.md#try-it-without-files) ·
[Star no GitHub](https://github.com/LYT259/pathblender)

O PathBlender reúne as trajetórias do Choreo e do PathPlanner em um só campo e um só relógio para a estratégia de alianças da FRC. Reproduza os robôs juntos, encontre um conflito e compare um horário de partida diferente antes de fechar o plano.

![Uma sessão de prática sintética: localize uma sobreposição, atrase o B e reproduza o plano alterado](docs/screenshots/first-check.gif)

*Trajetórias de ensino originais num campo de treino, não um jogo real. Faça sua própria checagem direto da tela de boas-vindas — sem arquivos, sem instalação e sem conta.*

- **Reúne ferramentas diferentes:** importe arquivos do Choreo, do PathPlanner e `.ghostauto` do Collaborative.
- **Torna a temporização visível:** reprodução compartilhada, checagens de colisão e comparação de horários de partida em nível de sessão.
- **Mantém as trajetórias na sua máquina:** a análise e a verificação acontecem localmente.

Se isso for útil ou interessante para você, **dê uma Star no repositório** para apoiar o PathBlender e encontrá-lo de novo mais tarde.

## Por quê

Nos jogos de classificação e playoff da FRC, os três robôs de uma aliança executam seus programas autônomos no mesmo campo, ao mesmo tempo. Cada equipe planeja trajetórias em ferramentas diferentes (Choreo, PathPlanner) e comparar exportações separadas dificulta enxergar sobreposições antes do jogo.

O PathBlender preenche essa lacuna:

- **Importação multi-ferramenta** — Choreo `.traj`, `.ghostauto` do fork Collaborative da equipe 103 e `.path` / `.auto` nativos do PathPlanner (a geração de trajetória foi portada para TypeScript);
- **Reprodução em linha do tempo unificada** — todos os robôs em um único relógio de autônomo (15 s; 20 s na temporada 2026), reproduzir / pausar / arrastar / controle de velocidade (0,25×–1×);
- **Verificação de colisões e interferências** — sobreposição de retângulos de para-choques (OBB) ao longo de toda a linha do tempo, com relatório de conflitos (quem, quando, onde) e marcações de fora do campo;
- **Vista 3D do campo** — modelos oficiais dos campos da FRC 2022–2026 (construções soldada e AndyMark quando diferem), órbita livre e enquadramento em um clique; campos personalizados importados ficam em 2D. A vista 2D oferece um estilo esquemático e um renderizado por temporada, com a disposição oficial de AprilTags sobreposta;
- **Biblioteca de rotas** — importe a pasta deploy inteira de uma equipe: arquivos alheios são ignorados e cada rota entra numa biblioteca; um seletor ao lado de cada robô troca o autônomo ativo em tempo real. Os `settings.json` do PathPlanner aplicam as dimensões reais dos para-choques;

- **Zero instalação, zero envio (web)** — um web app estático: os arquivos de trajetórias são analisados e verificados localmente no seu navegador;
- **Também um aplicativo de desktop** — a mesma interface num envoltório Tauri leve para macOS, Windows e Linux, que acrescenta salvar/abrir sessões, repetição em GIF e exportação de pacote de solução, além de atualizações dentro do app (canal estável ou beta). As verificações de atualização do desktop contatam o GitHub Releases.

## Início rápido

1. Obtenha o aplicativo (veja abaixo) — ou aperte **Experimente sua primeira checagem de trajetórias** na tela de boas-vindas para um exercício guiado com três trajetórias sintéticas. **Experimentar um exemplo** abre à parte a sessão multi-robô embutida.
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

- **macOS** (macOS 13+) — baixe o DMG Universal (`*_universal.dmg`; um único download para Apple Silicon e Intel) do [GitHub Releases](https://github.com/LYT259/pathblender/releases), abra e arraste o PathBlender para os Aplicativos.
- **Windows** (x86_64) — baixe o instalador NSIS `*_x64-setup.exe` da página de releases e execute-o.
- **Linux** (x86_64) — baixe o pacote DEB, AppImage ou RPM da página de releases (o guia do usuário traz exemplos de instalação pelo terminal). As atualizações dentro do app usarão o AppImage; usuários de DEB/RPM atualizarão instalando o pacote novo por cima do antigo.
- Atualizações: menu **PathBlender → Buscar atualizações…** (em betas: antes ative o canal beta em **Preferências → Atualizações**). Os demais arquivos da página de releases (`.tar.gz`, `.sig`, `.json`) são internos do atualizador — você não precisa deles.
- **Web app** (build visualizador: as mesmas importações do aplicativo — arquivos e pastas inteiras — mais reprodução e verificação; sem salvar sessão nem exportar GIF ou pacote de solução) — [pathblender.pages.dev](https://pathblender.pages.dev).

## Privacidade

Os arquivos de trajetórias são analisados **inteiramente na sua máquina**. Não há backend, contas, telemetria nem analytics. O navegador baixa o aplicativo e seus recursos; as verificações de atualização do desktop contatam o GitHub Releases. Arquivos de trajetórias não são enviados. Links externos abrem o destino indicado quando você os seleciona.

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
A Swerve Drive Specialties (SDS) deu permissão expressa por escrito para usar e distribuir com o PathBlender os recursos de visualização derivados do CAD do SDS MK5i; essa permissão não cobre a geometria do Kraken X60 da WCP nem o chassi construído pelo usuário. Veja detalhes no NOTICE.

As artes dos campos e os nomes dos jogos pertencem à FIRST e são usados para fins não comerciais de estratégia de equipes conforme a política de marcas e materiais protegidos da FIRST, verificada novamente antes de cada lançamento público:

> FIRST®, FIRST® Robotics Competition e FIRST® Tech Challenge são marcas registradas da FIRST® (www.firstinspires.org), que não supervisiona, não participa e não é responsável por esta atividade, produto ou serviço.

> FIRST®, FIRST® Robotics Competition, and FIRST® Tech Challenge, are registered trademarks of FIRST® (www.firstinspires.org) which is not overseeing, involved with, or responsible for this activity, product, or service.

For the FIRST copyrighted materials included in PathBlender:

> ©2025 For Inspiration and Recognition of Science and Technology (FIRST). Used by special permission. All rights reserved. FIRST is not overseeing, involved with, or responsible for this activity, product, or service.
