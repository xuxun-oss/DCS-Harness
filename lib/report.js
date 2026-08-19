// dsh-dcs-cloud — 学术报告生成（Host 侧，纯 Node）。
// 将研究方案、方法、结果、图表整理成自包含的 HTML 网页，供用户检查。
// 图片以 base64 内嵌，报告可脱离工作区独立打开。

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, isAbsolute, extname, basename } from 'node:path';
import { homedir } from 'node:os';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// 极简 Markdown → HTML（支持标题、粗体、行内代码、代码块、列表、表格、链接）。
function mdToHtml(md) {
  const src = String(md == null ? '' : md);
  const lines = src.split(/\r?\n/);
  const out = [];
  let inCode = false;
  let codeBuf = [];
  let inTable = false;
  let tableBuf = [];
  let listStack = 0;

  const closeList = () => { while (listStack > 0) { out.push('</ul>'); listStack--; } };
  const closeTable = () => {
    if (inTable) {
      let html = '<table><thead><tr>';
      const header = tableBuf[0] || [];
      for (const h of header) html += '<th>' + inline(h) + '</th>';
      html += '</tr></thead><tbody>';
      for (let i = 2; i < tableBuf.length; i++) {
        const row = tableBuf[i] || [];
        html += '<tr>';
        for (const c of row) html += '<td>' + inline(c) + '</td>';
        html += '</tr>';
      }
      html += '</tbody></table>';
      out.push(html);
      tableBuf = [];
      inTable = false;
    }
  };

  function inline(s) {
    return String(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*]+)\*/g, '<em>$1</em>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  }

  function splitRow(line) {
    return line.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map((c) => c.trim());
  }
  function isTableSep(line) { return /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && line.indexOf('-') !== -1; }

  const flushCode = () => {
    if (inCode) {
      out.push('<pre><code>' + esc(codeBuf.join('\n')) + '</code></pre>');
      codeBuf = [];
      inCode = false;
    }
  };

  for (let line of lines) {
    if (line.trim().startsWith('```')) {
      if (inCode) { flushCode(); }
      else { closeList(); closeTable(); inCode = true; codeBuf = []; }
      continue;
    }
    if (inCode) { codeBuf.push(line); continue; }

    if (isTableSep(line)) {
      if (!inTable) { closeList(); inTable = true; tableBuf = []; tableBuf.push(splitRow(lines[lines.indexOf(line) - 1] || '')); }
      tableBuf.push([]); // 分隔行占位
      continue;
    }
    if (/^\s*\|/.test(line)) {
      closeList();
      if (!inTable) { inTable = true; tableBuf = []; }
      tableBuf.push(splitRow(line));
      continue;
    }
    closeTable();

    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { closeList(); const n = h[1].length; out.push('<h' + n + '>' + inline(h[2]) + '</h' + n + '>'); continue; }

    if (/^\s*[-*+]\s+/.test(line)) {
      if (listStack === 0) { out.push('<ul>'); listStack = 1; }
      out.push('<li>' + inline(line.replace(/^\s*[-*+]\s+/, '')) + '</li>');
      continue;
    }
    closeList();

    if (line.trim() === '') { out.push(''); continue; }
    out.push('<p>' + inline(line) + '</p>');
  }
  flushCode();
  closeList();
  closeTable();
  return out.join('\n');
}

function imageToB64(abs) {
  try {
    const buf = readFileSync(abs);
    if (buf.length > 8 * 1024 * 1024) return null; // 跳过超大图
    return 'data:image/' + (extname(abs).toLowerCase().replace('.', '') || 'png') + ';base64,' + buf.toString('base64');
  } catch {
    return null;
  }
}

function resolvePath(p, workspace) {
  if (!p) return null;
  return isAbsolute(p) ? p : join(workspace || process.cwd(), p);
}

/**
 * 生成学术报告 HTML。
 * @param {object} r 报告结构
 *   r.title, r.objective, r.abstract, r.introduction,
 *   r.methods (markdown), r.results (markdown),
 *   r.figures [{path,caption}], r.discussion, r.references (markdown),
 *   r.appendix (markdown), r.metadata {author, date, task}
 * @returns {{path, html, figures}} 落盘路径、HTML 文本、成功内嵌图片数
 */
