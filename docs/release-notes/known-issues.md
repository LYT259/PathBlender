# Known issues & limitations

> The release generator embeds the matching language section below. Remove fixed issues in the same change that fixes them. Installer availability is derived from the release artifact manifest.

<!-- language: en -->

- **PathPlanner `.path` timing is an estimate** — trajectories are regenerated locally with a generic robot profile. Timing can differ from the real robot; treat near-miss collision results as advisory.
- **Season coverage** — built-in fields cover 2022–2026. Other seasons require custom field import (field image and calibration; AprilTag layout is optional).
- **Update checks contact GitHub** — the desktop app downloads update feeds and packages from GitHub Releases. Path files remain local and are never uploaded.
- **Slow reload on software-rendered browsers** — in Chromium-based browsers without GPU acceleration (some VMs, remote desktops, older machines), reloading or closing the web app can freeze the tab for ~20 seconds once the 3D view has been preloaded. This is a browser-side context teardown stall; waiting completes the action and no data is lost.

<!-- language: zh -->

- **PathPlanner `.path` 时间为估算值**——轨迹按通用机器人参数在本地重算，时间可能与实车不同；临界碰撞结论请当作参考。
- **赛季覆盖**——内置场地覆盖 2022–2026；其他赛季需导入自定义场地（场地图片与标定，AprilTag 布局可选）。
- **检查更新会连接 GitHub**——桌面版从 GitHub Releases 下载更新源和更新包；路径文件始终留在本地，绝不上传。
- **软件渲染浏览器上刷新缓慢**——在无 GPU 加速的基于 Chromium 的浏览器（部分虚拟机、远程桌面、旧机型）中，3D 视图预热后刷新或关闭网页版可能令标签页冻结约 20 秒。这是浏览器端上下文销毁停顿；等待即可完成操作，不会丢失数据。

<!-- language: zh-hk -->

- **PathPlanner `.path` 時間為估算值**——軌跡按通用機械人參數在本機重新計算，時間可能與實際機械人不同；臨界碰撞結果請作參考。
- **賽季涵蓋範圍**——內建場地涵蓋 2022–2026；其他賽季需匯入自訂場地（場地圖片與校準，AprilTag 佈局為選填項目）。
- **檢查更新會連接 GitHub**——桌面版從 GitHub Releases 下載更新來源和安裝套件；路徑檔案始終留在本機，絕不上傳。
- **軟體渲染瀏覽器上重新整理緩慢**——在無 GPU 加速、基於 Chromium 的瀏覽器（部分虛擬機、遠端桌面、舊機型）中，3D 檢視預熱後重新整理或關閉網頁版可能令分頁凍結約 20 秒。這是瀏覽器端的內容銷毀停頓；稍候即可完成操作，不會遺失資料。

<!-- language: es -->

- **El tiempo de los `.path` de PathPlanner es una estimación**: las trayectorias se regeneran localmente con un perfil genérico de robot; el cronometraje puede diferir del robot real. Trate los veredictos de colisión al límite como orientativos.
- **Cobertura de temporadas**: los campos integrados cubren 2022–2026. Otras temporadas requieren importar un campo personalizado (imagen y calibración; la disposición de AprilTags es opcional).
- **La comprobación de actualizaciones contacta con GitHub**: la aplicación de escritorio descarga fuentes y paquetes de actualización de GitHub Releases. Los archivos de rutas permanecen locales y nunca se suben.
- **Recarga lenta en navegadores con renderizado por software**: en navegadores basados en Chromium sin aceleración de GPU (algunas máquinas virtuales, escritorios remotos, equipos antiguos), recargar o cerrar la versión web puede congelar la pestaña unos 20 segundos una vez precargada la vista 3D. Es una pausa del navegador al destruir el contexto; esperando se completa la acción y no se pierden datos.

<!-- language: fr -->

