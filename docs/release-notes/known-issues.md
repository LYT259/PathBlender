# Known issues & limitations

> The release generator embeds the matching language section below. Remove fixed issues in the same change that fixes them. Installer availability is derived from the release artifact manifest.

<!-- language: en -->

- **PathPlanner `.path` timing is an estimate** — trajectories are regenerated locally with a generic robot profile. Timing can differ from the real robot; treat near-miss collision results as advisory.
- **Season coverage** — built-in fields cover 2022–2026. Other seasons require custom field import (field image and calibration; AprilTag layout is optional).
- **Update checks contact GitHub** — the desktop app downloads update feeds and packages from GitHub Releases. Path files remain local and are never uploaded.

<!-- language: zh -->

- **PathPlanner `.path` 时间为估算值**——轨迹按通用机器人参数在本地重算，时间可能与实车不同；临界碰撞结论请当作参考。
- **赛季覆盖**——内置场地覆盖 2022–2026；其他赛季需导入自定义场地（场地图片与标定，AprilTag 布局可选）。
- **检查更新会连接 GitHub**——桌面版从 GitHub Releases 下载更新源和更新包；路径文件始终留在本地，绝不上传。

<!-- language: zh-hk -->

- **PathPlanner `.path` 時間為估算值**——軌跡按通用機械人參數在本機重新計算，時間可能與實際機械人不同；臨界碰撞結果請作參考。
- **賽季涵蓋範圍**——內建場地涵蓋 2022–2026；其他賽季需匯入自訂場地（場地圖片與校準，AprilTag 佈局為選填項目）。
- **檢查更新會連接 GitHub**——桌面版從 GitHub Releases 下載更新來源和安裝套件；路徑檔案始終留在本機，絕不上傳。

<!-- language: es -->

- **El tiempo de los `.path` de PathPlanner es una estimación**: las trayectorias se regeneran localmente con un perfil genérico de robot; el cronometraje puede diferir del robot real. Trate los veredictos de colisión al límite como orientativos.
- **Cobertura de temporadas**: los campos integrados cubren 2022–2026. Otras temporadas requieren importar un campo personalizado (imagen y calibración; la disposición de AprilTags es opcional).
- **La comprobación de actualizaciones contacta con GitHub**: la aplicación de escritorio descarga fuentes y paquetes de actualización de GitHub Releases. Los archivos de rutas permanecen locales y nunca se suben.

<!-- language: fr -->

- **Le minutage des `.path` PathPlanner est une estimation** — les trajectoires sont régénérées localement avec un profil de robot générique ; le minutage peut différer du robot réel. Considérez les verdicts de collision limite comme indicatifs.
- **Couverture des saisons** — les terrains intégrés couvrent 2022–2026. Les autres saisons passent par l’import d’un terrain personnalisé (image et calibrage ; la disposition AprilTags est facultative).
- **La vérification de mises à jour contacte GitHub** — l’application de bureau télécharge flux et paquets de mise à jour depuis GitHub Releases. Les fichiers de parcours restent locaux et ne sont jamais envoyés.

<!-- language: tr -->

- **PathPlanner `.path` zamanlaması bir tahmindir** — yörüngeler genel bir robot profiliyle yerel olarak yeniden üretilir; zamanlama gerçek robottan farklı olabilir. Sınırdaki çakışma sonuçlarını yol gösterici sayın.
- **Sezon kapsamı** — yerleşik sahalar 2022–2026'yı kapsar. Diğer sezonlar özel saha içe aktarması gerektirir (saha görseli ve kalibrasyon; AprilTag yerleşimi isteğe bağlı).
- **Güncelleme denetimi GitHub'a bağlanır** — masaüstü uygulaması güncelleme kaynaklarını ve paketlerini GitHub Releases'ten indirir. Yol dosyaları yerelde kalır, asla yüklenmez.

<!-- language: pt-br -->

- **O tempo dos `.path` do PathPlanner é uma estimativa** — as trajetórias são regeneradas localmente com um perfil genérico de robô; o tempo pode diferir do robô real. Trate veredictos de colisão no limite como orientativos.
- **Cobertura de temporadas** — os campos embutidos cobrem 2022–2026. Outras temporadas exigem importar um campo personalizado (imagem e calibração; a disposição de AprilTags é opcional).
- **A verificação de atualizações contata o GitHub** — o aplicativo de desktop baixa fontes e pacotes de atualização do GitHub Releases. Os arquivos de trajetórias ficam locais e nunca são enviados.

<!-- language: he -->

- **התזמון של קובצי `.path` של PathPlanner הוא הערכה** — המסלולים מיוצרים מחדש מקומית עם פרופיל רובוט גנרי; התזמון עשוי להיות שונה מהרובוט האמיתי. יש להתייחס לפסקי התנגשות בגבול הקריטי כהכוונה בלבד.
- **כיסוי עונות** — המגרשים המובנים מכסים את 2022–2026. עונות אחרות דורשות ייבוא מגרש מותאם (תמונה וכיול; פריסת ה-AprilTag היא אופציונלית).
- **בדיקת העדכונים פונה ל-GitHub** — אפליקציית שולחן העבודה מורידה מקורות וחבילות עדכון מ-GitHub Releases. קובצי המסלולים נשארים מקומיים ולעולם לא מועלים.