export function generateReport(r, opts) {
  const workspace = (opts && opts.workspace) || process.cwd();
  const outDir = (opts && opts.outDir) || join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'dcs-reports');
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outPath = (opts && opts.outPath) || join(outDir, 'dcs-report-' + stamp + '.html');

  const figures = (r.figures || []).map((f) => {
    const abs = resolvePath(f.path, workspace);
    const b64 = abs ? imageToB64(abs) : null;
    return { caption: f.caption || '', src: b64, path: abs, ok: !!b64 };
  });

  const figHtml = figures.map((f) => {
    if (!f.ok) return '<figure class="fig missing"><div class="fig-ph">图片缺失：' + esc(f.path || '') + '</div>' + (f.caption ? '<figcaption>' + esc(f.caption) + '</figcaption>' : '') + '</figure>';
    return '<figure class="fig"><img src="' + f.src + '" alt="' + esc(f.caption) + '">' + (f.caption ? '<figcaption>' + esc(f.caption) + '</figcaption>' : '') + '</figure>';
  }).join('\n');

  const tocItems = [];
  const tocLink = (label) => { const id = 'sec-' + tocItems.length; tocItems.push({ id, label }); return id; };

  const meta = r.metadata || {};
  const metaHtml = [
    meta.author ? '<div class="meta-author">' + esc(meta.author) + '</div>' : '',
    meta.date ? '<div class="meta-date">' + esc(meta.date) + '</div>' : '',
    meta.task ? '<div class="meta-task">任务：' + esc(meta.task) + '</div>' : '',
  ].filter(Boolean).join('');

  const tocHtml = tocItems.length
    ? '<nav class="toc"><h2>目录</h2><ul>' + tocItems.map((t) => '<li><a href="#' + t.id + '">' + esc(t.label) + '</a></li>').join('') + '</ul></nav>'
    : '';

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(r.title || 'DCS Cloud 研究报告')}</title>
<style>
:root{--fg:#1a1a2e;--muted:#5b6172;--accent:#0f62fe;--line:#e3e6ee;--bg:#f6f7fb;--card:#ffffff;}
*{box-sizing:border-box}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;color:var(--fg);background:var(--bg);line-height:1.7}
.wrap{max-width:900px;margin:0 auto;padding:40px 28px 80px}
header.titlepage{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:36px 40px;margin-bottom:28px}
h1.report-title{font-size:30px;line-height:1.35;margin:0 0 16px}
.subtitle{color:var(--muted);font-size:14px}
.meta{display:flex;flex-wrap:wrap;gap:8px 20px;color:var(--muted);font-size:13px;margin-top:18px}
.badge{display:inline-block;background:var(--accent);color:#fff;border-radius:999px;padding:2px 12px;font-size:12px;letter-spacing:.5px}
nav.toc{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:20px 26px;margin-bottom:28px}
nav.toc h2{font-size:14px;margin:0 0 10px;color:var(--muted)}
nav.toc ul{list-style:none;margin:0;padding:0}
nav.toc li{margin:4px 0}
nav.toc a{color:var(--accent);text-decoration:none;font-size:14px}
section{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:26px 34px;margin-bottom:22px}
section h2{font-size:20px;margin:0 0 14px;border-left:4px solid var(--accent);padding-left:12px}
section h3{font-size:16px;margin:20px 0 8px}
section h4{font-size:15px;margin:16px 0 6px}
p{margin:10px 0}
code{background:#eef1f7;border-radius:4px;padding:1px 6px;font-family:"SF Mono",Menlo,Consolas,monospace;font-size:.9em}
pre{background:#0f1220;color:#e6e9f2;border-radius:8px;padding:16px;overflow:auto}
pre code{background:none;color:inherit;padding:0}
table{border-collapse:collapse;width:100%;margin:14px 0;font-size:14px}
th,td{border:1px solid var(--line);padding:8px 12px;text-align:left}
th{background:#f0f3fa}
figure.fig{margin:18px 0;text-align:center}
figure.fig img{max-width:100%;border:1px solid var(--line);border-radius:8px}
figure.fig figcaption{color:var(--muted);font-size:13px;margin-top:8px}
figure.fig .fig-ph{background:#fff3f3;border:1px dashed #e0a;border-radius:8px;padding:30px;color:#b03}
a{color:var(--accent)}
footer{margin-top:34px;color:var(--muted);font-size:12px;text-align:center}
@media print{body{background:#fff}section,header.titlepage,nav.toc{border:none;box-shadow:none}}
</style>
</head>
<body>
<div class="wrap">
<header class="titlepage">
  <div class="subtitle">DCS Cloud 研究报告 · 由 dsh-dcs-cloud 自动生成</div>
  <h1 class="report-title">${esc(r.title || '研究报告')}</h1>
  ${r.objective ? '<div class="subtitle">研究目标：' + esc(r.objective) + '</div>' : ''}
  <div class="meta">${metaHtml || '<span class="subtitle">' + esc(r.title || '') + '</span>'}</div>
</header>
${tocHtml}
${r.abstract ? '<section id="' + tocLink('摘要') + '"><h2>摘要</h2>' + mdToHtml(r.abstract) + '</section>' : ''}
${r.introduction ? '<section id="' + tocLink('引言与背景') + '"><h2>引言与背景</h2>' + mdToHtml(r.introduction) + '</section>' : ''}
${r.methods ? '<section id="' + tocLink('研究方案与方法') + '"><h2>研究方案与方法</h2>' + mdToHtml(r.methods) + '</section>' : ''}
${r.results ? '<section id="' + tocLink('结果') + '"><h2>结果</h2>' + mdToHtml(r.results) + '</section>' : ''}
${figHtml ? '<section id="' + tocLink('图表') + '"><h2>图表</h2>' + figHtml + '</section>' : ''}
${r.discussion ? '<section id="' + tocLink('讨论') + '"><h2>讨论</h2>' + mdToHtml(r.discussion) + '</section>' : ''}
${r.references ? '<section id="' + tocLink('参考文献') + '"><h2>参考文献</h2>' + mdToHtml(r.references) + '</section>' : ''}
${r.appendix ? '<section id="' + tocLink('附录') + '"><h2>附录</h2>' + mdToHtml(r.appendix) + '</section>' : ''}
<footer>由 dsh-dcs-cloud 生成 · ${esc(new Date().toISOString())}</footer>
</div>
</body>
</html>`;

  writeFileSync(outPath, html, 'utf8');
  return { path: outPath, html, figures: figures.filter((f) => f.ok).length, totalFigures: figures.length };
}