- **Le minutage des `.path` PathPlanner est une estimation** — les trajectoires sont régénérées localement avec un profil de robot générique ; le minutage peut différer du robot réel. Considérez les verdicts de collision limite comme indicatifs.
- **Couverture des saisons** — les terrains intégrés couvrent 2022–2026. Les autres saisons passent par l’import d’un terrain personnalisé (image et calibrage ; la disposition AprilTags est facultative).
- **La vérification de mises à jour contacte GitHub** — l’application de bureau télécharge flux et paquets de mise à jour depuis GitHub Releases. Les fichiers de parcours restent locaux et ne sont jamais envoyés.
- **Rechargement lent sur navigateurs en rendu logiciel** — dans les navigateurs fondés sur Chromium sans accélération GPU (certaines VM, bureaux distants, anciennes machines), recharger ou fermer la version web peut figer l’onglet ~20 secondes après le préchargement de la vue 3D. C’est une pause du navigateur lors de la destruction du contexte ; patienter termine l’action, aucune donnée n’est perdue.

<!-- language: tr -->

- **PathPlanner `.path` zamanlaması bir tahmindir** — yörüngeler genel bir robot profiliyle yerel olarak yeniden üretilir; zamanlama gerçek robottan farklı olabilir. Sınırdaki çakışma sonuçlarını yol gösterici sayın.
- **Sezon kapsamı** — yerleşik sahalar 2022–2026'yı kapsar. Diğer sezonlar özel saha içe aktarması gerektirir (saha görseli ve kalibrasyon; AprilTag yerleşimi isteğe bağlı).
- **Güncelleme denetimi GitHub'a bağlanır** — masaüstü uygulaması güncelleme kaynaklarını ve paketlerini GitHub Releases'ten indirir. Yol dosyaları yerelde kalır, asla yüklenmez.
- **Yazılım çözücü tarayıcılarda yavaş yenileme** — GPU hızlandırması olmayan Chromium tabanlı tarayıcılarda (bazı sanal makineler, uzak masaüstleri, eski makineler) 3B görünüm ön yüklendikten sonra web sürümünü yenilemek veya kapatmak sekmeyi yaklaşık 20 saniye dondurabilir. Bu, tarayıcının bağlam yok etme duraklamasıdır; beklemek işlemi tamamlar, veri kaybı olmaz.

<!-- language: pt-br -->

- **O tempo dos `.path` do PathPlanner é uma estimativa** — as trajetórias são regeneradas localmente com um perfil genérico de robô; o tempo pode diferir do robô real. Trate veredictos de colisão no limite como orientativos.
- **Cobertura de temporadas** — os campos embutidos cobrem 2022–2026. Outras temporadas exigem importar um campo personalizado (imagem e calibração; a disposição de AprilTags é opcional).
- **A verificação de atualizações contata o GitHub** — o aplicativo de desktop baixa fontes e pacotes de atualização do GitHub Releases. Os arquivos de trajetórias ficam locais e nunca são enviados.
- **Recarregamento lento em navegadores com renderização por software** — em navegadores baseados em Chromium sem aceleração de GPU (algumas VMs, desktops remotos, máquinas antigas), recarregar ou fechar a versão web pode congelar a aba por cerca de 20 segundos depois que a visão 3D é pré-carregada. É uma pausa do navegador ao destruir o contexto; aguardar conclui a ação e nenhum dado é perdido.

<!-- language: he -->

- **התזמון של קובצי `.path` של PathPlanner הוא הערכה** — המסלולים מיוצרים מחדש מקומית עם פרופיל רובוט גנרי; התזמון עשוי להיות שונה מהרובוט האמיתי. יש להתייחס לפסקי התנגשות בגבול הקריטי כהכוונה בלבד.
- **כיסוי עונות** — המגרשים המובנים מכסים את 2022–2026. עונות אחרות דורשות ייבוא מגרש מותאם (תמונה וכיול; פריסת ה-AprilTag היא אופציונלית).
- **בדיקת העדכונים פונה ל-GitHub** — אפליקציית שולחן העבודה מורידה מקורות וחבילות עדכון מ-GitHub Releases. קובצי המסלולים נשארים מקומיים ולעולם לא מועלים.
- **טעינה מחדש איטית בדפדפנים עם רינדור תוכנתי** — בדפדפנים מבוססי Chromium ללא האצת GPU (חלק מהמכונות הווירטואליות, שולחנות עבודה מרוחקים, מכונות ישנות), רענון או סגירה של גרסת האינטרנט עלולים להקפיא את הלשונית למשך כ-20 שניות לאחר שתצוגת ה-3D נטענה מראש. זו השהיה של הדפדפן בהשמדת ההקשר; המתנה משלימה את הפעולה ולא אובדים נתונים.
