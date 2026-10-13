/** Reproduce the proposed GitHub social image from the real first-check capture.
 * No fetched fonts, remote assets or generated match imagery. Run after capture-star-readiness.mjs.
 * This prepares a local asset only; it does not upload or change repository settings.
 */
import { chromium } from 'playwright-core';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const screenshot = (await readFile('docs/screenshots/first-check-still.png')).toString('base64');
const icon = (await readFile('packages/web/src/assets/app-icon-day.png')).toString('base64');
const out = resolve('engineering-log/attachments/star-readiness');
await mkdir(out, { recursive: true });
await mkdir('docs/media', { recursive: true });
const social = `<!doctype html><html lang="en"><meta charset="utf-8"><title>PathBlender social preview draft</title>
<style>*{box-sizing:border-box}body{margin:0;width:1280px;height:640px;overflow:hidden;background:#181617;color:white;font-family:Arial,sans-serif;padding:56px;position:relative}.brand{display:flex;align-items:center;gap:18px;font-size:29px;font-weight:700}.brand img{width:58px;height:58px}h1{font-size:54px;line-height:1.06;letter-spacing:-1.4px;margin:46px 0 24px;width:570px}p{font-size:21px;line-height:1.5;color:#B5B8BB;width:485px}.tag{position:absolute;bottom:54px;font-size:17px;border-left:4px solid #911D23;padding-left:16px}.shot{position:absolute;top:101px;left:640px;width:710px;border:1px solid #B5B8BB;border-radius:10px}.note{position:absolute;left:665px;bottom:29px;font-size:13px;color:#B5B8BB}</style>
<div class="brand"><img src="data:image/png;base64,${icon}" alt="">PathBlender</div>
<h1>Three routes.<br>One shared clock.</h1><p>Bring Choreo and PathPlanner routes together. Find conflicts. Compare start times.</p>
<div class="tag">FRC alliance strategy · Local path processing</div>
<img class="shot" src="data:image/png;base64,${screenshot}" alt="Actual PathBlender practice session with a detected overlap">
<span class="note">Synthetic teaching routes · Actual application capture</span></html>`;
const browser = await chromium.launch({channel:'chrome'}).catch(() => chromium.launch());
try {
  const page = await browser.newPage({viewport:{width:1280,height:640},deviceScaleFactor:1});
  await page.setContent(social);
  await page.locator('img').evaluateAll(images => Promise.all(images.map(image => image.decode())));
  await page.screenshot({path:'docs/media/github-social-preview.png'});
} finally { await browser.close(); }
const bytes = (await stat('docs/media/github-social-preview.png')).size;
assert.ok(bytes < 1_000_000, 'Social image stays below 1 MB');
await writeFile(`${out}/social-preview-source.html`,social);
const review = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>PathBlender Star 准备 · 本地视觉审阅</title>
<style>body{margin:36px auto;max-width:1200px;padding:0 24px;font:16px/1.7 system-ui;color:#181617;background:#fafafa}h1{font-size:28px}h2{margin-top:40px}img{max-width:100%;border:1px solid #bbb;border-radius:8px}section{display:grid;grid-template-columns:1fr 1fr;gap:20px}figure{margin:0}figcaption{margin-bottom:10px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #bbb;padding:8px;text-align:left}a{color:#165ea2}.phone{max-width:390px}</style>
<h1>转公开前的 Star 准备 · 视觉审阅稿</h1><p>这些是实际运行截图；新尺寸与文案待确认后定稿。代码、文档和素材仅在独立工作区，未发布。正式构建默认不展示 Star 引导。</p>
<h2>首页：保留导入主入口</h2><section><figure><figcaption>修改前</figcaption><img src="welcome-before.png"></figure><figure><figcaption>修改后 · 公开状态本地预览</figcaption><img src="welcome-public-preview.png"></figure></section>
<p>新增“试做第一次路径检查”和 Star 小入口，不增加弹窗、登录或访问限制。</p>
<h2>真实操作：一次冲突 → 调整时间</h2><section><figure><figcaption>原路线：一处碰撞</figcaption><img src="practice-conflict.png"></figure><figure><figcaption>B 晚两秒：当前检查无碰撞；回放后出现可关闭邀请</figcaption><img src="practice-result.png"></figure></section>
<p><a href="../../../docs/screenshots/first-check.gif">查看 README 动图</a> · <a href="about-public-preview.png">查看关于页入口</a></p>
<h2>主题与窄屏</h2><section><figure><figcaption>深色</figcaption><img src="practice-dark-en-1440.png"></figure><figure><figcaption>简体中文</figcaption><img src="practice-light-zh-1440.png"></figure></section><img class="phone" src="practice-light-en-390.png">
<h2>GitHub 社交预览图提案</h2><img src="../../../docs/media/github-social-preview.png"><p>1280 × 640 PNG，${bytes.toLocaleString('en-US')} 字节。真实应用画面与自制教学路线；尚未上传 GitHub。</p>
<h2>视觉参数与确认范围</h2><table><tr><th>位置</th><th>修改前</th><th>提案值</th></tr><tr><td>界面主题色与动效</td><td>现有主题令牌</td><td>沿用原值，无新增动效</td></tr><tr><td>Star 图标</td><td>无</td><td>16 px，使用现有文字色</td></tr><tr><td>教学引导</td><td>无</td><td>12 px 正文，行高 1.5，10 × 12 px 内边距</td></tr><tr><td>邀请面板</td><td>无</td><td>12/13 px 文案，12 px 内边距</td></tr><tr><td>教学窄屏布局</td><td>侧栏覆盖画布</td><td>≤900 px 上下排列；画布区 300 px；侧栏仍可滚动访问</td></tr><tr><td>GitHub 预览图</td><td>未设置</td><td>品牌红 #911D23、黑 #181617、灰 #B5B8BB；标题 54 px</td></tr><tr><td>README 动图</td><td>无</td><td>真实录制30帧、4 fps、960 px宽；不影响应用播放参数</td></tr></table>
<p>文案、布局和新增尺寸均可调整；这份审阅稿不代表已经获得视觉定稿或公开授权。</p></html>`;
await writeFile(`${out}/review.html`,review);
console.log(JSON.stringify({social:'docs/media/github-social-preview.png',bytes,review:`${out}/review.html`}));
