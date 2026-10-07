# PathBlender

[English](README.md) | [简体中文](README.zh-CN.md) | [繁體中文（中國香港）](README.zh-Hant.md) | **Español** | [Français](README.fr.md) | [Türkçe](README.tr.md) | [Português (Brasil)](README.pt-BR.md) | [עברית](README.he.md)

**Visor de fusión de rutas autónomas multifuente para la estrategia de alianzas de FRC.**

Combina en un mismo campo los archivos de rutas autónomas exportados por distintas cadenas de herramientas: reproducción en una línea de tiempo unificada y comprobación de colisiones, pensado para los **grupos de estrategia de la alianza** — no solo para el equipo de programación. Es un **visor**: analiza las autonomías que ya tienes, encuentra los conflictos, corrige en la herramienta dueña de la ruta, vuelve a importar y comprueba de nuevo.

![Vista 3D del campo](docs/screenshots/field3d.png)

## Por qué

En los partidos de clasificación y eliminatorias de FRC, los tres robots de una alianza ejecutan sus programas autónomos sobre el mismo campo al mismo tiempo. Cada equipo planifica sus rutas en herramientas distintas (Choreo, PathPlanner) y nadie puede ver si las autonomías resultantes van a chocar — hasta que chocan de verdad, en pleno partido.

PathBlender cubre ese hueco:

- **Importación multifuente** — Choreo `.traj`, `.ghostauto` del fork Collaborative del equipo 103 y `.path` / `.auto` nativos de PathPlanner (la generación de trayectorias está portada a TypeScript — ninguna otra herramienta web hace esto);
- **Reproducción en línea de tiempo unificada** — todos los robots sobre un mismo reloj autónomo (15 s; 20 s en la temporada 2026), reproducir / pausar / desplazar / controlar la velocidad (0,25×–1×);
- **Comprobación de colisiones e interferencias** — solapamiento de rectángulos de parachoques (OBB) a lo largo de toda la línea de tiempo, con informe de conflictos (quiénes, cuándo, dónde) y marcas de salida del campo;
- **Vista 3D del campo** — modelos oficiales de los campos de FRC 2022–2026 (construcción soldada y de AndyMark cuando difieren), órbita libre y encuadre en un clic; los campos personalizados importados permanecen en 2D. La vista 2D ofrece un estilo esquemático y otro renderizado por temporada, con la disposición oficial de AprilTags superpuesta;
- **Biblioteca de rutas** — importa una carpeta completa del directorio deploy de cualquier equipo: los archivos ajenos se omiten y cada ruta entra en una biblioteca; un selector junto a cada robot cambia su autonomía activa en vivo. Los `settings.json` de PathPlanner aplican las dimensiones reales de los parachoques;

- **Cero instalación, cero subidas (web)** — una aplicación web puramente estática: los archivos se analizan localmente en tu navegador y la compilación web **no hace ninguna petición de red**;
- **También aplicación de escritorio** — la misma interfaz en un entorno Tauri ligero para macOS, Windows y Linux, que añade guardar/abrir sesiones, repetición GIF y exportación de paquete de solución, y actualizaciones integradas (canal estable o beta). Su única actividad de red es la comprobación de actualizaciones que tú disparas, que contacta con GitHub Releases.

## Inicio rápido

1. Consigue la aplicación (ver abajo) — o, sin archivos a mano, pulsa **Probar un ejemplo** en la pantalla de bienvenida para cargar una sesión multirrobot integrada y ver la reproducción y la comprobación de colisiones al instante.
2. Importa los archivos de rutas de cada equipo de la alianza — `.traj`, `.ghostauto`, `.path`, `.auto`, mezclados libremente (un archivo o una carpeta entera, en la web y en el escritorio; cada `.path` referenciado por un `.auto` debe llegar en el mismo lote). Los archivos rotos se informan uno a uno sin detener a los demás.
3. Pulsa **reproducir**. Los conflictos aparecen como anillos rojos en el campo, segmentos rojos en la línea de tiempo y entradas en el panel de conflictos (quiénes, cuándo, dónde) — pulsa una para saltar el reloj a ese instante.
4. Investiga: cambia la ruta de un robot desde la biblioteca, alterna la vista de alianza o avanza el reloj. Cuando sepas qué hay que cambiar, hazlo en la herramienta del equipo dueño, reexporta y suelta el archivo nuevo — la sesión se actualiza en el sitio.
5. **Comparte** el resultado: guarda un archivo de sesión o exporta un GIF de la vista 2D — además de un paquete de solución con todo lo que necesita el socio — para el chat de la alianza (aplicación de escritorio).

