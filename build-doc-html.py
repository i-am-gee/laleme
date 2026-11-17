#!/usr/bin/env python3
# 把《拉了么-产品文档.md》排成一份可转 docx 的 HTML：
# 封面 + 目录 + 正文（章节/表格/代码块/引用），棕色系与产品视觉一致
import re
import html as ht
import os

SRC = "/Users/ghost/WorkBuddy/2026-11-09-16-58-52/拉了么-产品文档.md"
OUT = "/tmp/laleme-doc.html"

raw = open(SRC, encoding="utf-8").read()
lines = raw.split("\n")


def inline(text):
    """行内：粗体、行内代码、链接"""
    text = ht.escape(text)
    text = re.sub(r"`([^`]+)`",
                  r'<code style="font-family:\'Courier New\',monospace;font-size:9pt;color:#6f4b30;">\1</code>',
                  text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<a href="\2">\1</a>', text)
    return text


def is_table_sep(line):
    return bool(re.match(r"^\s*\|[\s:\-|]+\|\s*$", line))


def parse_table(block):
    rows = []
    for line in block:
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        rows.append(cells)
    if len(rows) < 2:
        return ""
    head = rows[0]
    body = rows[2:]
    cell = "font-size:9pt;padding:5pt 7pt;border:0.6pt solid #e3dad0;line-height:1.5;text-align:left;"
    head_cell = cell + "background-color:#f3ece3;color:#6f4b30;font-weight:bold;font-family:'Heiti SC',sans-serif;"
    out = ['<table style="width:100%;border-collapse:collapse;margin:6pt 0 10pt;">',
           "<thead><tr>"]
    for c in head:
        out.append('<th style="%s">%s</th>' % (head_cell, inline(c)))
    out.append("</tr></thead><tbody>")
    for r in body:
        out.append("<tr>")
        for c in r:
            out.append('<td style="%s">%s</td>' % (cell, inline(c)))
        out.append("</tr>")
    out.append("</tbody></table>")
    return "".join(out)


body = []
chapters = []   # 目录条目：[(text)]
i = 0
title = ""
subtitle = ""
meta = ""
in_code = False
code_buf = []
list_buf = []
list_type = None


def flush_list():
    global list_buf, list_type
    if not list_buf:
        return
    tag = "ol" if list_type == "ol" else "ul"
    body.append("<%s>%s</%s>" % (tag, "".join(list_buf), tag))
    list_buf = []
    list_type = None


while i < len(lines):
    line = lines[i]
    stripped = line.strip()

    # 代码块
    if stripped.startswith("```"):
        if in_code:
            body.append(
                '<pre style="font-family:\'Courier New\',monospace;font-size:8.5pt;text-align:left;'
                'margin:4pt 0 8pt;">'
                '<code style="font-family:\'Courier New\',monospace;font-size:8.5pt;text-align:left;">%s</code></pre>'
                % ht.escape("\n".join(code_buf)))
            code_buf = []
            in_code = False
        else:
            flush_list()
            in_code = True
        i += 1
        continue
    if in_code:
        code_buf.append(line)
        i += 1
        continue

    # 标题
    m = re.match(r"^(#{1,4})\s+(.*)$", line)
    if m:
        flush_list()
        level = len(m.group(1))
        text = m.group(2).strip()
        if level == 1:
            title = text
        elif level == 2:
            chapters.append(text)
            body.append('<h1 id="c%d">%s</h1>' % (len(chapters), inline(text)))
        elif level == 3:
            body.append("<h2>%s</h2>" % inline(text))
        else:
            body.append("<h3>%s</h3>" % inline(text))
        i += 1
        continue

    # 表格
    if stripped.startswith("|") and i + 1 < len(lines) and is_table_sep(lines[i + 1]):
        flush_list()
        block = []
        j = i
        while j < len(lines) and lines[j].strip().startswith("|"):
            block.append(lines[j])
            j += 1
        body.append(parse_table(block))
        i = j
        continue

    # 分隔线
    if re.match(r"^-{3,}$", stripped):
        flush_list()
        i += 1
        continue

    # 引用
    if stripped.startswith(">"):
        if not chapters:
            # 正文开头那行「版本/更新/定位」已经放在封面，正文不再重复
            while i < len(lines) and lines[i].strip().startswith(">"):
                i += 1
            continue
        flush_list()
        quote = []
        while i < len(lines) and lines[i].strip().startswith(">"):
            quote.append(lines[i].strip().lstrip(">").strip())
            i += 1
        body.append("<blockquote><p>%s</p></blockquote>" % inline(" ".join(quote)))
        continue

    # 列表
    m = re.match(r"^(\d+)[.、]\s+(.*)$", stripped)
    if m:
        if list_type != "ol":
            flush_list()
            list_type = "ol"
        list_buf.append("<li>%s</li>" % inline(m.group(2)))
        i += 1
        continue
    m = re.match(r"^[-*]\s+(.*)$", stripped)
    if m:
        if list_type != "ul":
            flush_list()
            list_type = "ul"
        list_buf.append("<li>%s</li>" % inline(m.group(1)))
        i += 1
        continue

    # 空行
    if not stripped:
        flush_list()
        i += 1
        continue

    # 普通段落
    flush_list()
    para = [stripped]
    i += 1
    while i < len(lines):
        nxt = lines[i].strip()
        if (not nxt or nxt.startswith("#") or nxt.startswith("|")
                or nxt.startswith("```") or nxt.startswith(">")
                or re.match(r"^[-*]\s+", nxt) or re.match(r"^\d+[.、]\s+", nxt)
                or re.match(r"^-{3,}$", nxt)):
            break
        para.append(nxt)
        i += 1
    body.append("<p>%s</p>" % inline("".join(para)))

flush_list()

def toc_line(text):
    m = re.match(r"^(\d+\.)\s+(.*)$", text)
    if m:
        return '<p class="toc-item"><span class="toc-n">%s</span>\u3000%s</p>' % (
            inline(m.group(1)), inline(m.group(2)))
    return '<p class="toc-item">%s</p>' % inline(text)


toc_html = "".join(toc_line(t) for t in chapters)
content = "\n".join(body)

TEMPLATE = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>{title}</title>
<style>
:root {{
  --ink: #1c1a17;
  --ink-2: #4a453f;
  --ink-3: #7b746b;
  --brown: #8b5e3c;
  --brown-deep: #6f4b30;
  --gold: #b8893c;
  --line: #e3dad0;
  --tint: #f7f2ec;
}}
* {{ box-sizing: border-box; }}
body {{
  font-family: "Songti SC", SimSun, serif;
  font-size: 10.5pt;
  line-height: 1.75;
  color: var(--ink);
  margin: 0;
}}
h1, h2, h3, h4 {{ font-family: "Heiti SC", "Microsoft YaHei", sans-serif; color: var(--ink); }}
h1 {{
  font-size: 17pt;
  margin: 22pt 0 10pt;
  padding-bottom: 6pt;
  border-bottom: 1.2pt solid var(--brown);
  page-break-after: avoid;
}}
h2 {{
  font-size: 13pt;
  margin: 16pt 0 6pt;
  color: var(--brown-deep);
  page-break-after: avoid;
}}
h3 {{
  font-size: 11pt;
  margin: 12pt 0 4pt;
  color: var(--ink-2);
  page-break-after: avoid;
}}
p {{ margin: 0 0 7pt; text-align: left; }}
strong {{ color: var(--ink); }}
code {{
  font-family: Menlo, Consolas, monospace;
  font-size: 9pt;
  background: var(--tint);
  color: var(--brown-deep);
  padding: 1pt 3pt;
}}
pre {{
  background: #faf7f2;
  border-left: 2.5pt solid var(--gold);
  padding: 8pt 10pt;
  margin: 8pt 0 10pt;
  font-size: 8.5pt;
  line-height: 1.5;
}}
pre code {{ background: none; padding: 0; color: var(--ink-2); }}
blockquote {{
  margin: 8pt 0;
  padding: 7pt 10pt;
  background: var(--tint);
  border-left: 2.5pt solid var(--brown);
  color: var(--ink-2);
  font-size: 9.5pt;
}}
blockquote p {{ margin: 0; }}
table {{
  width: 100%;
  border-collapse: collapse;
  margin: 8pt 0 12pt;
  font-size: 9pt;
  font-family: "Heiti SC", "Microsoft YaHei", sans-serif;
}}
th {{
  background: #f3ece3;
  color: var(--brown-deep);
  font-weight: bold;
  text-align: left;
  padding: 5pt 6pt;
  border: 0.6pt solid var(--line);
}}
td {{
  padding: 5pt 6pt;
  border: 0.6pt solid var(--line);
  vertical-align: top;
  color: var(--ink-2);
}}
ul, ol {{ margin: 4pt 0 8pt 0; padding-left: 16pt; }}
li {{ margin-bottom: 3pt; }}
a {{ color: var(--brown); text-decoration: none; }}

/* ---------- 封面 ---------- */
.cover {{ padding-top: 90pt; }}
.cover .kicker {{
  font-family: "Heiti SC", sans-serif;
  font-size: 9.5pt;
  letter-spacing: 4pt;
  color: var(--gold);
  margin-bottom: 14pt;
}}
.cover .title {{
  font-family: "Heiti SC", sans-serif;
  font-size: 34pt;
  font-weight: bold;
  color: var(--brown-deep);
  margin: 0 0 6pt;
  border: none;
  padding: 0;
}}
.cover .sub {{
  font-family: "Heiti SC", sans-serif;
  font-size: 12pt;
  color: var(--ink-3);
  margin: 0 0 26pt;
}}
.cover .rule {{ height: 2.5pt; width: 86pt; background: var(--gold); margin: 0 0 26pt; }}
.cover .meta {{ font-size: 10pt; color: var(--ink-2); line-height: 2.1; }}
.cover .meta b {{ color: var(--brown-deep); font-weight: normal; }}
.cover .foot {{
  margin-top: 120pt;
  font-size: 8.5pt;
  color: var(--ink-3);
  border-top: 0.6pt solid var(--line);
  padding-top: 8pt;
}}

/* ---------- 目录 ---------- */
.toc-title {{
  font-family: "Heiti SC", sans-serif;
  font-size: 16pt;
  color: var(--brown-deep);
  margin: 0 0 14pt;
}}

.toc-item {{
  font-family: "Heiti SC", "Microsoft YaHei", sans-serif;
  font-size: 10.5pt;
  color: var(--ink-2);
  margin: 0 0 5pt;
  line-height: 1.3;
}}
.toc-n {{
  color: var(--gold);
  font-weight: bold;
  margin-right: 10pt;
}}
</style>
</head>
<body>

<section role="cover">
  <div class="cover">
    <div class="kicker">PRODUCT DOCUMENT</div>
    <div class="title">拉了么</div>
    <div class="sub">一款极度克制的肠道健康记录小程序</div>
    <div class="rule"></div>
    <div class="meta">
      <div><b>文档类型</b>　产品文档（内部研发交接）</div>
      <div><b>对应版本</b>　v1.16.0</div>
      <div><b>更新日期</b>　2026 年 11 月 18 日</div>
      <div><b>平台</b>　微信小程序 · 零依赖 · 数据 100% 本机</div>
    </div>
    <div class="foot">
      本文与代码不一致时以代码为准；本文负责说清「为什么是这样」。<br>
      由「拉了么」项目维护，禁止商用。
    </div>
  </div>
</section>

<section role="body">
  <h1 class="toc-title">目　录</h1>
  {toc}
</section>

<section role="body" data-page-restart="1">
{content}
</section>

</body>
</html>
"""

html_out = TEMPLATE.format(title=ht.escape(title), content=content, toc=toc_html)
open(OUT, "w", encoding="utf-8").write(html_out)
print("written", OUT, len(html_out), "bytes")