![Informe de colisiones](docs/screenshots/collision-report.png)

## Formatos compatibles

| Formato | Origen | Notas |
|---|---|---|
| `.traj` | Choreo (SleipnirGroup, BSD-3) | Todas las versiones de esquema conocidas; estados muestreados en tiempo |
| `.ghostauto` | Fork Collaborative de PathPlanner (FRC 103, MIT) | Incluye geometría de parachoques y nombre del equipo |
| `.path` | PathPlanner (MIT) | Trayectoria generada localmente — algoritmo de PathPlannerLib portado |
| `.auto` | PathPlanner (MIT) | Secuencias de rutas con semántica de esperas y comandos |
| `settings.json` | PathPlanner (MIT) | Dimensiones de parachoques de los robots de ese proyecto |
| `.pb` | Este proyecto | Archivo de sesión: todos los robots + ajustes + campo (el `.ghpb.json` anterior al renombre también se abre) |

Campos: FRC 2022–2026 integrados, más importación de campos personalizados con calibración y un JSON de disposición de AprilTags de WPILib/PhotonVision (sirve para cualquier otra temporada o un campo de práctica).

## Dónde conseguirla

- **macOS** (macOS 13+; una descarga Universal para Apple Silicon e Intel) — `PathBlender_<versión>_universal.dmg` desde [GitHub Releases](https://github.com/LYT259/pathblender/releases): ábrelo y arrastra PathBlender a Aplicaciones.
- **Windows** (x86_64) — el instalador `*_x64-setup.exe` de la misma página de releases.
- **Linux** (x86_64) — paquetes DEB, AppImage y RPM de la misma página. Las actualizaciones integradas usan el AppImage; los usuarios de DEB/RPM actualizan instalando el paquete nuevo sobre el anterior.
- Actualizaciones: menú **PathBlender → Buscar actualizaciones…** (en betas: activa antes el canal beta en **Preferencias → Actualizaciones**). Los demás archivos de la página de releases (`.tar.gz`, `.sig`, `.json`) son internos del actualizador — no los necesitas.
- **Aplicación web** (compilación visor: las mismas importaciones que la aplicación — archivos y carpetas enteras — más reproducción y comprobación; sin guardar sesiones ni exportar GIF o paquete de solución) — [pathblender.pages.dev](https://pathblender.pages.dev).

## Privacidad

Los archivos de rutas se analizan **enteramente en tu máquina**. No hay backend, ni cuentas, ni telemetría, ni analítica. La compilación web no hace ninguna llamada de red; la aplicación de escritorio contacta con la red solo para la comprobación de actualizaciones que tú disparas (GitHub Releases) — los archivos de rutas nunca salen de la aplicación.

También incluye: vista de alianza roja/azul a nivel de sesión, anotaciones de número de equipo por robot, los campos de temporada anteriores con superposición oficial de AprilTags y una interfaz en **40 idiomas** — con la lista completa en el menú de idioma — en temas claro y oscuro (sigue al sistema).

Guía completa por herramienta y preguntas frecuentes (en inglés y chino):
[English](docs/user-guide.en.md) ·
[简体中文](docs/user-guide.zh.md).

## Comentarios

Bugs, informes de deriva de formatos y problemas con campos de temporada son justo los comentarios que necesitamos. Abre un issue en
[github.com/LYT259/pathblender/issues](https://github.com/LYT259/pathblender/issues) —
la [plantilla de comentarios](docs/community/feedback-template.md) muestra qué incluir (nunca se te pedirá publicar tus archivos de rutas). El debate de la comunidad vive en el hilo de anuncio del proyecto en Chief Delphi.

## Estado

El alcance de visor descrito arriba está implementado y cubierto por pruebas de regresión. Las compilaciones de escritorio se publican en [GitHub Releases](https://github.com/LYT259/pathblender/releases).

## Licencia y atribución

**Apache-2.0** — ver [LICENSE](./LICENSE) y [NOTICE.md](./NOTICE.md).
PathPlanner (MIT), Choreo (BSD-3), los recursos de AdvantageScope (BSD-3) y WPILib (BSD-3) conservan cada uno su propia licencia y se acreditan en NOTICE.

El arte de los campos y los nombres de los juegos pertenecen a FIRST y se usan con fines no comerciales de estrategia de equipos conforme a la política de marcas y materiales de FIRST, revisada antes de cada publicación pública:

> FIRST®, FIRST® Robotics Competition y FIRST® Tech Challenge son marcas registradas de FIRST® (www.firstinspires.org), que no supervisa, ni participa en, ni es responsable de esta actividad, producto o servicio.
